// @vitest-environment happy-dom
import { test, expect } from 'vitest';
import { signal, flushSync } from '../src/signal.js';
import { html } from '../src/html.js';
import { mount } from '../src/mount.js';

test('static template returns a real element', () => {
  const el = /** @type {Element} */ (html`<p class="a">hello</p>`);
  expect(el.nodeType).toBe(1);
  expect(el.textContent).toBe('hello');
  expect(el.getAttribute('class')).toBe('a');
});

test('constant holes are written once', () => {
  const el = /** @type {Element} */ (html`<p>${'x'}-${42}</p>`);
  expect(el.textContent).toBe('x-42');
});

test('signal hole updates its own text node', () => {
  const s = signal(0);
  const el = /** @type {Element} */ (html`<p>c:${s}</p>`);
  expect(el.textContent).toBe('c:0');
  s.value = 5;
  flushSync();
  expect(el.textContent).toBe('c:5');
});

test('function hole re-evaluates reactively', () => {
  const s = signal(2);
  const el = /** @type {Element} */ (html`<p>${() => s.value * 10}</p>`);
  expect(el.textContent).toBe('20');
  s.value = 3;
  flushSync();
  expect(el.textContent).toBe('30');
});

test('attribute hole: signal with boolean semantics', () => {
  const dis = signal(false);
  const el = /** @type {Element} */ (html`<button disabled=${dis}>b</button>`);
  expect(el.hasAttribute('disabled')).toBe(false);
  dis.value = true;
  flushSync();
  expect(el.getAttribute('disabled')).toBe('');
  dis.value = false;
  flushSync();
  expect(el.hasAttribute('disabled')).toBe(false);
});

test('event hole + signal hole = a working counter', () => {
  const count = signal(0);
  function Counter() {
    return html`<button onclick=${() => count.value++}>c:${count}</button>`;
  }
  const btn = /** @type {HTMLElement} */ (mount(Counter, document.body));
  btn.click();
  flushSync();
  expect(btn.textContent).toBe('c:1');
  btn.click();
  btn.click();
  flushSync();
  expect(btn.textContent).toBe('c:3');
});

test('two instances from one call site are independent (template is cached)', () => {
  /** @param {*} s */
  const make = (s) => /** @type {Element} */ (html`<i>${s}</i>`);
  const a = signal('a');
  const b = signal('b');
  const e1 = make(a);
  const e2 = make(b);
  a.value = 'A';
  flushSync();
  expect(e1.textContent).toBe('A');
  expect(e2.textContent).toBe('b');
});

test('nested templates compose as constant Node holes', () => {
  const inner = html`<em>in</em>`;
  const el = /** @type {Element} */ (html`<div>[${inner}]</div>`);
  expect(el.innerHTML).toBe('[<em>in</em>]');
});

test('digits and Persian text in static content are not mistaken for markers', () => {
  const el = /** @type {Element} */ (html`<p>1404 و ۲۵</p>`);
  expect(el.textContent).toBe('1404 و ۲۵');
});

test('a re-running text hole skips the DOM write when the string is unchanged', () => {
  const n = signal(0);
  const el = /** @type {Element} */ (html`<p>${() => (n.value, 'ثابت')}</p>`);
  mount(el, document.body);
  const mo = new MutationObserver(() => {});
  mo.observe(el, { characterData: true, subtree: true });
  n.value = 1; // effect re-runs — output identical
  flushSync();
  expect(mo.takeRecords()).toHaveLength(0);
  mo.disconnect();
});

test('a re-running attr hole skips the DOM write when the value is unchanged', () => {
  const n = signal(0);
  const el = /** @type {Element} */ (html`<p class=${() => (n.value, 'same')}>t</p>`);
  mount(el, document.body);
  const mo = new MutationObserver(() => {});
  mo.observe(el, { attributes: true });
  n.value = 1;
  flushSync();
  expect(mo.takeRecords()).toHaveLength(0);
  mo.disconnect();
});
