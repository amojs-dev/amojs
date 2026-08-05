// @vitest-environment happy-dom
/**
 * DOM-WORK PARITY — a v0.6 PASS criterion.
 *
 * "Compiles to the vanilla JS you would have written" must also hold for
 * the WORK done at runtime: for the same scenario, amo must emit exactly
 * the same DOM mutations as a careful hand-written vanilla app — counted
 * with a MutationObserver, gated in CI. (Reorder MOVE-minimality is the
 * one axis not gated yet: reconcile is correct-first; udomdiff/LIS-grade
 * move counts are the remaining v0.6 work. It is measured and logged here.)
 */
import { test, expect } from 'vitest';
import { signal, html, mount, each, flushSync } from '../src/index.js';

/** @typedef {{ added: number, removed: number, text: number, attr: number }} Counts */

/** @param {MutationObserver} mo @returns {Counts} */
function drain(mo) {
  const c = { added: 0, removed: 0, text: 0, attr: 0 };
  for (const m of mo.takeRecords()) {
    if (m.type === 'childList') {
      c.added += m.addedNodes.length;
      c.removed += m.removedNodes.length;
    } else if (m.type === 'characterData') c.text++;
    else c.attr++;
  }
  return c;
}

/** @param {Element} el @returns {MutationObserver} */
function observe(el) {
  const mo = new MutationObserver(() => {});
  mo.observe(el, { childList: true, characterData: true, attributes: true, subtree: true });
  return mo;
}

/** @param {number} n */
const makeItems = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: i,
    title: signal(`item ${i}`),
    done: signal(false),
  }));

/* ---------------- the amo app ---------------- */

function amoApp() {
  const items = signal(/** @type {ReturnType<typeof makeItems>} */ ([]));
  const el = /** @type {Element} */ (
    html`<ul>${each(items, (it) => it.id, (it) =>
      html`<li class=${() => (it.done.value ? 'done' : '')}>${it.title}</li>`)}</ul>`
  );
  mount(el, document.body);
  flushSync();
  return { el, set: (/** @type {any[]} */ v) => ((items.value = v), flushSync()) };
}

/* ------------- the hand-written vanilla reference ------------- */

function vanillaApp() {
  const ul = document.createElement('ul');
  document.body.append(ul);
  /** @type {Map<number, { li: HTMLLIElement, text: Text, done: boolean }>} */
  const rows = new Map();
  /** @type {any[]} */
  let current = [];

  const build = (/** @type {any} */ it) => {
    const li = document.createElement('li');
    li.setAttribute('class', '');
    const text = document.createTextNode(it.title.peek());
    li.append(text);
    const row = { li, text, done: false };
    rows.set(it.id, row);
    return row;
  };

  return {
    el: ul,
    set(/** @type {any[]} */ next) {
      const keep = new Set(next.map((it) => it.id));
      for (const [id, row] of rows) {
        if (!keep.has(id)) {
          ul.removeChild(row.li);
          rows.delete(id);
        }
      }
      // same shape as amo's reconcile: walk backwards, skip nodes in place
      let ref = null;
      for (let i = next.length - 1; i >= 0; i--) {
        const row = rows.get(next[i].id) ?? build(next[i]);
        if (row.li.parentNode !== ul || row.li.nextSibling !== ref) {
          ul.insertBefore(row.li, ref);
        }
        ref = row.li;
      }
      current = next.slice();
    },
    update(/** @type {any} */ it) {
      const row = rows.get(it.id);
      if (row && row.text.data !== it.title.peek()) row.text.data = it.title.peek();
    },
    toggle(/** @type {any} */ it) {
      const row = rows.get(it.id);
      if (!row) return;
      row.done = !row.done;
      const cls = row.done ? 'done' : '';
      if (row.li.getAttribute('class') !== cls) row.li.setAttribute('class', cls);
    },
  };
}

/* ---------------- the parity suite ---------------- */

test('amo does exactly the DOM work the hand-written vanilla app does', () => {
  const N = 200;
  const items = makeItems(N);

  const amo = amoApp();
  const van = vanillaApp();
  const amoMo = observe(amo.el);
  const vanMo = observe(van.el);

  /** @type {(label: string) => void} */
  const expectParity = (label) => {
    const a = drain(amoMo);
    const v = drain(vanMo);
    expect(a, label).toEqual(v);
  };

  // create N rows
  amo.set(items);
  van.set(items);
  expectParity('create');

  // update every 10th title
  for (let i = 0; i < N; i += 10) {
    items[i].title.value = `changed ${i}`;
    van.update(items[i]);
  }
  flushSync();
  expectParity('update text');

  // re-set the SAME titles — churn must be free on both sides
  for (let i = 0; i < N; i += 10) {
    items[i].title.value = `changed ${i}`;
    van.update(items[i]);
  }
  flushSync();
  expectParity('churn (same values)');

  // toggle done on 20 rows
  for (let i = 0; i < 20; i++) {
    items[i].done.value = !items[i].done.peek();
    van.toggle(items[i]);
  }
  flushSync();
  expectParity('toggle class');

  // append one, prepend one
  const extra = makeItems(N + 2).slice(N);
  amo.set([...items, extra[0]]);
  van.set([...items, extra[0]]);
  expectParity('append');
  amo.set([extra[1], ...items, extra[0]]);
  van.set([extra[1], ...items, extra[0]]);
  expectParity('prepend');

  // remove a middle row
  const withoutMiddle = [extra[1], ...items.slice(0, 100), ...items.slice(101), extra[0]];
  amo.set(withoutMiddle);
  van.set(withoutMiddle);
  expectParity('remove middle');

  // clear everything
  amo.set([]);
  van.set([]);
  expectParity('clear');
});

test('moves are minimal: a swap costs exactly 2, a reverse costs n−1', () => {
  const N = 100;
  const items = makeItems(N);
  const amo = amoApp();
  amo.set(items);
  const mo = observe(amo.el);

  // swap two distant rows — the LIS keeps everything else anchored
  const swapped = items.slice();
  [swapped[1], swapped[N - 2]] = [swapped[N - 2], swapped[1]];
  amo.set(swapped);
  let c = drain(mo);
  expect(c.added).toBe(2); // one "move" = 1 removed + 1 added
  expect(c.removed).toBe(2);

  // reverse — the theoretical minimum is n−1 moves
  amo.set(swapped.slice().reverse());
  c = drain(mo);
  expect(c.added).toBe(N - 1);

  // rotate by one (move first to last) — minimum is 1
  const rotated = [...swapped.slice(1), swapped[0]].reverse();
  amo.set(rotated.slice().reverse()); // normalize back first
  drain(mo);
  const base = rotated.slice().reverse();
  amo.set([...base.slice(1), base[0]]);
  c = drain(mo);
  expect(c.added).toBe(1);
});
