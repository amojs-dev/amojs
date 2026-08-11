/**
 * diagnose() — the editor-facing entry point.
 *
 * Assertions here check the TEXT the reported range covers, not raw numbers:
 * an off-by-one is invisible in a number and obvious in a slice.
 */
import { test, expect } from 'vitest';
import { diagnose } from '../src/diagnose.js';

/** what a squiggle would actually underline */
const marked = (src: string) =>
  diagnose(src).map((d) => ({ message: d.message, text: src.slice(d.start, d.end), exact: d.exact }));

const IMPORT = "import { html } from '@amojs.dev/core';\n";

test('a clean file reports nothing', () => {
  expect(diagnose(`${IMPORT}export const el = html\`<p>hi</p>\`;`)).toEqual([]);
  expect(diagnose(`${IMPORT}export const el = html\`<div><span>\${x}</span></div>\`;`)).toEqual([]);
});

test('a file that does not import amojs reports nothing', () => {
  // someone else's html`` is not ours to judge — locked rule #8
  expect(diagnose("import { html } from 'lit';\nconst el = html`<div>`;")).toEqual([]);
  expect(diagnose('const el = `<div>`;')).toEqual([]);
});

test('invalid JavaScript reports nothing — the JS service already does', () => {
  expect(diagnose(`${IMPORT}const el = html\`<p></p>\`; function (`)).toEqual([]);
  expect(diagnose('this is not javascript at all ===')).toEqual([]);
});

test('a genuinely unclosed element underlines the tag that opened it', () => {
  expect(marked(`${IMPORT}const el = html\`<div><p>hi</p>\`;`)).toEqual([
    { message: 'unclosed <div>', text: '<div>', exact: true },
  ]);
});

test('a wrongly nested close is reported where it appears', () => {
  // NOTE the parser's own wording: it names the close it did not expect, rather
  // than the <p> left open. That is compiler behaviour and the compiler is the
  // authority (LOCKED RULE #3) — diagnose only places the message, it does not
  // second-guess it. Improving the wording is a compiler change, not this one.
  expect(marked(`${IMPORT}const el = html\`<div><p>hi</div>\`;`)).toEqual([
    { message: 'unexpected </div>', text: '</div>', exact: true },
  ]);
});

test('a mismatched closing tag underlines the closing tag', () => {
  expect(marked(`${IMPORT}const el = html\`<div></span>\`;`)).toEqual([
    { message: 'unexpected </span>', text: '</span>', exact: true },
  ]);
});

test('self-closing a non-void element underlines the slash', () => {
  const out = marked(`${IMPORT}const el = html\`<div/>\`;`);
  expect(out[0].message).toMatch(/self-closing is only valid on void elements/);
  expect(out[0].text).toBe('/>');
});

test('static rawtext content is legal; a hole inside it underlines the hole', () => {
  // static content: no diagnostics at all (rawtext is supported since the
  // gallery/probe round — state binds through value="${…}")
  expect(marked(`${IMPORT}const el = html\`<script>a</script>\`;`)).toEqual([]);

  const out = marked(`${IMPORT}const el = html\`<textarea>\${x}</textarea>\`;`);
  expect(out).toHaveLength(1);
  expect(out[0].message).toMatch(/bind value="\$\{…\}" instead/);
  expect(out[0].text).toBe('${x}'); // the hole, per the part-end convention
});

test('a dynamic <title> is NOT reported — legality depends on the build target', () => {
  // valid for the server target; the DOM target rejects it at build time. The
  // file does not say which target it is built with, so the editor stays quiet
  // rather than squiggle a correct SSR page.
  expect(marked(`${IMPORT}const el = html\`<title>\${x}</title>\`;`)).toEqual([]);
});

test('a partial attribute value underlines where the value continues', () => {
  const out = marked(`${IMPORT}const el = html\`<div class="a\${x}">t</div>\`;`);
  expect(out[0].message).toMatch(/entire quoted value/);
  expect(out[0].exact).toBe(true);
});

test('an unquoted hole glued to /> underlines the slash', () => {
  const out = marked(`${IMPORT}const el = html\`<svg><circle r=\${n}/></svg>\`;`);
  expect(out[0].message).toMatch(/cannot be followed by/);
  expect(out[0].text).toBe('/>');
});

test('a hole in an illegal position underlines the HOLE, not the space before it', () => {
  const out = marked(`${IMPORT}const el = html\`<div \${x}>t</div>\`;`);
  expect(out[0].message).toMatch(/full attribute value/);
  expect(out[0].text).toBe('${x}');
});

test('the range is inside the template, never outside it', () => {
  const src = `${IMPORT}const el = html\`<div><p>hi</div>\`;`;
  const [d] = diagnose(src);
  const tick = src.indexOf('`');
  const close = src.lastIndexOf('`');
  expect(d.start).toBeGreaterThan(tick);
  expect(d.end).toBeLessThanOrEqual(close);
});

test('several broken templates each report once', () => {
  const src = [
    IMPORT,
    'export const a = html`<div>`;',
    'export const b = html`<p>ok</p>`;',
    'export const c = html`<span></div>`;',
  ].join('\n');
  const out = marked(src);
  expect(out).toHaveLength(2);
  expect(out[0]).toEqual({ message: 'unclosed <div>', text: '<div>', exact: true });
  expect(out[1]).toEqual({ message: 'unexpected </div>', text: '</div>', exact: true });
});

test('a nested template is diagnosed too', () => {
  const out = marked(`${IMPORT}const el = html\`<ul>\${html\`<li>x\`}</ul>\`;`);
  expect(out.some((d) => d.message === 'unclosed <li>')).toBe(true);
});

test('an error after a hole still lands in the right part', () => {
  // the second static part, so the offset must be added to THAT quasi
  const out = marked(`${IMPORT}const el = html\`<div>\${x}</span>\`;`);
  expect(out).toEqual([{ message: 'unexpected </span>', text: '</span>', exact: true }]);
});

test('an escape in the template widens the range instead of mis-placing it', () => {
  // cooked counts \` as one char, the source spends two — precise mapping would
  // silently drift, so the whole static part is marked and exact is false
  const src = `${IMPORT}const el = html\`a\\\`b<div>\`;`;
  const [d] = diagnose(src);
  expect(d.message).toBe('unclosed <div>');
  expect(d.exact).toBe(false);
  expect(src.slice(d.start, d.end)).toBe('a\\`b<div>');
});

test('diagnose never throws on a template it cannot understand', () => {
  for (const body of ['<', '</', '<>', '<div', '<div class=', '<!--', '${x}', '']) {
    expect(() => diagnose(`${IMPORT}const el = html\`${body}\`;`)).not.toThrow();
  }
});
