// @vitest-environment happy-dom
/**
 * onMount + ref + error isolation.
 *
 * The need these answer: a component function runs while its nodes are still
 * detached, so "measure / focus / observe / hand this element to a chart
 * library" had no moment to happen in. `ref` gets the node, `onMount` gets
 * the moment it is live.
 */
import { test, expect, vi } from 'vitest';
import {
  signal, effect, flushSync, root, onMount, html, mount, each,
} from '../src/index.js';

/* ---------------- ref ---------------- */

test('ref hands over the element and never reaches the DOM as an attribute', () => {
  /** @type {Element[]} */
  const seen = [];
  const el = /** @type {Element} */ (
    html`<div><input ref=${(/** @type {Element} */ n) => seen.push(n)}></div>`
  );
  expect(seen[0]).toBe(el.querySelector('input'));
  expect(seen[0].hasAttribute('ref')).toBe(false);
  expect(el.innerHTML).toBe('<input>');
});

test('ref accepts a signal', () => {
  const box = signal(/** @type {Element | null} */ (null));
  const el = /** @type {Element} */ (html`<p><b ref=${box}>x</b></p>`);
  expect(box.peek()).toBe(el.querySelector('b'));
});

test('ref on the root element of a template', () => {
  /** @type {Element | null} */
  let captured = null;
  const el = html`<section ref=${(/** @type {Element} */ n) => (captured = n)}>t</section>`;
  expect(captured).toBe(el);
});

test('each item can capture its own element with ref', () => {
  /** @type {Element[]} */
  const seen = [];
  const items = signal([1, 2]);
  const el = /** @type {Element} */ (
    html`<ul>${each(items, (k) => k, (k) =>
      html`<li ref=${(/** @type {Element} */ n) => seen.push(n)}>${String(k)}</li>`)}</ul>`
  );
  mount(el, document.body);
  expect(seen).toEqual([...el.children]);
});

/* ---------------- onMount ---------------- */

test('onMount runs after insertion — the node is live', () => {
  /** @type {boolean | null} */
  let connectedAtCallback = null;
  function Comp() {
    const el = html`<div>hi</div>`;
    // proof the moment is needed: NOT connected while the component runs
    expect(/** @type {Element} */ (el).isConnected).toBe(false);
    onMount(() => {
      connectedAtCallback = /** @type {Element} */ (el).isConnected;
    });
    return el;
  }
  mount(Comp, document.body);
  expect(connectedAtCallback).toBe(true);
});

test('onMount fires for a component instantiated by a conditional', () => {
  const on = signal(false);
  /** @type {string[]} */
  const log = [];
  const Panel = () => {
    const el = html`<p>panel</p>`;
    onMount(() => log.push(/** @type {Element} */ (el).isConnected ? 'live' : 'detached'));
    return el;
  };
  const el = /** @type {Element} */ (html`<div>${() => (on.value ? Panel() : '')}</div>`);
  mount(el, document.body);
  expect(log).toEqual([]);

  on.value = true;
  flushSync();
  expect(log).toEqual(['live']);
});

test('onMount fires once per list row, not on reorder', () => {
  const items = signal([1, 2]);
  let mounts = 0;
  const Row = (/** @type {number} */ k) => {
    const el = html`<li>${String(k)}</li>`;
    onMount(() => mounts++);
    return el;
  };
  const el = /** @type {Element} */ (html`<ul>${each(items, (k) => k, Row)}</ul>`);
  mount(el, document.body);
  expect(mounts).toBe(2);

  items.value = [2, 1]; // reorder — rows are moved, not rebuilt
  flushSync();
  expect(mounts).toBe(2);

  items.value = [2, 1, 3]; // one newcomer
  flushSync();
  expect(mounts).toBe(3);
});

test('onMount is skipped when its scope died before the flush', () => {
  const on = signal(true);
  let ran = 0;
  const el = /** @type {Element} */ (
    html`<div>${() => {
      if (!on.value) return '';
      onMount(() => ran++);
      return html`<b>x</b>`;
    }}</div>`
  );
  mount(el, document.body);
  expect(ran).toBe(1);

  // flip twice inside one batch: the scope that queued the callback is gone
  on.value = false;
  on.value = true;
  on.value = false;
  flushSync();
  expect(ran).toBe(1);
});

test('onMount + ref together: the real pattern for a third-party widget', () => {
  /** @type {string[]} */
  const log = [];
  function Widget() {
    /** @type {Element | null} */
    let host = null;
    const el = html`<div><span ref=${(/** @type {Element} */ n) => (host = n)}>slot</span></div>`;
    onMount(() => log.push(`init:${/** @type {Element} */ (host).isConnected}`));
    return el;
  }
  mount(Widget, document.body);
  expect(log).toEqual(['init:true']);
});

test('a callback queued by onMount runs in the same drain', () => {
  /** @type {string[]} */
  const order = [];
  function Comp() {
    const el = html`<div></div>`;
    onMount(() => {
      order.push('first');
      onMount(() => order.push('nested'));
    });
    return el;
  }
  mount(Comp, document.body);
  expect(order).toEqual(['first', 'nested']);
});

/* ---------------- error isolation ---------------- */

test('one throwing effect does not strand the rest of the batch', () => {
  const s = signal(0);
  let good = 0;
  effect(() => {
    s.value;
    if (s.value > 0) throw new Error('boom');
  });
  effect(() => {
    s.value;
    good++;
  });
  expect(good).toBe(1);

  s.value = 1;
  expect(() => flushSync()).toThrow('boom');
  expect(good).toBe(2); // the healthy effect still ran

  // and the queue is not wedged: the next write still works
  s.value = 2;
  expect(() => flushSync()).toThrow('boom');
  expect(good).toBe(3);
});

test('several failures in one batch surface as AggregateError', () => {
  const s = signal(0);
  for (const msg of ['one', 'two']) {
    effect(() => {
      if (s.value > 0) throw new Error(msg);
    });
  }
  s.value = 1;
  let caught;
  try {
    flushSync();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(AggregateError);
  expect(/** @type {AggregateError} */ (caught).errors.map((e) => e.message)).toEqual([
    'one',
    'two',
  ]);
});

test('a throwing onMount does not stop the others', () => {
  const log = vi.fn();
  function Comp() {
    const el = html`<div></div>`;
    onMount(() => {
      throw new Error('bad init');
    });
    onMount(() => log('still ran'));
    return el;
  }
  expect(() => mount(Comp, document.body)).toThrow('bad init');
  expect(log).toHaveBeenCalledWith('still ran');
});

/* ---------------- teardown still holds ---------------- */

test('onMount work can be torn down with onCleanup through root()', () => {
  /** @type {string[]} */
  const disposeLog = [];
  const dispose = root((d) => {
    const el = html`<div></div>`;
    onMount(() => disposeLog.push('mounted'));
    mount(el, document.body);
    return d;
  });
  expect(disposeLog).toEqual(['mounted']);
  dispose();
  expect(disposeLog).toEqual(['mounted']);
});
