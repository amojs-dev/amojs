/**
 * Build-time template parser — the static strings of a detected `html` tag
 * become a TemplateIR: static markup + holes with positional paths.
 *
 * Semantics mirror the runtime parser in @amojs/core (html.js) — the runtime
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
 */

import type { TemplateIR, Hole, NodePath } from './ir.js';

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAWTEXT = new Set(['script', 'style', 'textarea', 'title']);

interface Frame {
  tag: string;
  path: NodePath;
  /** child nodes assigned so far: elements, text runs, comments, placeholders */
  count: number;
}

interface OpenElement {
  tag: string;
  path: NodePath;
  /** canonical serialization of the attributes seen so far */
  attrs: string;
}

export function parseTemplate(strings: readonly string[]): TemplateIR {
  return new Parser(strings).parse();
}

class Parser {
  private html = '';
  private holes: Hole[] = [];
  private stack: Frame[] = [{ tag: '#root', path: [], count: 0 }];
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
        } else if (i < s.length && !/[\s/>]/.test(s[i])) {
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
    // it for an empty text node (see @amojs/core/compiled tpl()).
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
        this.stack.pop();
        this.html += `</${tag}>`;
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
        if (RAWTEXT.has(tag)) {
          this.fail(`<${tag}> is not supported inside templates`, p);
        }
        this.textOpen = false;
        const parent = this.top();
        const path = [...parent.path, parent.count++];
        if (this.stack.length === 1) {
          this.rootElements++;
          this.rootElementIndex = path[0];
        }
        this.el = { tag, path, attrs: '' };
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
        this.html += `<${el.tag}${el.attrs}>`;
        if (!VOID.has(el.tag)) {
          this.stack.push({ tag: el.tag, path: el.path, count: 0 });
        }
        this.el = null;
        return i + 1;
      }

      if (ch === '/') {
        if (s[i + 1] !== '>') this.fail(`stray "/" in <${el.tag}>`, p);
        if (!VOID.has(el.tag)) {
          this.fail(
            `<${el.tag}/> — self-closing is only valid on void elements; write </${el.tag}>`,
            p,
          );
        }
        this.html += `<${el.tag}${el.attrs}>`;
        this.el = null;
        return i + 2;
      }

      // attribute name
      const nm = /^[^\s=/>]+/.exec(s.slice(i));
      if (!nm) this.fail(`unexpected character "${ch}" in <${el.tag}>`, p);
      const name = nm[0].toLowerCase();
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
    if (name.startsWith('on') && name.length > 2) {
      this.holes.push({ kind: 'event', expr, name: name.slice(2), path: [...el.path] });
    } else {
      this.holes.push({ kind: 'attr', expr, name, path: [...el.path] });
    }
  }
}
