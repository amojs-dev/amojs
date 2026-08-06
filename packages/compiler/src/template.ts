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
 *   - rawtext elements (script/style/textarea/title) are not allowed
 *   - an attribute hole must be the entire attribute value
 *   - holes cannot appear in tag-name or attribute-name position
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

interface Frame {
  tag: string;
  /** the name as emitted — a closing tag must spell it the same way */
  emit: string;
  path: NodePath;
  /** child nodes assigned so far: elements, text runs, comments, placeholders */
  count: number;
  /** are this frame's CHILDREN in foreign content? */
  foreign: boolean;
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
}

export function parseTemplate(strings: readonly string[]): TemplateIR {
  return new Parser(strings).parse();
}

class Parser {
  private html = '';
  private holes: Hole[] = [];
  private stack: Frame[] = [
    { tag: '#root', emit: '#root', path: [], count: 0, foreign: false },
  ];
  /** true while inside a contiguous static text run (one text node) */
  private textOpen = false;
  /** non-null while scanning inside an open tag `<div …` */
  private el: OpenElement | null = null;
  /** set when a part ended in an attribute-value hole; consumed at next part */
  private resume: { quote: string | null } | null = null;
  /** root-level bookkeeping for the static unwrap decision */
  private rootElements = 0;
  private rootElementIndex = -1;
  private rootOther = false;

  constructor(private readonly strings: readonly string[]) {}

  private top(): Frame {
    return this.stack[this.stack.length - 1];
  }

  private fail(msg: string, part: number): never {
    throw new Error(`amo compiler: ${msg} (template part ${part})`);
  }

  parse(): TemplateIR {
    for (let p = 0; p < this.strings.length; p++) {
      const s = this.strings[p];
      let i = 0;

      if (this.resume) {
        // re-entering right after an attribute-value hole
        if (this.resume.quote !== null) {
          if (s[i] !== this.resume.quote) {
            this.fail('an attribute hole must be the entire quoted value', p);
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
          );
        } else if (i < s.length && !/[\s>]/.test(s[i])) {
          this.fail('an attribute hole must be the entire attribute value', p);
        } else if (i >= s.length && p < this.strings.length - 1) {
          this.fail('two holes cannot sit together inside a tag', p);
        }
        this.resume = null;
      }

      while (i < s.length) {
        i = this.el ? this.scanTag(s, i, p) : this.scanText(s, i, p);
      }

      if (p < this.strings.length - 1) this.boundary(p);
    }

    if (this.el) this.fail(`template ends inside <${this.el.tag}>`, this.strings.length - 1);
    if (this.stack.length > 1) {
      this.fail(`unclosed <${this.top().tag}>`, this.strings.length - 1);
    }
    const singleRootIndex =
      this.rootElements === 1 && !this.rootOther ? this.rootElementIndex : null;
    return { html: this.html, holes: this.holes, singleRootIndex };
  }

  /** A part boundary is a hole. Legal only in text position or as a full attr value. */
  private boundary(p: number): void {
    if (this.resume) return; // attribute-value hole — already recorded by scanTag
    if (this.el) {
      this.fail('a hole may only be an element child or a full attribute value', p);
    }
    const f = this.top();
    this.textOpen = false;
    // an empty comment marks the spot: it keeps adjacent static text nodes
    // apart through serialize→parse, so NodePaths stay valid. Consumers swap
    // it for an empty text node (see amojs/compiled tpl()).
    this.html += '<!---->';
    this.holes.push({ kind: 'child', expr: p, path: [...f.path, f.count++] });
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
        if (!m) this.fail('malformed closing tag', p);
        const tag = m[1].toLowerCase();
        if (this.stack.length === 1 || this.top().tag !== tag) {
          this.fail(`unexpected </${tag}>`, p);
        }
        this.textOpen = false;
        // spell the close exactly like the open — a foreign name kept its casing
        this.html += `</${(this.stack.pop() as Frame).emit}>`;
        i += m[0].length;
        continue;
      }

      if (s.startsWith('<!--', i)) {
        const end = s.indexOf('-->', i + 4);
        if (end === -1) this.fail('a hole cannot appear inside a comment', p);
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
        if (!m) this.fail('malformed tag', p);
        const tag = m[1].toLowerCase();
        const parent = this.top();
        // an <svg>/<math> anywhere opens foreign content; inside it, rawtext
        // does not exist — <svg><title>Chart</title></svg> is ordinary markup
        const foreign = parent.foreign || FOREIGN_ROOTS.has(tag);
        if (!foreign && RAWTEXT.has(tag)) {
          this.fail(`<${tag}> is not supported inside templates`, p);
        }
        this.textOpen = false;
        const path = [...parent.path, parent.count++];
        if (this.stack.length === 1) {
          this.rootElements++;
          this.rootElementIndex = path[0];
        }
        // casing survives only in foreign content, where names are meaningful
        this.el = { tag, emit: foreign ? m[1] : tag, path, attrs: '', foreign };
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
        this.html += `<${el.emit}${el.attrs}>`;
        // foreign content has no void elements: <circle> still needs </circle>
        if (el.foreign || !VOID.has(el.tag)) {
          this.stack.push({
            tag: el.tag,
            emit: el.emit,
            path: el.path,
            count: 0,
            // an HTML integration point hands its children back to HTML rules
            foreign: el.foreign && !INTEGRATION.has(el.tag),
          });
        }
        this.el = null;
        return i + 1;
      }

      if (ch === '/') {
        if (s[i + 1] !== '>') this.fail(`stray "/" in <${el.tag}>`, p);
        // in foreign content `/>` really does close the element, for any tag
        if (!el.foreign && !VOID.has(el.tag)) {
          this.fail(
            `<${el.tag}/> — self-closing is only valid on void elements; write </${el.tag}>`,
            p,
          );
        }
        this.html += `<${el.emit}${el.attrs}${el.foreign ? '/' : ''}>`;
        this.el = null;
        return i + 2;
      }

      // attribute name
      const nm = /^[^\s=/>]+/.exec(s.slice(i));
      if (!nm) this.fail(`unexpected character "${ch}" in <${el.tag}>`, p);
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
          this.fail('an attribute hole must be the entire quoted value', p);
        }
        el.attrs += ` ${name}=${q}${s.slice(i + 1, close)}${q}`;
        i = close + 1;
      } else {
        const vm = /^[^\s/>]+/.exec(s.slice(i));
        if (!vm) this.fail(`missing value for "${name}" in <${el.tag}>`, p);
        el.attrs += ` ${name}=${vm[0]}`;
        i += vm[0].length;
      }
    }
    return i;
  }

  private pushAttrHole(el: OpenElement, name: string, expr: number): void {
    // event names are always lowercase — addEventListener('Click') is not a
    // click. Attribute names keep whatever casing scanTag decided on.
    const lower = name.toLowerCase();
    if (lower.startsWith('on') && lower.length > 2) {
      this.holes.push({ kind: 'event', expr, name: lower.slice(2), path: [...el.path] });
    } else {
      this.holes.push({ kind: 'attr', expr, name, path: [...el.path] });
    }
  }
}
