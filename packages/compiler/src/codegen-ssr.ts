/**
 * Server codegen — TemplateIR → string concatenation.
 *
 * The second backend over the same IR, and the proof that LOCKED RULE #4
 * held: nothing here names a DOM API. Server output is STATIC HTML for the
 * islands model (never hydration): no comment markers, no part boundaries,
 * no serialized state — interactive islands rebuild their own DOM on the
 * client, so the string needs to carry nothing but markup.
 *
 * THE RETURN VALUE IS THE PUBLIC CONTRACT of the server target. A template
 * evaluates to `{ __amoHtml, toString() }`, so a request handler needs nothing
 * of ours at runtime — `'<!doctype html>\n' + await page(props)` is the whole
 * of request-time SSR, and a production server installs no AmoJS package. The
 * field stays for code that wants to check the shape (ssgDir does); `toString`
 * is what a human writes. Serving the CLIENT build by mistake cannot pass
 * silently: DOM-target code calls `document.createElement` and node throws.
 *
 * Escaping (the whole of it — deliberately small and in ONE place):
 *   text position       & <        (what Svelte escapes)
 *   attribute position  & " <      (the `<` matters: Solid skips it and
 *                                   documented the resulting mXSS instead)
 * Static parts are emitted verbatim — both modes feed the same characters to
 * the same browser parser, so verbatim IS parity. Every replacement uses a
 * function, never a string (a `$&` in user input must stay literal).
 *
 * Hole semantics mirror bind.js evaluated ONCE:
 *   signal → .value · function → call · else → the value itself
 *   child: template result → spliced raw · array → members must be template
 *          results · else → escaped text (null/undefined/false → '')
 *   attr:  null/undefined/false → omitted · true → name="" · else → string
 *   event: evaluated for the same non-function throw, emits nothing
 *
 * The four property names bind.js writes as live properties have no uniform
 * HTML serialization, so the SERVER target special-cases them per element,
 * the way every string renderer ends up doing:
 *   value    input/option/button/progress/meter/… → a value attribute
 *            textarea → the element's CONTENT (replacing the static default)
 *   (a ContentHole — `<title>${x}</title>` — is escaped text at an offset, and
 *    is the one hole the DOM backend rejects instead: see ir.ts)
 *            select   → compile error (put selected=${…} on the option)
 *   checked  input  → bare attribute when truthy, nothing when falsy
 *   selected option → same
 *   indeterminate   → compile error (property-only; no markup can express it)
 *   ref             → skipped — there is no element to hand over
 */

import type { TemplateIR } from './ir.js';
import { TemplateError } from './template.js';

/** helpers injected once per compiled module — see the header comment */
export const SSR_PREAMBLE = `/* amo ssr helpers — one escape function per position, evaluate once */
const _$et = (s) => s.replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'));
const _$ea = (s) =>
  s.replace(/[&"<]/g, (c) => (c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&lt;'));
const _$txt = (v) => (v == null || v === false ? '' : String(v));
const _$u = (v) => (_$is(v) ? v.value : typeof v === 'function' ? v() : v);
const _$h = (h) => ({ __amoHtml: h, toString: () => h });
const _$c = (v) => {
  v = _$u(v);
  if (v && typeof v.__amoHtml === 'string') return v.__amoHtml;
  if (Array.isArray(v))
    return v
      .map((n) => {
        if (!n || typeof n.__amoHtml !== 'string')
          throw new Error('amo: array holes take non-fragment nodes only');
        return n.__amoHtml;
      })
      .join('');
  return _$et(_$txt(v));
};
const _$a = (n, v) => {
  v = _$u(v);
  return v == null || v === false
    ? ''
    : ' ' + n + '="' + _$ea(v === true ? '' : String(v)) + '"';
};
const _$b = (n, v) => (_$u(v) ? ' ' + n + '=""' : '');
const _$v = (v) => ' value="' + _$ea(_$txt(_$u(v))) + '"';
const _$ta = (v) => _$et(_$txt(_$u(v)));
const _$e = (n, v) => {
  if (typeof v !== 'function')
    throw new Error(
      'amo: on' + n + ' needs a function, not a ' + (_$is(v) ? 'signal' : typeof v),
    );
  return '';
};`;

/** elements where bind.js writes `value` as a property and the attribute is
 *  the parsed default — serializing the attribute reproduces the state */
const VALUE_ATTR_TAGS = new Set([
  'input', 'option', 'button', 'progress', 'meter', 'output', 'li', 'data', 'param',
]);

const MARKER = '<!---->';

interface Splice {
  at: number;
  len: number;
  code: string;
}

/** the expression that replaces one html`` call in the server target */
export function generateServer(
  ir: TemplateIR,
  exprs: string[],
  strings: readonly string[],
): string {
  // mirror the DOM backend's static unwrap: a single root element is all the
  // caller ever receives, so root-level whitespace must not reach the output
  const rootChildHole = ir.holes.some((h) => h.kind === 'child' && h.path.length === 1);
  let html = ir.html;
  let base = 0;
  if (ir.singleRootIndex !== null && !rootChildHole) {
    const start = html.search(/\S/);
    if (start > 0) base = start;
    html = html.slice(base, html.replace(/\s+$/, '').length);
  }

  const splices: Splice[] = [];
  for (const h of ir.holes) {
    const e = exprs[h.expr];
    if (h.kind === 'child') {
      splices.push({ at: h.htmlAt - base, len: MARKER.length, code: `_$c(${e})` });
    } else if (h.kind === 'content') {
      // rawtext content: escaped text at an insertion point (<title> only)
      splices.push({ at: h.htmlAt - base, len: 0, code: `_$ta(${e})` });
    } else if (h.kind === 'event') {
      splices.push({ at: h.htmlAt - base, len: 0, code: `_$e(${JSON.stringify(h.name)}, ${e})` });
    } else if (h.name === 'ref') {
      // nothing to hand over on the server — refs run where elements exist
    } else if (h.name === 'value' && h.tag === 'select') {
      throw new TemplateError(
        'server target: <select value=${…}> has no HTML serialization — put selected=${…} on the matching <option>',
        h.expr,
        strings[h.expr].length,
      );
    } else if (h.name === 'indeterminate' && h.tag === 'input') {
      throw new TemplateError(
        'server target: indeterminate has no HTML serialization — set it from an island after mount',
        h.expr,
        strings[h.expr].length,
      );
    } else if (h.name === 'value' && h.tag === 'textarea') {
      // the value IS the content in markup — replace the static default,
      // which the DOM backend keeps only as the never-shown fallback
      const close = ir.html.indexOf('</textarea>', h.htmlAt);
      splices.push({
        at: h.htmlAt - base + 1,
        len: close - (h.htmlAt + 1),
        code: `_$ta(${e})`,
      });
    } else if (h.name === 'value' && VALUE_ATTR_TAGS.has(h.tag)) {
      splices.push({ at: h.htmlAt - base, len: 0, code: `_$v(${e})` });
    } else if ((h.name === 'checked' && h.tag === 'input') || (h.name === 'selected' && h.tag === 'option')) {
      splices.push({ at: h.htmlAt - base, len: 0, code: `_$b(${JSON.stringify(h.name)}, ${e})` });
    } else {
      splices.push({ at: h.htmlAt - base, len: 0, code: `_$a(${JSON.stringify(h.name)}, ${e})` });
    }
  }
  splices.sort((a, b) => a.at - b.at); // stable: same-offset splices keep source order

  const parts: string[] = [];
  let cursor = 0;
  for (const s of splices) {
    if (s.at > cursor) parts.push(JSON.stringify(html.slice(cursor, s.at)));
    parts.push(s.code);
    cursor = Math.max(cursor, s.at + s.len);
  }
  if (cursor < html.length) parts.push(JSON.stringify(html.slice(cursor)));
  if (parts.length === 0) parts.push('""');

  return `_$h(${parts.join(' + ')})`;
}
