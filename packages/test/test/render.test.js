// @vitest-environment happy-dom
import { test, expect, afterEach } from 'vitest';
import { signal, html, each, onCleanup, onMount, flushSync, tick as coreTick } from '@amojs.dev/core';
import { render, cleanup, flush, tick } from '../src/pure.js';

afterEach(cleanup);

test('render → click → flush: a raw html`` counter updates', () => {
  const count = signal(0);
  const Counter = () => html`<button onclick=${() => count.value++}>c:${count}</button>`;

  const { container } = render(Counter);
  expect(container.parentNode).toBe(document.body);
  const btn = /** @type {HTMLButtonElement} */ (container.querySelector('button'));
  expect(btn.textContent).toBe('c:0');

  btn.click();
  btn.click();
  flush();
  expect(btn.textContent).toBe('c:2');
});

test('unmount returns every subscription to its baseline and removes the container', () => {
  const count = signal(0);
  const label = signal('a');
  const Comp = () => html`<p>${count}|${() => label.value.toUpperCase()}</p>`;
  const before = [count.subs.size, label.subs.size];

  const { container, unmount } = render(Comp);
  expect([count.subs.size, label.subs.size]).toEqual([1, 1]);

  unmount();
  expect([count.subs.size, label.subs.size]).toEqual(before);
  expect(container.isConnected).toBe(false);
  expect(document.body.contains(container)).toBe(false);

  count.value++; // nothing left to wake
  flush();
  expect(container.textContent).toBe('0|A');
});

test('unmount runs onCleanup and disposes every each() row', () => {
  /** @type {string[]} */
  const log = [];
  const a = { id: 1, label: signal('a') };
  const b = { id: 2, label: signal('b') };
  const items = signal([a, b]);
  const List = () => {
    onCleanup(() => log.push('list'));
    return html`<ul>${each(items, (it) => it.id, (it) => {
      onCleanup(() => log.push(`row ${it.id}`));
      return html`<li>${it.label}</li>`;
    })}</ul>`;
  };

  const { container, unmount } = render(List);
  expect(container.textContent).toBe('ab');
  expect([items.subs.size, a.label.subs.size, b.label.subs.size]).toEqual([1, 1, 1]);

  unmount();
  expect([items.subs.size, a.label.subs.size, b.label.subs.size]).toEqual([0, 0, 0]);
  expect(log.sort()).toEqual(['list', 'row 1', 'row 2']);
});

test('unmount twice, or after cleanup, is a no-op', () => {
  /** @type {string[]} */
  const log = [];
  const Comp = () => {
    onCleanup(() => log.push('x'));
    return html`<i></i>`;
  };
  const { unmount } = render(Comp);
  unmount();
  unmount();
  cleanup();
  expect(log).toEqual(['x']);
});

test('cleanup() unmounts two rendered containers', () => {
  const s = signal(0);
  const Comp = () => html`<b>${s}</b>`;
  const one = render(Comp);
  const two = render(Comp);
  expect(one.container).not.toBe(two.container);
  expect(document.body.children.length).toBe(2);
  expect(s.subs.size).toBe(2);

  cleanup();
  expect(document.body.children.length).toBe(0);
  expect([one.container.isConnected, two.container.isConnected]).toEqual([false, false]);
  expect(s.subs.size).toBe(0);
});

test('onMount sees a live node', () => {
  /** @type {boolean[]} */
  const seen = [];
  const Comp = () => {
    const el = /** @type {Element} */ (html`<input>`);
    onMount(() => seen.push(el.isConnected));
    return el;
  };
  render(Comp);
  expect(seen).toEqual([true]);
});

test('options.target is used as the container, and unmount removes it', () => {
  const target = document.createElement('section');
  document.body.append(target);
  const { container, unmount } = render(() => html`<p>hi</p>`, { target });
  expect(container).toBe(target);
  expect(target.innerHTML).toBe('<p>hi</p>');
  unmount();
  expect(target.isConnected).toBe(false);
});

test('a node can be rendered as is', () => {
  const node = /** @type {Element} */ (html`<p>made outside</p>`);
  const { container, unmount } = render(node);
  expect(container.firstChild).toBe(node);
  unmount();
  expect(node.isConnected).toBe(false);
});

test('a render that throws is still cleaned up by cleanup()', () => {
  const s = signal(0);
  const Broken = () => {
    html`<p>${s}</p>`; // subscribes before the throw
    throw new Error('bad component');
  };
  expect(() => render(Broken)).toThrow('bad component');
  expect(document.body.children.length).toBe(1);
  expect(s.subs.size).toBe(1);

  cleanup();
  expect(document.body.children.length).toBe(0);
  expect(s.subs.size).toBe(0);
});

test('flush is flushSync, and tick resolves after pending effects ran', async () => {
  expect(flush).toBe(flushSync);
  expect(tick).toBe(coreTick);

  const s = signal('a');
  const { container } = render(() => html`<p>${s}</p>`);
  s.value = 'b';
  expect(container.textContent).toBe('a'); // effects are batched into a microtask
  await tick();
  expect(container.textContent).toBe('b');
});
