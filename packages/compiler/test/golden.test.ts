// @vitest-environment happy-dom
/**
 * THE dual-mode golden tests — LOCKED RULE #3 made executable.
 *
 * Each fixture module is executed twice: once as written (raw mode — the
 * browser parses html`` at runtime) and once through compileModule (compiled
 * mode — no template parsing left). Every observable behavior must be
 * identical. Fixtures are written to a temp dir outside the project so node
 * imports them natively, exactly like a browser would load raw ESM.
 */
import { test, expect, afterAll } from 'vitest';
import { compileModule } from '../src/codegen.js';
import { load, cleanupFixtures } from './harness.js';

afterAll(cleanupFixtures);

/* ------------------------------------------------------------------ */

const COUNTER = [
  "import { signal, computed, html } from '@amojs/core';",
  "export { flushSync } from '@amojs/core';",
  'export function Counter() {',
  '  const count = signal(0);',
  '  const double = computed(() => count.value * 2);',
  '  return html`<button class="btn" onclick=${() => count.value++}>c:${count}|${double}</button>`;',
  '}',
].join('\n');

async function runCounter(src: string) {
  const mod = await load(src);
  const el = mod.Counter();
  document.body.append(el);
  const snaps = [el.textContent];
  el.click();
  mod.flushSync();
  snaps.push(el.textContent);
  el.click();
  el.click();
  mod.flushSync();
  snaps.push(el.textContent);
  return { snaps, tag: el.tagName, cls: el.getAttribute('class') };
}

test('GOLDEN counter: raw and compiled behave identically', async () => {
  const compiled = compileModule(COUNTER);
  expect(compiled).not.toContain('html`');

  const raw = await runCounter(COUNTER);
  const cmp = await runCounter(compiled);

  expect(cmp).toEqual(raw);
  expect(raw.snaps).toEqual(['c:0|0', 'c:1|2', 'c:3|6']); // sanity, not just parity
  expect(raw.tag).toBe('BUTTON');
  expect(raw.cls).toBe('btn');
});

/* ------------------------------------------------------------------ */

const TOGGLE = [
  "import { signal, html } from '@amojs/core';",
  "export { flushSync } from '@amojs/core';",
  'export function Box() {',
  '  const on = signal(false);',
  // disabled goes on a SIBLING input — a disabled button would stop firing clicks
  '  return html`<div><button onclick=${() => (on.value = !on.value)}>t</button><input disabled=${on}>|${() => (on.value ? "ON" : "off")}</div>`;',
  '}',
].join('\n');

async function runToggle(src: string) {
  const mod = await load(src);
  const el = mod.Box();
  document.body.append(el);
  const btn = el.querySelector('button');
  const input = el.querySelector('input');
  const snap = () => ({
    disabled: input.hasAttribute('disabled'),
    text: el.textContent,
  });
  const s0 = snap();
  btn.click();
  mod.flushSync();
  const s1 = snap();
  btn.click();
  mod.flushSync();
  return [s0, s1, snap()];
}

test('GOLDEN attr + function holes: raw and compiled behave identically', async () => {
  const compiled = compileModule(TOGGLE);
  const raw = await runToggle(TOGGLE);
  const cmp = await runToggle(compiled);

  expect(cmp).toEqual(raw);
  expect(raw).toEqual([
    { disabled: false, text: 't|off' },
    { disabled: true, text: 't|ON' },
    { disabled: false, text: 't|off' },
  ]);
});

/* ------------------------------------------------------------------ */

const NESTED = [
  "import { html } from '@amojs/core';",
  'export function Wrap() {',
  '  return html`<div>[${html`<em>in</em>`}]</div>`;',
  '}',
].join('\n');

/* ------------------------------------------------------------------ */

const SHIFT = [
  "import { signal, html } from '@amojs/core';",
  "export { flushSync } from '@amojs/core';",
  'export function App() {',
  '  const a = html`<i>a</i>`;',
  '  const b = html`<i>b</i>`;',
  "  const cls = signal('target');",
  '  // the child hole expands ONE placeholder into TWO nodes, shifting the',
  '  // child index of every later sibling — the attr hole must still land on',
  '  // the <span>, not on whichever node moved into its old slot',
  '  const el = html`<div>${[a, b]}<span class=${cls}>x</span></div>`;',
  '  return { el, cls };',
  '}',
].join('\n');

test('GOLDEN a multi-node child hole must not shift its siblings’ bindings', async () => {
  const compiled = compileModule(SHIFT);

  const run = async (src: string) => {
    const mod = await load(src);
    const { el, cls } = mod.App();
    const snap = () =>
      [...el.children].map((c: Element) => `${c.tagName}:${c.getAttribute('class') ?? '-'}`);
    const before = snap();
    cls.value = 'changed';
    mod.flushSync();
    return { before, after: snap(), html: el.innerHTML };
  };

  const raw = await run(SHIFT);
  const cmp = await run(compiled);

  expect(cmp).toEqual(raw);
  // raw mode used to put the class on <i>b</i> — compiled mode never did, so
  // the two modes had silently diverged
  expect(raw.before).toEqual(['I:-', 'I:-', 'SPAN:target']);
  expect(raw.after).toEqual(['I:-', 'I:-', 'SPAN:changed']);
});

test('GOLDEN nested templates: raw and compiled produce the same markup', async () => {
  const compiled = compileModule(NESTED);
  expect(compiled).not.toContain('html`');

  const rawEl = (await load(NESTED)).Wrap();
  const cmpEl = (await load(compiled)).Wrap();

  expect(cmpEl.innerHTML).toBe(rawEl.innerHTML);
  expect(rawEl.innerHTML).toBe('[<em>in</em>]');
});
