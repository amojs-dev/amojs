/**
 * Build-time template parser — the static strings of a detected `html` tag
 * become a TemplateIR: static markup + holes with positional paths.
 *
 * Semantics mirror the runtime parser in amojs (html.js) — the runtime
 * is the semantic source of truth (LOCKED RULE #3). The difference: the
 * runtime lets the browser build the tree and then walks it; here there is
 * no DOM (LOCKED RULE #4), so a small tokenizer does the node-index
 * bookkeeping itself. Holes are found at part boundaries — no markers needed.
 *
 * Strict subset — the compiler THROWS where a browser would silently guess:
 *   - every non-void element needs an explicit closing tag
 *   - self-closing syntax on non-void elements (`<div/>`) is an error
 *   - rawtext elements (script/style/textarea/title) carry STATIC content
 *     only — their body is one inert text node, so a hole inside could never
 *     bind; <textarea> state binds through value="${…}" like every control
 *   - an attribute hole must be the entire attribute value
 *   - holes cannot appear in tag-name or attribute-name position
 *   - a hole cannot sit inside <template> (children live in .content)
 *   - <tr> needs <tbody>/<thead>/<tfoot> — never <table> directly
 *
 * FOREIGN CONTENT (svg/math) plays by different rules, and the browser applies
 * them too — so we must, or a template that works with no build would break
 * once compiled (LOCKED RULE #3). Inside an <svg> or <math> subtree:
 *   - self-closing works on ANY element: `<circle r="5"/>` is how SVG is written
 *   - there are no void elements, so `<circle>` still needs `</circle>`
 *   - names keep the author's casing (`viewBox`, `gradientTransform`) — SVG
 *     attribute names are case-SENSITIVE at the setAttribute() boundary
 *   - script/style/title/desc are ordinary elements, not rawtext
 * HTML rules resume inside an HTML integration point (foreignObject/desc/title).
 */

import type { TemplateIR, Hole, NodePath } from './ir.js';

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAWTEXT = new Set(['script', 'style', 'textarea', 'title']);

/** elements whose subtree leaves HTML rules behind */
const FOREIGN_ROOTS = new Set(['svg', 'math']);
/** inside foreign content, these hand their CHILDREN back to HTML rules */
const INTEGRATION = new Set(['foreignobject', 'desc', 'title', 'annotation-xml']);

/** where a construct started, so an error can point AT it rather than at EOF */
interface Origin {
  part: number;
  offset: number;
}

interface Frame {
  tag: string;
  /** the name as emitted — a closing tag must spell it the same way */
  emit: string;
  path: NodePath;
  /** child nodes assigned so far: elements, text runs, comments, placeholders */
  count: number;
  /** are this frame's CHILDREN in foreign content? */
  foreign: boolean;
  /** the `<` of the opening tag — what "unclosed <div>" should underline */
  origin: Origin;
}

interface OpenElement {
  tag: string;
  /** the name as written, when casing must survive (foreign content) */
  emit: string;
  path: NodePath;
  /** canonical serialization of the attributes seen so far */
  attrs: string;
  /** is this element itself in foreign content? */
  foreign: boolean;
  /** the `<` of this tag */
  origin: Origin;
  /** index into `holes` when this tag opened — every hole recorded past this
   *  point belongs to this tag, and gets its `htmlAt` back-filled when the
   *  open tag is finally emitted (only then is the offset known) */
  holeStart: number;
}

/**
 * A strict-subset violation, located.
 *
 * `part` is the index of the static string the error sits in and `offset` is the
 * character index inside that string — a position relative to the TEMPLATE, not
 * to any file, because the parser is given strings and never sees a document.
 * Turning that into a document range is `diagnose()`'s job.
 *
 * `message` keeps the decorated form the CLI prints; `detail` is the bare
 * sentence, which is what belongs in an editor squiggle that already points at
 * the spot.
 */
export class TemplateError extends Error {
  readonly detail: string;
  readonly part: number;
  readonly offset: number;

  constructor(detail: string, part: number, offset: number) {
    super(`amo compiler: ${detail} (template part ${part})`);
    this.name = 'TemplateError';
    this.detail = detail;
    this.part = part;
    this.offset = offset;
  }
}

export function parseTemplate(strings: readonly string[]): TemplateIR {
  return new Parser(strings).parse();
}

class Parser {
  private html = '';
  private holes: Hole[] = [];
  private stack: Frame[] = [
    {
      tag: '#root',
      emit: '#root',
      path: [],
      count: 0,
      foreign: false,
      origin: { part: 0, offset: 0 },
    },
  ];
  /** true while inside a contiguous static text run (one text node) */
  private textOpen = false;
  /** non-null while scanning inside an open tag `<div …` */
  private el: OpenElement | null = null;
  /** set when a part ended in an attribute-value hole; consumed at next part */
  private resume: { quote: string | null } | null = null;
  /** non-null while inside <title> content that a hole interrupted */
  private rawText: OpenElement | null = null;
  /** root-level bookkeeping for the static unwrap decision */
  private rootElements = 0;
  private rootElementIndex = -1;
  private rootOther = false;

  constructor(private readonly strings: readonly string[]) {}

  private top(): Frame {
    return this.stack[this.stack.length - 1];
  }

  /** @param offset character index within part `part` — where to point. */
  private fail(msg: string, part: number, offset: number): never {
    throw new TemplateError(msg, part, offset);
  }

  /* A hole anywhere inside <template> can never bind: the browser parses
     template children into `.content`, which positional childNodes walks
     (compiled) and the marker walker (raw) both never enter. Found by the
     lab's probes — compiled crashed, raw silently dropped the binding.
     Static content inside <template> stays legal; it is one child node
     either way. The check runs where holes are RECORDED, so it covers
     child, attribute and event holes alike. */
  private failIfInTemplate(part: number): void {
    if (this.stack.some((f) => f.tag === 'template' && !f.foreign)) {
      this.fail(
        'a hole cannot sit inside <template> — its children live in .content, where bindings never reach',
        part,
        this.strings[part].length,
      );
    }
  }

  parse(): TemplateIR {
    for (let p = 0; p < this.strings.length; p++) {
      const s = this.strings[p];
      let i = 0;

      if (this.resume) {
        // re-entering right after an attribute-value hole
        if (this.resume.quote !== null) {
          if (s[i] !== this.resume.quote) {
            this.fail('an attribute hole must be the entire quoted value', p, i);
          }
          i++;
        } else if (s[i] === '/') {
          /* `<circle r=${x}/>` is a trap the BROWSER falls into: "/" does not
             terminate an unquoted attribute value, so the value becomes "…/"
             AND the element never self-closes — the next sibling silently
             becomes a child. Verified in Chrome. Raw mode already rejects it
             (the marker no longer matches), so the compiler must too. */
          this.fail(
            'an unquoted attribute hole cannot be followed by "/>" — ' +
              'write a space before "/>" or quote the hole',
            p,
            i,
          );
        } else if (i < s.length && !/[\s>]/.test(s[i])) {
          this.fail('an attribute hole must be the entire attribute value', p, i);
        } else if (i >= s.length && p < this.strings.length - 1) {
          // the part is empty: point at its start, which is where the two holes meet
          this.fail('two holes cannot sit together inside a tag', p, i);
        }
        this.resume = null;
      }

      while (i < s.length) {
        i = this.rawText
          ? this.scanRawText(this.rawText, s, i, p)
          : this.el
            ? this.scanTag(s, i, p)
            : this.scanText(s, i, p);
      }

      if (p < this.strings.length - 1) this.boundary(p);
    }

    if (this.rawText) {
      // rawtext pushes no frame, so the stack check below cannot catch this
      const { tag, origin } = this.rawText;
      this.fail(`unclosed <${tag}>`, origin.part, origin.offset);
    }
    if (this.el) {
      const { tag, origin } = this.el;
      this.fail(`template ends inside <${tag}>`, origin.part, origin.offset);
    }
    if (this.stack.length > 1) {
      const f = this.top();
      this.fail(`unclosed <${f.tag}>`, f.origin.part, f.origin.offset);
    }
    const singleRootIndex =
      this.rootElements === 1 && !this.rootOther ? this.rootElementIndex : null;
    return { html: this.html, holes: this.holes, singleRootIndex };
  }

  /** A part boundary is a hole. Legal only in text position or as a full attr value. */
  private boundary(p: number): void {
    if (this.resume) return; // attribute-value hole — already recorded by scanTag
    if (this.rawText) {
      // inside <title> content: escaped text at an offset, server target only
      this.failIfInTemplate(p);
      const { tag, path } = this.rawText;
      this.holes.push({ kind: 'content', expr: p, path: [...path], htmlAt: this.html.length, tag });
      return;
    }
    if (this.el) {
      this.fail(
        'a hole may only be an element child or a full attribute value',
        p,
        this.strings[p].length,
      );
    }
    const f = this.top();
    this.failIfInTemplate(p);
    this.textOpen = false;
    // an empty comment marks the spot: it keeps adjacent static text nodes
    // apart through serialize→parse, so NodePaths stay valid. Consumers swap
    // it for an empty text node (see amojs/compiled tpl()).
    const htmlAt = this.html.length;
    this.html += '<!---->';
    this.holes.push({ kind: 'child', expr: p, path: [...f.path, f.count++], htmlAt });
  }

  private scanText(s: string, i: number, p: number): number {
    while (i < s.length) {
      if (s[i] !== '<') {
        if (!this.textOpen) {
          this.textOpen = true;
          this.top().count++;
        }
        if (this.stack.length === 1 && !/\s/.test(s[i])) this.rootOther = true;
        this.html += s[i];
        i++;
        continue;
      }

      const next = s[i + 1];

      if (next === '/') {
        // closing tag
        const m = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(s.slice(i));
        if (!m) this.fail('malformed closing tag', p, i);
        const tag = m[1].toLowerCase();
        if (this.stack.length === 1 || this.top().tag !== tag) {
          this.fail(`unexpected </${tag}>`, p, i);
        }
        this.textOpen = false;
        // spell the close exactly like the open — a foreign name kept its casing
        this.html += `</${(this.stack.pop() as Frame).emit}>`;
        i += m[0].length;
        continue;
      }

      if (s.startsWith('<!--', i)) {
        const end = s.indexOf('-->', i + 4);
        if (end === -1) this.fail('a hole cannot appear inside a comment', p, i);
        this.textOpen = false;
        if (this.stack.length === 1) this.rootOther = true;
        this.top().count++;
        this.html += s.slice(i, end + 3);
        i = end + 3;
        continue;
      }

      if (next !== undefined && /[a-zA-Z]/.test(next)) {
        // opening tag — hand over to scanTag
        const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(s.slice(i));
        if (!m) this.fail('malformed tag', p, i);
        const tag = m[1].toLowerCase();
        const parent = this.top();
        // an <svg>/<math> anywhere opens foreign content; inside it, rawtext
        // does not exist — <svg><title>Chart</title></svg> is ordinary markup
        const foreign = parent.foreign || FOREIGN_ROOTS.has(tag);
        /* The browser inserts an implied <tbody> around a bare <tr> on
           reparse, which shifts every NodePath computed here — raw mode
           would work while compiled crashes (found by the lab's probes).
           Rejecting loudly beats modeling the browser's implied-tag rules. */
        if (!foreign && tag === 'tr' && parent.tag === 'table') {
          this.fail(
            '<tr> cannot sit directly inside <table> — wrap rows in <tbody> (or <thead>/<tfoot>)',
            p,
            i,
          );
        }
        this.textOpen = false;
        const path = [...parent.path, parent.count++];
        if (this.stack.length === 1) {
          this.rootElements++;
          this.rootElementIndex = path[0];
        }
        // casing survives only in foreign content, where names are meaningful
        this.el = {
          tag,
          emit: foreign ? m[1] : tag,
          path,
          attrs: '',
          foreign,
          origin: { part: p, offset: i }, // the `<`
          holeStart: this.holes.length,
        };
        return i + m[0].length;
      }

      // a literal "<" that opens no tag (e.g. "a < b") — text, like the browser
      if (!this.textOpen) {
        this.textOpen = true;
        this.top().count++;
      }
      if (this.stack.length === 1) this.rootOther = true;
      this.html += '<';
      i++;
    }
    return i;
  }

  private scanTag(s: string, i: number, p: number): number {
    const el = this.el;
    if (!el) return i;

    while (i < s.length) {
      const ch = s[i];

      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      if (ch === '>') {
        this.sealTag(el);
        this.html += `<${el.emit}${el.attrs}>`;
        // a rawtext element owns everything to its closing tag — no child
        // parsing, no frame; its content is ONE inert text node either way
        if (!el.foreign && RAWTEXT.has(el.tag)) {
          this.el = null;
          return this.scanRawText(el, s, i + 1, p);
        }
        // foreign content has no void elements: <circle> still needs </circle>
        if (el.foreign || !VOID.has(el.tag)) {
          this.stack.push({
            tag: el.tag,
            emit: el.emit,
            path: el.path,
            count: 0,
            origin: el.origin, // carried so "unclosed <div>" can point at the `<`
            // an HTML integration point hands its children back to HTML rules
            foreign: el.foreign && !INTEGRATION.has(el.tag),
          });
        }
        this.el = null;
        return i + 1;
      }

      if (ch === '/') {
        if (s[i + 1] !== '>') this.fail(`stray "/" in <${el.tag}>`, p, i);
        // in foreign content `/>` really does close the element, for any tag
        if (!el.foreign && !VOID.has(el.tag)) {
          this.fail(
            `<${el.tag}/> — self-closing is only valid on void elements; write </${el.tag}>`,
            p,
            i, // the offending "/"
          );
        }
        this.sealTag(el);
        this.html += `<${el.emit}${el.attrs}${el.foreign ? '/' : ''}>`;
        this.el = null;
        return i + 2;
      }

      // attribute name
      const nm = /^[^\s=/>]+/.exec(s.slice(i));
      if (!nm) this.fail(`unexpected character "${ch}" in <${el.tag}>`, p, i);
      // SVG attribute names are case-sensitive at the setAttribute() boundary:
      // `gradientTransform` lowercased is a different, inert attribute
      const name = el.foreign ? nm[0] : nm[0].toLowerCase();
      i += nm[0].length;

      // optional whitespace before '='
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;

      if (j >= s.length || s[j] !== '=') {
        el.attrs += ` ${name}`; // boolean attribute
        i = j;
        continue;
      }

      // has a value
      i = j + 1;
      while (i < s.length && /\s/.test(s[i])) i++;

      if (i >= s.length) {
        // `name=` then part end → unquoted attribute hole
        this.pushAttrHole(el, name, p);
        this.resume = { quote: null };
        return i;
      }

      const q = s[i];
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, i + 1);
        if (close === -1) {
          if (i + 1 === s.length) {
            // `name="` then part end → quoted attribute hole
            this.pushAttrHole(el, name, p);
            this.resume = { quote: q };
            return s.length;
          }
          this.fail('an attribute hole must be the entire quoted value', p, i);
        }
        el.attrs += ` ${name}=${q}${s.slice(i + 1, close)}${q}`;
        i = close + 1;
      } else {
        const vm = /^[^\s/>]+/.exec(s.slice(i));
        if (!vm) this.fail(`missing value for "${name}" in <${el.tag}>`, p, i);
        el.attrs += ` ${name}=${vm[0]}`;
        i += vm[0].length;
      }
    }
    return i;
  }

  /**
   * Consume a rawtext element's content verbatim, up to its EXACT closing
   * tag (`</textarea>` — the strict subset requires the plain form). The
   * content is inert text to the browser, so no tags, comments or holes are
   * parsed inside it. A hole in the content can never track anything — the
   * content is only the element's DEFAULT value — so the error names the
   * cure (bind `value`) instead of describing the mechanism.
   *
   * `<title>` is the exception: it has no property to bind and a server-rendered
   * page needs its title in the markup, so a hole there is recorded as a
   * ContentHole and resumed on the next part. See ir.ts.
   */
  private scanRawText(el: OpenElement, s: string, i: number, p: number): number {
    const close = `</${el.tag}>`;
    const at = s.indexOf(close, i);
    if (at === -1) {
      if (p < this.strings.length - 1) {
        if (el.tag === 'title') {
          this.html += s.slice(i); // boundary() records the hole at this offset
          this.rawText = el;
          return s.length;
        }
        this.fail(
          el.tag === 'textarea'
            ? 'a hole cannot go inside <textarea> — its content is only the DEFAULT value; bind value="${…}" instead'
            : `a hole cannot go inside <${el.tag}> — rawtext content is static`,
          p,
          s.length,
        );
      }
      this.fail(`unclosed <${el.tag}>`, el.origin.part, el.origin.offset);
    }
    this.html += s.slice(i, at) + close;
    this.rawText = null;
    this.textOpen = false;
    return at + close.length;
  }

  /**
   * The open tag is about to be emitted, so the offset of its closing `>`
   * (or the `/` of `/>`) is finally known — back-fill it into every hole this
   * tag recorded. That offset is where the string backend splices serialized
   * attributes in: right at the end of the open tag, which is also the order
   * the DOM backend produces (bound attributes land after static ones).
   */
  private sealTag(el: OpenElement): void {
    const htmlAt = this.html.length + 1 + el.emit.length + el.attrs.length;
    for (let h = el.holeStart; h < this.holes.length; h++) {
      this.holes[h].htmlAt = htmlAt;
    }
  }

  private pushAttrHole(el: OpenElement, name: string, expr: number): void {
    this.failIfInTemplate(expr);
    // event names are always lowercase — addEventListener('Click') is not a
    // click. Attribute names keep whatever casing scanTag decided on.
    // htmlAt is a placeholder until sealTag() — the open tag is still growing.
    const lower = name.toLowerCase();
    if (lower.startsWith('on') && lower.length > 2) {
      this.holes.push({ kind: 'event', expr, name: lower.slice(2), path: [...el.path], htmlAt: 0 });
    } else {
      this.holes.push({ kind: 'attr', expr, name, path: [...el.path], htmlAt: 0, tag: el.tag });
    }
  }
}
