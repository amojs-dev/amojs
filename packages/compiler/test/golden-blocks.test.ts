// @vitest-environment happy-dom
/**
 * Dual-mode golden tests for v0.3 blocks: conditionals + keyed lists.
 * The compiler generates calls to the SAME bindChild the raw mode uses, so
 * blocks must work in both modes with zero compiler changes — these tests
 * are the proof.
 */
import { test, expect, afterAll } from 'vitest';
import { compileModule } from '../src/codegen.js';
import { load, cleanupFixtures } from './harness.js';

afterAll(cleanupFixtures);

const COND = [
  "import { signal, html } from 'amojs';",
  "export { flushSync } from 'amojs';",
  'export function App() {',
  '  const on = signal(true);',
  '  const el = html`<div><button onclick=${() => (on.value = !on.value)}>t</button>${() => (on.value ? html`<b>YES</b>` : html`<i>no</i>`)}</div>`;',
  '  return el;',
  '}',
].join('\n');

async function runCond(src: string) {
  const mod = await load(src);
  const el = mod.App();
  document.body.append(el);
  const btn = el.querySelector('button');
  const snaps = [el.innerHTML];
  btn.click();
  mod.flushSync();
  snaps.push(el.innerHTML);
  btn.click();
  mod.flushSync();
  snaps.push(el.innerHTML);
  return snaps;
}

test('GOLDEN conditional block: raw and compiled behave identically', async () => {
  const compiled = compileModule(COND);
  expect(compiled).not.toContain('html`');
  const raw = await runCond(COND);
  const cmp = await runCond(compiled);
  expect(cmp).toEqual(raw);
  expect(raw[0]).toContain('<b>YES</b>');
  expect(raw[1]).toContain('<i>no</i>');
  expect(raw[2]).toContain('<b>YES</b>');
});

const LIST = [
  "import { signal, html, each } from 'amojs';",
  "export { flushSync } from 'amojs';",
  'export function App() {',
  '  const items = signal([1, 2, 3]);',
  '  const el = html`<ul>${each(items, (k) => k, (k) => html`<li>${String(k)}</li>`)}</ul>`;',
  '  return { el, set: (v) => (items.value = v) };',
  '}',
].join('\n');

async function runList(src: string) {
  const mod = await load(src);
  const { el, set } = mod.App();
  document.body.append(el);
  const texts = () => [...el.children].map((li: Element) => li.textContent);
  const out: unknown[] = [texts()];

  const before = [...el.children];
  set([3, 1, 2]); // reorder — same keys
  mod.flushSync();
  out.push(texts());
  // identity check stays within one mode: same nodes, just moved
  out.push(before.every((li: Element) => [...el.children].includes(li)));

  set([3, 9]);
  mod.flushSync();
  out.push(texts());
  set([]);
  mod.flushSync();
  out.push(texts());
  return out;
}

test('GOLDEN keyed list: raw and compiled behave identically', async () => {
  const compiled = compileModule(LIST);
  expect(compiled).not.toContain('html`');
  expect(compiled).toContain("import { signal, each } from 'amojs/runtime';"); // html stripped, each kept, parser-free entry
  const raw = await runList(LIST);
  const cmp = await runList(compiled);
  expect(cmp).toEqual(raw);
  expect(raw).toEqual([
    ['1', '2', '3'],
    ['3', '1', '2'],
    true,
    ['3', '9'],
    [],
  ]);
});
