// @vitest-environment happy-dom
import { test, expect, afterAll } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { compileModule } from '@amojs.dev/compiler';
import { flushSync } from '@amojs.dev/core';
import { define } from '../src/index.js';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
// inside the package, so the fixture's bare core imports resolve to the same core as define()
const TMP = join(HERE, '__tmp__', randomUUID());
afterAll(() => rm(TMP, { recursive: true, force: true }));

const COUNTER = [
  "import { signal, html } from '@amojs.dev/core';",
  'export let last;',
  'export function Counter(props) {',
  '  last = props;',
  '  const clicks = signal(0);',
  '  return html`<button class="c" onclick=${() => clicks.value++}>n:${() => Number(props.start.value) + clicks.value}</button>`;',
  '}',
].join('\n');

/** @param {string} src */
async function load(src) {
  await mkdir(TMP, { recursive: true });
  const file = join(TMP, `fixture-${randomUUID()}.mjs`);
  await writeFile(file, src);
  return import(/* @vite-ignore */ file);
}

/**
 * @param {string} src
 * @param {string} name
 */
async function run(src, name) {
  const mod = await load(src);
  define(name, mod.Counter, { attrs: ['start'] });
  const el = document.createElement(name);
  el.setAttribute('start', '5');
  document.body.append(el);
  const click = () => /** @type {HTMLButtonElement} */ (el.querySelector('button')).click();

  const snaps = [el.innerHTML];
  click();
  flushSync();
  snaps.push(el.innerHTML);
  el.setAttribute('start', '9');
  flushSync();
  snaps.push(el.innerHTML);

  const start = mod.last.start;
  el.remove();
  const subsAfterRemove = start.subs.size;
  snaps.push(el.innerHTML);

  document.body.append(el);
  snaps.push(el.innerHTML);
  click();
  flushSync();
  snaps.push(el.innerHTML);
  el.remove();
  return { snaps, subsAfterRemove, hostIsElement: mod.last.host === el };
}

test('GOLDEN element: a raw component and its compiled twin behave identically inside define()', async () => {
  const compiled = compileModule(COUNTER);
  expect(compiled).not.toContain('html`');

  const raw = await run(COUNTER, 'x-raw');
  const cmp = await run(compiled, 'x-cmp');

  expect(cmp).toEqual(raw);
  expect(raw.snaps).toEqual([
    '<button class="c">n:5</button>',
    '<button class="c">n:6</button>',
    '<button class="c">n:10</button>',
    '',
    '<button class="c">n:9</button>',
    '<button class="c">n:10</button>',
  ]);
  expect(raw.subsAfterRemove).toBe(0);
  expect(raw.hostIsElement).toBe(true);
});
