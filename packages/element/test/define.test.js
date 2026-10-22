// @vitest-environment happy-dom
import { test, expect } from 'vitest';
import { signal, html, flushSync, onCleanup, onMount } from '@amojs.dev/core';
import { define } from '../src/index.js';

/** @param {ParentNode} parent */
const button = (parent) => /** @type {HTMLButtonElement} */ (parent.querySelector('button'));

test('attr → signal, click, setAttribute, remove leaves nothing, re-add mounts one copy', () => {
  /** @type {any} */
  let props;
  /** @type {any} */
  let clicks;
  define('x-counter', (p) => {
    props = p;
    clicks = signal(0);
    return html`<button onclick=${() => clicks.value++}>${() => Number(p.start.value) + clicks.value}</button>`;
  }, { attrs: ['start'] });

  const el = document.createElement('x-counter');
  el.setAttribute('start', '5');
  document.body.append(el);
  expect(el.querySelectorAll('button').length).toBe(1);
  expect(button(el).textContent).toBe('5');

  button(el).click();
  flushSync();
  expect(button(el).textContent).toBe('6');

  el.setAttribute('start', '9');
  expect(props.start.peek()).toBe('9'); // the prop signal follows the attribute synchronously
  flushSync();
  expect(button(el).textContent).toBe('10');

  const start = props.start;
  const firstClicks = clicks;
  expect(start.subs.size).toBe(1);
  el.remove();
  expect(start.subs.size).toBe(0); // baseline: nothing subscribes to an unmounted element's props
  expect(firstClicks.subs.size).toBe(0);
  expect(el.childNodes.length).toBe(0); // the output and the range anchor are both gone

  document.body.append(el);
  expect(el.querySelectorAll('button').length).toBe(1);
  expect(button(el).textContent).toBe('9'); // a fresh instance: local state resets, the attribute stays
  button(el).click();
  flushSync();
  expect(button(el).textContent).toBe('10');
  expect(start.subs.size).toBe(1);
  el.remove();
});

test('the returned class is the registered one', () => {
  const C = define('x-same', () => html`<p></p>`);
  expect(customElements.get('x-same')).toBe(C);
  expect(document.createElement('x-same')).toBeInstanceOf(C);
});

test('props are typed from attrs (checked by tsc)', () => {
  define('x-typed', (p) => {
    // @ts-expect-error — only names listed in attrs become props
    p.missing;
    return html`<b>${p.start}</b>`;
  }, { attrs: ['start'] });
  const el = document.createElement('x-typed');
  el.setAttribute('start', '1');
  document.body.append(el);
  expect(el.innerHTML).toBe('<b>1</b>');
  el.remove();
});

test('an element already in the markup upgrades and reads its attributes', () => {
  document.body.innerHTML = '<x-late start="3"></x-late>';
  define('x-late', ({ start }) => html`<b>${start}</b>`, { attrs: ['start'] });
  const el = /** @type {Element} */ (document.querySelector('x-late'));
  expect(el.innerHTML).toBe('<b>3</b>');
  el.remove();
});

test('attribute changes while disconnected are there on reconnect; removal gives null', () => {
  define('x-attr', ({ label }) => html`<b>${() => String(label.value)}</b>`, { attrs: ['label'] });
  const el = document.createElement('x-attr');
  el.setAttribute('label', 'a');
  document.body.append(el);
  el.remove();
  el.setAttribute('label', 'b');
  document.body.append(el);
  expect(el.innerHTML).toBe('<b>b</b>');
  el.removeAttribute('label');
  flushSync();
  expect(el.innerHTML).toBe('<b>null</b>');
  el.remove();
});

test('host is the element: events dispatch from it, light-DOM children are readable and survive a move', () => {
  /** @type {HTMLElement | undefined} */
  let seen;
  // markup first, then define — the upgrade order a module script gives, so the children are parsed
  document.body.innerHTML = '<x-greet>Ada</x-greet>';
  define('x-greet', ({ host }) => {
    seen = host;
    const who = host.textContent;
    return html`<button onclick=${() => host.dispatchEvent(new CustomEvent('greet', { detail: who }))}>hi ${who}</button>`;
  });
  const el = /** @type {HTMLElement} */ (document.querySelector('x-greet'));
  expect(seen).toBe(el);
  expect(el.innerHTML).toBe('Ada<button>hi Ada</button>');

  /** @type {unknown[]} */
  const got = [];
  el.addEventListener('greet', (e) => got.push(/** @type {CustomEvent} */ (e).detail));
  button(el).click();
  expect(got).toEqual(['Ada']);

  el.remove();
  expect(el.innerHTML).toBe('Ada'); // the page's children are not ours to remove
  document.body.append(el);
  expect(el.innerHTML).toBe('Ada<button>hi Ada</button>');
  el.remove();
});

test('a top-level hole keeps one copy across moves (its nodes sit before its anchor)', () => {
  const on = signal(true);
  define('x-swap', () => html`${() => (on.value ? html`<i>on</i>` : html`<b>off</b>`)}`);
  const el = document.createElement('x-swap');
  document.body.append(el);
  expect(el.innerHTML).toBe('<i>on</i>');
  on.value = false;
  flushSync();
  expect(el.innerHTML).toBe('<b>off</b>');

  el.remove();
  expect(el.childNodes.length).toBe(0);
  expect(on.subs.size).toBe(0);

  document.body.append(el);
  expect(el.innerHTML).toBe('<b>off</b>');
  on.value = true;
  flushSync();
  expect(el.innerHTML).toBe('<i>on</i>');
  el.remove();
});

test('onMount sees a connected node; onCleanup runs on disconnect', () => {
  /** @type {string[]} */
  const log = [];
  define('x-life', () => {
    const p = /** @type {Element} */ (html`<p>x</p>`);
    onMount(() => log.push(`mount:${p.isConnected}`));
    onCleanup(() => log.push('cleanup'));
    return p;
  });
  const el = document.createElement('x-life');
  document.body.append(el);
  expect(log).toEqual(['mount:true']);
  el.remove();
  expect(log).toEqual(['mount:true', 'cleanup']);
});

test('shadow: open mounts under shadowRoot, and the same root is reused on reconnect', () => {
  define('x-open', () => html`<button>s</button>`, { shadow: 'open' });
  const el = document.createElement('x-open');
  el.textContent = 'light';
  document.body.append(el);
  const sr = /** @type {ShadowRoot} */ (el.shadowRoot);
  expect(sr.querySelectorAll('button').length).toBe(1);
  expect(el.innerHTML).toBe('light'); // the light DOM is untouched

  el.remove();
  expect(sr.childNodes.length).toBe(0);
  document.body.append(el);
  expect(el.shadowRoot).toBe(sr);
  expect(sr.querySelectorAll('button').length).toBe(1);
  el.remove();
});

test('shadow: closed mounts into a root the page cannot reach', () => {
  /** @type {Node | undefined} */
  let node;
  define('x-closed', () => (node = html`<button>c</button>`), { shadow: 'closed' });
  const el = document.createElement('x-closed');
  document.body.append(el);
  expect(el.shadowRoot).toBe(null);
  expect(el.childNodes.length).toBe(0);
  const sr = /** @type {ShadowRoot} */ (/** @type {Node} */ (node).getRootNode());
  expect(sr.host).toBe(el);
  expect(sr.mode).toBe('closed');
  el.remove();
});

test('a name already defined throws — never a silent skip, never a redefinition', () => {
  define('x-dup', () => html`<p></p>`);
  expect(() => define('x-dup', () => html`<p></p>`)).toThrowError(/^amo: <x-dup> is already defined$/);
  customElements.define('x-taken', class extends HTMLElement {});
  expect(() => define('x-taken', () => html`<p></p>`)).toThrowError(/^amo: <x-taken> is already defined$/);
});

test('an invalid name is the platform\'s error, not ours', () => {
  /** @type {any} */
  let err;
  try {
    define('nohyphen', () => html`<p></p>`);
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(String(err.message)).not.toMatch(/^amo:/);
});
