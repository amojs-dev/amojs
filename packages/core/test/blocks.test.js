// @vitest-environment happy-dom
import { test, expect } from 'vitest';
import { signal, html, mount, each, flushSync } from '../src/index.js';

test('conditional: a function hole swaps between two templates', () => {
  const on = signal(true);
  const el = /** @type {Element} */ (
    html`<div>${() => (on.value ? html`<b>Y</b>` : html`<i>n</i>`)}</div>`
  );
  expect(el.innerHTML).toBe('<b>Y</b>');
  on.value = false;
  flushSync();
  expect(el.innerHTML).toBe('<i>n</i>');
  on.value = true;
  flushSync();
  expect(el.innerHTML).toBe('<b>Y</b>');
});

test('conditional: switches between text and nodes freely', () => {
  const on = signal(false);
  const el = /** @type {Element} */ (
    html`<p>${() => (on.value ? html`<b>node</b>` : 'plain text')}</p>`
  );
  expect(el.innerHTML).toBe('plain text');
  on.value = true;
  flushSync();
  expect(el.innerHTML).toBe('<b>node</b>');
  on.value = false;
  flushSync();
  expect(el.innerHTML).toBe('plain text');
});

test('conditional: user-cached branches keep node identity (zero churn)', () => {
  const yes = html`<b>1</b>`;
  const no = html`<i>0</i>`;
  const on = signal(true);
  const el = /** @type {Element} */ (html`<div>${() => (on.value ? yes : no)}</div>`);
  const before = el.querySelector('b');
  on.value = false;
  flushSync();
  on.value = true;
  flushSync();
  expect(el.querySelector('b')).toBe(before); // same node came back
});

test('static array hole inserts once', () => {
  const el = /** @type {Element} */ (
    html`<ul>${[html`<li>a</li>`, html`<li>b</li>`]}</ul>`
  );
  expect(el.innerHTML).toBe('<li>a</li><li>b</li>');
});

test('each: renders, appends, removes, clears', () => {
  const items = signal([1, 2, 3]);
  const el = /** @type {Element} */ (
    html`<ul>${each(items, (k) => k, (k) => html`<li>${String(k)}</li>`)}</ul>`
  );
  mount(el, document.body);
  const texts = () => [...el.children].map((li) => li.textContent);
  expect(texts()).toEqual(['1', '2', '3']);

  items.value = [1, 2, 3, 4];
  flushSync();
  expect(texts()).toEqual(['1', '2', '3', '4']);

  items.value = [1, 3, 4];
  flushSync();
  expect(texts()).toEqual(['1', '3', '4']);

  items.value = [];
  flushSync();
  expect(texts()).toEqual([]);
});

test('each: reorder MOVES nodes — identity and DOM state survive', () => {
  const items = signal([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  const el = /** @type {Element} */ (
    html`<ul>${each(items, (it) => it.id, (it) => html`<li>${it.id}</li>`)}</ul>`
  );
  mount(el, document.body);
  const byText = (/** @type {string} */ t) =>
    [...el.children].find((li) => li.textContent === t);
  const a = byText('a');
  const c = byText('c');
  /** @type {any} */ (a).__state = 'kept'; // simulate DOM state (focus, input…)

  items.value = [{ id: 'c' }, { id: 'a' }]; // fresh item objects, same keys
  flushSync();
  expect([...el.children].map((li) => li.textContent)).toEqual(['c', 'a']);
  expect(byText('a')).toBe(a); // moved, not rebuilt
  expect(byText('c')).toBe(c);
  expect(/** @type {any} */ (byText('a')).__state).toBe('kept');
});

test('each: render runs once per key', () => {
  let renders = 0;
  const items = signal([1, 2]);
  const el = /** @type {Element} */ (
    html`<ul>${each(items, (k) => k, (k) => (renders++, html`<li>${String(k)}</li>`))}</ul>`
  );
  mount(el, document.body);
  expect(renders).toBe(2);
  items.value = [2, 1]; // reorder — no new renders
  flushSync();
  expect(renders).toBe(2);
  items.value = [2, 1, 5]; // one newcomer
  flushSync();
  expect(renders).toBe(3);
});

test('each: duplicate keys throw', () => {
  const items = signal([1, 1]);
  expect(() =>
    html`<ul>${each(items, (k) => k, (k) => html`<li>${String(k)}</li>`)}</ul>`,
  ).toThrow(/duplicate key/);
});

test('reconcile correctness suite: order + identity across arbitrary permutations', () => {
  const items = signal(/** @type {number[]} */ ([]));
  const el = /** @type {Element} */ (
    html`<ul>${each(items, (k) => k, (k) => html`<li>${String(k)}</li>`)}</ul>`
  );
  mount(el, document.body);

  // deterministic LCG so failures reproduce exactly
  let rng = 42;
  const rand = (/** @type {number} */ n) => (
    (rng = (rng * 1103515245 + 12345) % 2147483648), rng % n
  );

  /** @type {number[][]} */
  const rounds = [
    [1, 2, 3, 4, 5],
    [5, 4, 3, 2, 1],
    [2, 4],
    [],
    [1, 2, 3],
    [3, 1, 4, 2],
    [4],
    [4, 5, 6],
    [6, 5, 4],
    [1, 2, 3, 4, 5, 6, 7, 8],
    [8, 1, 7, 2, 6, 3, 5, 4],
  ];
  for (let r = 0; r < 20; r++) {
    const pool = [...Array(10).keys()];
    const keys = [];
    const size = rand(9);
    for (let i = 0; i < size; i++) keys.push(pool.splice(rand(pool.length), 1)[0]);
    rounds.push(keys);
  }

  /** @type {Map<number, Element>} identity while the key stays present */
  const seen = new Map();
  for (const keys of rounds) {
    items.value = keys;
    flushSync();
    const lis = [...el.children];
    expect(lis.map((li) => li.textContent)).toEqual(keys.map(String));
    for (let i = 0; i < keys.length; i++) {
      if (seen.has(keys[i])) expect(lis[i]).toBe(seen.get(keys[i]));
      seen.set(keys[i], lis[i]);
    }
    for (const k of [...seen.keys()]) {
      if (!keys.includes(k)) seen.delete(k); // cache lifetime = presence
    }
  }
});
