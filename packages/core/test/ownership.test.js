// @vitest-environment happy-dom
/**
 * THE DISPOSE SUITE — the v0.5 PASS criterion.
 *
 * Ownership rules under test:
 *   1. re-run = the previous run's children die (conditionals fixed for free)
 *   2. each() rows live in detached per-key roots — reorders never kill them,
 *      a leaving key kills exactly one, hole disposal kills them all
 *   3. ownership follows CREATION: user-cached nodes survive being swapped out
 *
 * Leaks are asserted with hard numbers: signal.subs.size must return to
 * baseline after every unmount.
 */
import { test, expect } from 'vitest';
import {
  signal, computed, effect, flushSync, root, onCleanup, html, mount, each,
} from '../src/index.js';

/* ---------------- rule 1: re-run disposes the previous run ---------------- */

test('an effect re-running disposes the child effects of its previous run', () => {
  const outer = signal(0);
  const inner = signal(0);
  let innerRuns = 0;
  effect(() => {
    outer.value;
    effect(() => {
      inner.value;
      innerRuns++;
    });
  });
  expect(innerRuns).toBe(1);
  expect(inner.subs.size).toBe(1);

  inner.value++;
  flushSync();
  expect(innerRuns).toBe(2);

  outer.value++; // parent re-runs → old child disposed, a fresh one created
  flushSync();
  expect(innerRuns).toBe(3);
  expect(inner.subs.size).toBe(1); // never two

  inner.value++;
  flushSync();
  expect(innerRuns).toBe(4); // only the fresh child ran
});

test('onCleanup runs before every re-run and once more on dispose, children first', () => {
  /** @type {string[]} */
  const log = [];
  const s = signal(0);
  const stop = effect(() => {
    s.value;
    effect(() => {
      onCleanup(() => log.push('child'));
    });
    onCleanup(() => log.push('parent'));
  });
  expect(log).toEqual([]);

  s.value++;
  flushSync();
  expect(log).toEqual(['child', 'parent']);

  stop();
  expect(log).toEqual(['child', 'parent', 'child', 'parent']);
});

test('onCleanup outside any scope throws', () => {
  expect(() => onCleanup(() => {})).toThrow(/outside a scope/);
});

test('creating an effect inside computed() throws — computeds stay pure', () => {
  const c = computed(() => {
    effect(() => {});
    return 1;
  });
  expect(() => c.value).toThrow(/inside computed/);
});

test('a computed created in a scope detaches on dispose and revives lazily', () => {
  const src = signal(2);
  let out = 0;
  const stop = effect(() => {
    const double = computed(() => src.value * 2);
    effect(() => {
      out = double.value;
    });
  });
  expect(out).toBe(4);
  expect(src.subs.size).toBe(1); // the computed

  stop();
  expect(src.subs.size).toBe(0); // fully detached — no zombie computed
});

/* ---------------- root(): detached, explicitly disposable ---------------- */

test('root() detaches from the surrounding effect and disposes on demand', () => {
  const rerun = signal(0);
  const s = signal(0);
  let runs = 0;
  let disposeRoot = () => {};
  let captured = false;
  effect(() => {
    rerun.value;
    if (!captured) {
      captured = true;
      disposeRoot = root((dispose) => {
        effect(() => {
          s.value;
          runs++;
        });
        return dispose;
      });
    }
  });
  expect(runs).toBe(1);

  rerun.value++; // the outer effect re-runs — the detached root must survive
  flushSync();
  s.value++;
  flushSync();
  expect(runs).toBe(2);

  disposeRoot();
  s.value++;
  flushSync();
  expect(runs).toBe(2); // dead
  expect(s.subs.size).toBe(0);
});

/* ---------------- blocks: conditionals ---------------- */

test('a swapped-out branch takes its effects with it (zero zombies)', () => {
  const on = signal(true);
  const n = signal(0);
  let evals = 0;
  const el = /** @type {Element} */ (
    html`<div>${() => (on.value ? html`<b>${() => (evals++, String(n.value))}</b>` : 'off')}</div>`
  );
  mount(el, document.body);
  expect(evals).toBe(1);

  n.value++;
  flushSync();
  expect(evals).toBe(2);

  on.value = false; // branch leaves → its hole effect must die
  flushSync();
  expect(n.subs.size).toBe(0);

  n.value++;
  flushSync();
  expect(evals).toBe(2); // no zombie work

  on.value = true; // fresh branch sees the current value
  flushSync();
  expect(el.querySelector('b')?.textContent).toBe(String(n.peek()));
});

test('ownership follows creation: a user-cached branch stays alive while swapped out', () => {
  const yes = /** @type {Element} */ (html`<b></b>`);
  const label = signal('a');
  const live = /** @type {Element} */ (html`<i>${label}</i>`);
  const on = signal(true);
  const el = /** @type {Element} */ (html`<div>${() => (on.value ? live : yes)}</div>`);
  mount(el, document.body);

  on.value = false; // `live` swapped out — but it was created OUTSIDE the hole
  flushSync();
  label.value = 'b'; // still owned by the outer scope → keeps updating
  flushSync();

  on.value = true;
  flushSync();
  expect(el.querySelector('i')?.textContent).toBe('b'); // same node, fresh value
  expect(label.subs.size).toBe(1);
});

/* ---------------- blocks: keyed lists ---------------- */

/** @param {{ id: number, done: { value: boolean } }} it */
const Row = (it) =>
  html`<li class=${() => (it.done.value ? 'done' : '')}>${String(it.id)}</li>`;

test('each: a leaving key disposes exactly its own row scope', () => {
  const a = { id: 1, done: signal(false) };
  const b = { id: 2, done: signal(false) };
  const items = signal([a, b]);
  const el = /** @type {Element} */ (
    html`<ul>${each(items, (it) => it.id, Row)}</ul>`
  );
  mount(el, document.body);
  expect(a.done.subs.size).toBe(1);
  expect(b.done.subs.size).toBe(1);

  items.value = [b]; // a leaves
  flushSync();
  expect(a.done.subs.size).toBe(0); // a's scope is gone…
  expect(b.done.subs.size).toBe(1); // …b's is untouched

  b.done.value = true; // and b is still live
  flushSync();
  expect(el.querySelector('li')?.getAttribute('class')).toBe('done');
});

test('each: reorders never dispose rows (detached per-key roots)', () => {
  const a = { id: 1, done: signal(false) };
  const b = { id: 2, done: signal(false) };
  const items = signal([a, b]);
  const el = /** @type {Element} */ (
    html`<ul>${each(items, (it) => it.id, Row)}</ul>`
  );
  mount(el, document.body);

  items.value = [b, a];
  flushSync();
  items.value = [a, b];
  flushSync();

  a.done.value = true; // still wired after two reorders
  flushSync();
  expect(el.children[0].getAttribute('class')).toBe('done');
  expect(a.done.subs.size).toBe(1);
});

test('each: unmounting the whole list disposes every row scope', () => {
  const a = { id: 1, done: signal(false) };
  const b = { id: 2, done: signal(false) };
  const items = signal([a, b]);
  const on = signal(true);
  const el = /** @type {Element} */ (
    html`<div>${() => (on.value ? html`<ul>${each(items, (it) => it.id, Row)}</ul>` : 'empty')}</div>`
  );
  mount(el, document.body);
  expect(a.done.subs.size).toBe(1);

  on.value = false; // the hole hosting the list dies → onDispose → all rows die
  flushSync();
  expect(a.done.subs.size).toBe(0);
  expect(b.done.subs.size).toBe(0);
  expect(items.subs.size).toBe(0);
});
