// @vitest-environment happy-dom
/**
 * The DOM-work gate, read back from outside: devtools must count exactly the
 * mutations AmoJS performs — and the same counts raw and compiled (rule #3).
 * happy-dom has no el.animate, so a stub records which element each flash hit;
 * pixels are the browser check's job, not this file's.
 */
import { test, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { compileModule } from '@amojs.dev/compiler';
import { devtools as attach } from '../src/index.js';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const TMP = join(HERE, '__tmp__', randomUUID());
afterAll(() => rm(TMP, { recursive: true, force: true }));

/** @param {string} src @returns {Promise<any>} */
async function load(src) {
  await mkdir(TMP, { recursive: true });
  const file = join(TMP, `fixture-${randomUUID()}.mjs`);
  await writeFile(file, src);
  return import(/* @vite-ignore */ file);
}

const COLORS = { write: 'yellow', insert: 'green', remove: 'red', move: 'blue' };
const KINDS = ['text', 'attr', 'insert', 'remove', 'move', 'last'];

/** every instance dies with its test — a leftover observer would paint the next one */
const live = /** @type {(() => void)[]} */ ([]);
/** @type {typeof attach} */
const devtools = (...args) => {
  const dispose = attach(...args);
  live.push(dispose);
  return dispose;
};

/** @type {{ el: Element, frames: Keyframe[] }[]} */
let calls = [];
let started = 0;
let cancelled = 0;

beforeEach(() => {
  calls = [];
  started = 0;
  cancelled = 0;
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    /** @this {Element} @param {Keyframe[]} frames @param {KeyframeAnimationOptions} [opts] */
    value(frames, opts) {
      calls.push({ el: this, frames });
      started++;
      const effect = { target: this, composite: opts?.composite ?? 'replace' };
      return { effect, onfinish: null, oncancel: null, cancel: () => cancelled++ };
    },
  });
});
afterEach(() => {
  for (const dispose of live.splice(0)) dispose();
  // @ts-expect-error — removing the stub restores happy-dom's real shape
  delete Element.prototype.animate;
  document.body.innerHTML = '';
});

const settle = () => new Promise((r) => setTimeout(r, 0));

/** the panel's numbers, read from its own DOM */
function panel() {
  const host = document.querySelector('[data-amo-devtools]');
  /** @param {ShadowRoot} sr */
  const read = (sr) =>
    Object.fromEntries(KINDS.map((k) => [k, Number(sr.querySelector(`[data-kind=${k}] b`)?.textContent)]));
  return host?.shadowRoot ? read(host.shadowRoot) : null;
}

/** which element each flash hit, in which colour — glides carry no colour */
const flashes = () =>
  calls
    .filter((c) => c.frames[0].backgroundColor)
    .map((c) => `${c.el.tagName}:${c.el.textContent}:${c.frames[0].backgroundColor}`);

const APP = [
  "import { signal, html, each } from '@amojs.dev/core';",
  "export { flushSync } from '@amojs.dev/core';",
  'export function App() {',
  '  const count = signal(0);',
  '  const n = signal(0);',
  '  const items = signal([1, 2, 3, 4, 5]);',
  '  const el = html`<div><button>count: ${count}</button><span>${() => (n.value >= 10 ? "big" : "small")}</span><ul>${each(items, (k) => k, (k) => html`<li>${String(k)}</li>`)}</ul></div>`;',
  '  return { el, count, n, items };',
  '}',
].join('\n');

/** one scenario, recorded step by step @param {string} src */
async function run(src) {
  const mod = await load(src);
  const { el, count, n, items } = mod.App();
  document.body.append(el);
  const dispose = devtools(el, { colors: COLORS });
  /** @type {Record<string, unknown>} */
  const out = {};
  /** @param {string} name @param {() => void} write */
  const step = async (name, write) => {
    calls = [];
    write();
    mod.flushSync();
    await settle();
    out[name] = { counts: panel(), flashes: flashes() };
  };

  await step('click', () => count.value++);
  await step('same value', () => (count.value = 1));
  await step('hole re-runs, same text', () => (n.value = 5));
  await step('reverse', () => (items.value = [5, 4, 3, 2, 1]));
  await step('append', () => (items.value = [...items.value, 6]));
  await step('remove', () => (items.value = items.value.filter((/** @type {number} */ k) => k !== 3)));

  dispose();
  calls = [];
  count.value++;
  items.value = [9];
  mod.flushSync();
  await settle();
  out.disposed = {
    panelGone: document.querySelector('[data-amo-devtools]') === null,
    animated: calls.length,
  };
  return out;
}

test('raw and compiled AmoJS produce the same devtools counts, step by step', async () => {
  const compiled = compileModule(APP);
  expect(compiled).not.toContain('html`');

  const raw = await run(APP);
  document.body.innerHTML = '';
  const cmp = await run(compiled);
  expect(cmp).toEqual(raw);

  const zero = { text: 0, attr: 0, insert: 0, remove: 0, move: 0 };
  expect(raw).toEqual({
    // one signal → one text node → one write, flashed on the element holding it
    click: { counts: { ...zero, text: 1, last: 1 }, flashes: ['BUTTON:count: 1:yellow'] },
    // the signal's equality cutoff: no batch at all, so nothing moves
    'same value': { counts: { ...zero, text: 1, last: 1 }, flashes: [] },
    // the hole's effect re-ran, but the DOM boundary skipped the identical write
    'hole re-runs, same text': { counts: { ...zero, text: 1, last: 1 }, flashes: [] },
    // reverse of 5 = 4 moves (LIS-minimal), zero births, zero removals
    reverse: {
      counts: { ...zero, text: 1, move: 4, last: 4 },
      flashes: ['LI:2:blue', 'LI:3:blue', 'LI:4:blue', 'LI:5:blue'],
    },
    append: { counts: { ...zero, text: 1, move: 4, insert: 1, last: 1 }, flashes: ['LI:6:green'] },
    remove: {
      counts: { ...zero, text: 1, move: 4, insert: 1, remove: 1, last: 1 },
      flashes: ['UL:54216:red'],
    },
    disposed: { panelGone: true, animated: 0 },
  });
});

test('dispose stops counting, cancels running flashes and drops its input listeners', async () => {
  await run(APP);
  // the stub animations never finish, so every one was still running at dispose
  expect(started).toBeGreaterThan(0);
  expect(cancelled).toBe(started);

  const mod = await load(APP);
  const app = mod.App();
  document.body.append(app.el);
  const dispose = devtools(app.el);
  const sr = /** @type {ShadowRoot} */ (document.querySelector('[data-amo-devtools]')?.shadowRoot);
  app.count.value++;
  mod.flushSync();
  await settle();
  dispose();
  dispatchEvent(new Event('pointerdown'));
  app.count.value++;
  mod.flushSync();
  await settle();
  expect(sr.querySelector('[data-kind=text] b')?.textContent).toBe('1');
  expect(sr.querySelector('[data-kind=last] b')?.textContent).toBe('1');
});

test('the panel never counts itself — default target is document.body', async () => {
  const mod = await load(APP);
  const app = mod.App();
  document.body.append(app.el);
  devtools();
  app.count.value++;
  mod.flushSync();
  await settle();
  await settle();
  // the panel rewrote six cells inside document.body; none of it shows up
  expect(panel()).toEqual({ text: 1, attr: 0, insert: 0, remove: 0, move: 0, last: 1 });
  expect(flashes()).toEqual(['BUTTON:count: 1:#fde047']);
});

test('a key or pointer press resets "last batch", so an input that writes nothing reads 0', async () => {
  const mod = await load(APP);
  const app = mod.App();
  document.body.append(app.el);
  devtools(app.el);
  app.count.value++;
  mod.flushSync();
  await settle();
  expect(panel()?.last).toBe(1);

  dispatchEvent(new Event('pointerdown'));
  app.count.value = 1;
  mod.flushSync();
  await settle();
  expect(panel()?.last).toBe(0);
  expect(panel()?.text).toBe(1);

  app.count.value++;
  mod.flushSync();
  await settle();
  expect(panel()?.last).toBe(1);
  dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
  expect(panel()?.last).toBe(0);
});

test('moved nodes glide from their recorded position; a displaced untouched one drops its old glide', async () => {
  // happy-dom has no layout: give every element a row slot, 10px per sibling index
  const proto = HTMLElement.prototype;
  const saved = ['offsetParent', 'offsetTop', 'offsetLeft'].map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)]);
  Object.defineProperties(proto, {
    offsetParent: { configurable: true, get() { return this.isConnected ? document.body : null; } },
    offsetTop: { configurable: true, get() { return this.parentElement ? [...this.parentElement.children].indexOf(this) * 10 : 0; } },
    offsetLeft: { configurable: true, get: () => 0 },
  });
  try {
    const mod = await load(APP);
    const app = mod.App();
    document.body.append(app.el);
    devtools(app.el);
    /** row text → the translate its glide started from */
    const glides = () => Object.fromEntries(
      calls.filter((c) => c.frames[0].transform).map((c) => [c.el.textContent, c.frames[0].transform]),
    );

    app.items.value = [5, 4, 3, 2, 1];
    mod.flushSync();
    await settle();
    // "1" is the reconciler's anchor (untouched); "3" moved but landed in its own slot
    expect(glides()).toEqual({ 5: 'translate(0px,40px)', 4: 'translate(0px,20px)', 2: 'translate(0px,-20px)' });
    expect(cancelled).toBe(0);

    calls = [];
    app.items.value = [1, 2, 3, 4, 5];
    mod.flushSync();
    await settle();
    // now "5" is the untouched anchor: its first glide, still running, no longer matches its slot
    expect(glides()).toEqual({ 1: 'translate(0px,40px)', 2: 'translate(0px,20px)', 4: 'translate(0px,-20px)' });
    expect(cancelled).toBe(1);
  } finally {
    for (const [k, d] of saved) {
      const key = /** @type {string} */ (k);
      if (d) Object.defineProperty(proto, key, /** @type {PropertyDescriptor} */ (d));
      else delete (/** @type {any} */ (proto))[key];
    }
  }
});

test('attribute writes and a node inserted then removed in one batch are all counted', async () => {
  const ul = document.createElement('ul');
  document.body.append(ul);
  devtools(ul);
  const li = document.createElement('li');
  ul.append(li);
  li.setAttribute('class', 'x');
  li.remove();
  await settle();
  expect(panel()).toEqual({ text: 0, attr: 1, insert: 1, remove: 1, move: 0, last: 3 });
  // the node is gone, so the only thing left to paint is the list it passed through
  expect(flashes()).toEqual(['UL::#fca5a5']);
});

test('panel: false shows no panel and still paints', async () => {
  const p = document.createElement('p');
  document.body.append(p);
  devtools(p, { panel: false });
  p.textContent = 'hi';
  await settle();
  expect(document.querySelector('[data-amo-devtools]')).toBeNull();
  expect(flashes()).toEqual(['P:hi:#86efac']);
});

test('without el.animate it still counts, and never throws', async () => {
  // @ts-expect-error — happy-dom's real shape: no Web Animations
  delete Element.prototype.animate;
  const mod = await load(APP);
  const app = mod.App();
  document.body.append(app.el);
  devtools(app.el);
  app.items.value = [2, 1, 3, 4, 5];
  mod.flushSync();
  await settle();
  expect(panel()).toEqual({ text: 0, attr: 0, insert: 0, remove: 0, move: 1, last: 1 });
});
