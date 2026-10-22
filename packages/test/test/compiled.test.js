// @vitest-environment happy-dom
/**
 * Locked rule #3 through render(): one fixture executed raw and compiled
 * must render, update, mount and unmount identically.
 */
import { test, expect, afterAll } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { compileModule } from '@amojs.dev/compiler';
import { render, flush } from '../src/pure.js';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
// inside the package, so the fixture's bare specifiers resolve to the same core instance as src/
const TMP = join(HERE, '__tmp__', randomUUID());

afterAll(() => rm(TMP, { recursive: true, force: true }));

const FIXTURE = [
  "import { signal, computed, each, onCleanup, onMount, html } from '@amojs.dev/core';",
  'export const count = signal(0);',
  "export const rows = [{ id: 1, label: signal('a') }, { id: 2, label: signal('b') }];",
  'export const items = signal(rows);',
  'export const log = [];',
  'export function Counter() {',
  '  const double = computed(() => count.value * 2);',
  '  const btn = html`<button onclick=${() => count.value++}>c:${count}|${double}</button>`;',
  "  onMount(() => log.push(`mounted ${btn.isConnected}`));",
  "  onCleanup(() => log.push('counter'));",
  '  return html`<div>${btn}<ul>${each(items, (it) => it.id, (it) => {',
  '    onCleanup(() => log.push(`row ${it.id}`));',
  '    return html`<li>${it.label}</li>`;',
  '  })}</ul></div>`;',
  '}',
].join('\n');

/** @param {string} src */
async function load(src) {
  await mkdir(TMP, { recursive: true });
  const file = join(TMP, `fixture-${randomUUID()}.mjs`);
  await writeFile(file, src);
  return import(/* @vite-ignore */ file);
}

/** @param {string} src */
async function run(src) {
  const m = await load(src);
  const subs = () => [m.count.subs.size, m.items.subs.size, ...m.rows.map((/** @type {*} */ r) => r.label.subs.size)];
  const baseline = subs();

  const { container, unmount } = render(m.Counter);
  const btn = /** @type {HTMLButtonElement} */ (container.querySelector('button'));
  const html0 = container.innerHTML;
  const live = subs();
  btn.click();
  btn.click();
  m.items.value = [m.rows[1], m.rows[0]];
  flush();
  const html1 = container.innerHTML;

  unmount();
  return { html0, html1, baseline, live, after: subs(), log: [...m.log].sort(), connected: container.isConnected };
}

test('render() behaves identically on a raw and a compiled component', async () => {
  const compiled = compileModule(FIXTURE);
  expect(compiled).not.toContain('html`');
  expect(compiled).toContain('@amojs.dev/core/runtime');

  const raw = await run(FIXTURE);
  const cmp = await run(compiled);

  expect(cmp).toEqual(raw);
  expect(raw.html1).toContain('c:2|4');
  expect(raw.html1.indexOf('>b<')).toBeLessThan(raw.html1.indexOf('>a<')); // rows moved
  expect(raw.live).toEqual([2, 1, 1, 1]);
  expect(raw.after).toEqual(raw.baseline);
  expect(raw.log).toEqual(['counter', 'mounted true', 'row 1', 'row 2']);
  expect(raw.connected).toBe(false);
});
