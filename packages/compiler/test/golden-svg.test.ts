// @vitest-environment happy-dom
/**
 * Dual-mode golden test for SVG — foreign content.
 *
 * This is the gate the SVG bug walked through. Raw mode hands the author's
 * markup to the browser's own parser, which applies the foreign-content rules:
 * `<circle r="5"/>` self-closes, `viewBox` keeps its casing. The build-time
 * parser had neither rule, so a template that ran fine with NO BUILD threw the
 * moment it was compiled — a straight violation of LOCKED RULE #3.
 *
 * Structural equality of the two DOM trees is the assertion, not a string
 * compare: what must match is the tree the user ends up with.
 */
import { test, expect, afterAll } from 'vitest';
import { compileModule } from '../src/codegen.js';
import { load, cleanupFixtures } from './harness.js';

afterAll(cleanupFixtures);

const SVG_NS = 'http://www.w3.org/2000/svg';

const FIXTURE = [
  "import { signal, html, mount } from '@amojs.dev/core';",
  "export { flushSync, mount } from '@amojs.dev/core';",
  'export function App() {',
  '  const r = signal(5);',
  '  const label = signal("five");',
  '  let clicks = 0;',
  '  const el = html`<figure>',
  '    <svg viewBox="0 0 20 20" class="chart">',
  '      <title>Chart</title>',
  '      <linearGradient gradientTransform="rotate(90)"><stop/></linearGradient>',
  // NOTE the quotes: an unquoted hole glued to "/>" is a browser-level trap
  '      <circle cx="10" cy="10" r="${r}" onclick="${() => clicks++}"/>',
  '      <text>${label}</text>',
  '      <foreignObject><div>html again</div></foreignObject>',
  '    </svg>',
  '    <figcaption>${label}</figcaption>',
  '  </figure>`;',
  '  return { el, r, label, clicks: () => clicks };',
  '}',
].join('\n');

/** the shape that must be identical in both modes */
function shape(node: Node): unknown {
  if (node.nodeType === 3) return { text: (node as Text).data };
  if (node.nodeType === 8) return { comment: (node as Comment).data };
  const el = node as Element;
  return {
    // localName, not tagName: it preserves the SVG casing that HTMLElement
    // uppercases, and namespaceURI is what proves foreign content was entered
    name: el.localName,
    ns: el.namespaceURI,
    attrs: [...el.attributes]
      .map((a) => `${a.name}=${a.value}`)
      .sort()
      .join(' '),
    kids: [...el.childNodes].map(shape),
  };
}

async function run(src: string) {
  const mod = await load(src);
  const { el, r, label, clicks } = mod.App();
  mod.mount(el, document.body);

  const initial = shape(el);
  r.value = 9;
  label.value = 'nine';
  mod.flushSync();

  const svg = el.querySelector('svg');
  const circle = el.querySelector('circle');
  circle.dispatchEvent(new Event('click'));

  return {
    initial,
    updated: shape(el),
    // the attributes SVG is case-sensitive about, read the way SVG reads them
    viewBox: svg.getAttribute('viewBox'),
    gradientTransform: el.querySelector('linearGradient').getAttribute('gradientTransform'),
    // the reactive attr hole must land on the real, namespaced attribute
    r: circle.getAttribute('r'),
    svgNs: svg.namespaceURI,
    circleNs: circle.namespaceURI,
    clicks: clicks(),
  };
}

test('GOLDEN svg: raw and compiled produce the identical tree', async () => {
  const compiled = compileModule(FIXTURE);
  expect(compiled).not.toContain('html`');
  // the self-closing slash must survive compilation, or the reparse nests wrong
  expect(compiled).toContain('<circle cx=\\"10\\" cy=\\"10\\"/>');

  const raw = await run(FIXTURE);
  const cmp = await run(compiled);

  expect(cmp).toEqual(raw);

  // and the tree is actually right, not merely identical
  expect(raw.svgNs).toBe(SVG_NS);
  expect(raw.circleNs).toBe(SVG_NS);
  expect(raw.viewBox).toBe('0 0 20 20');
  expect(raw.gradientTransform).toBe('rotate(90)');
  expect(raw.r).toBe('9'); // the signal drove a namespaced attribute
  expect(raw.clicks).toBe(1); // an event hole works on an SVG element
});

test('a self-closed svg element does not swallow its siblings', async () => {
  // the failure this guards: emitting `<circle>` without the slash makes the
  // reparse treat every later sibling as a CHILD, so all their paths shift
  const src = [
    "import { html } from '@amojs.dev/core';",
    'export const make = (a, b) =>',
    '  html`<svg><circle r="${a}"/><text>${b}</text></svg>`;',
  ].join('\n');

  const rawMod = await load(src);
  const cmpMod = await load(compileModule(src));

  for (const mod of [rawMod, cmpMod]) {
    const svg = mod.make('4', 'hi');
    expect(svg.localName).toBe('svg');
    // circle and text are SIBLINGS
    expect([...svg.children].map((c: Element) => c.localName)).toEqual(['circle', 'text']);
    expect(svg.querySelector('circle').getAttribute('r')).toBe('4');
    expect(svg.querySelector('text').textContent).toBe('hi');
  }
});

/* ------------------------------------------------------------------ */

const DOT = [
  "import { signal, html, svg } from '@amojs.dev/core';",
  "export { flushSync } from '@amojs.dev/core';",
  'export function Chart() {',
  '  const r = signal(3);',
  '  const Dot = () => svg`<circle cx="5" cy="5" r="${r}" onclick="${() => r.value++}"/>`;',
  '  return html`<svg viewBox="0 0 10 10">${Dot()}<g>${svg`<rect width="${r}" height="2"/>`}</g></svg>`;',
  '}',
].join('\n');

async function runDot(src: string) {
  const mod = await load(src);
  const el = mod.Chart();
  document.body.append(el);
  const c = el.querySelector('circle');
  const rect = el.querySelector('rect');
  const snap = () => ({
    ns: c.namespaceURI,
    rns: rect.namespaceURI,
    r: c.getAttribute('r'),
    w: rect.getAttribute('width'),
    vb: el.getAttribute('viewBox'),
  });
  const s0 = snap();
  c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  mod.flushSync();
  return [s0, snap()];
}

test('GOLDEN svg``: a component rooted at an SVG element lands in the SVG namespace in both modes', async () => {
  const compiled = compileModule(DOT);
  expect(compiled).toContain(', 1);'); // the svg flag on the hoisted templates
  expect(compiled).not.toContain('svg`');
  const raw = await runDot(DOT);
  const cmp = await runDot(compiled);
  expect(cmp).toEqual(raw);
  expect(raw[0]).toEqual({
    ns: 'http://www.w3.org/2000/svg',
    rns: 'http://www.w3.org/2000/svg',
    r: '3',
    w: '3',
    vb: '0 0 10 10',
  });
  expect(raw[1].r).toBe('4');
  expect(raw[1].w).toBe('4');
});
