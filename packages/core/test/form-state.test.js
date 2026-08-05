// @vitest-environment happy-dom
/**
 * FORM STATE — the attribute-vs-property trap.
 *
 * Found by reading the open issues of Solid, Lit, Vue and Svelte: every one of
 * them had to special-case this, and AmoJS had the same four bugs. For form
 * controls the attribute is only the DEFAULT value; the live property is what
 * the user sees. Writing the property is also what a human writing vanilla
 * does, so this makes the output MORE vanilla, not more magical.
 *
 * Each test below is a bug that was real and confirmed in Chrome.
 */
import { test, expect } from 'vitest';
import { signal, html, mount, flushSync, each } from '../src/index.js';

test('input value reaches the user after they have typed', () => {
  const v = signal('one');
  const el = /** @type {HTMLInputElement} */ (html`<input value=${v}>`);
  mount(el, document.body);
  expect(el.value).toBe('one');

  el.value = 'typed by user'; // the user types over it
  v.value = 'two'; // the app pushes a new value
  flushSync();

  expect(el.value).toBe('two'); // was 'typed by user' before the fix
});

test('checkbox checked follows the signal', () => {
  const on = signal(false);
  const el = /** @type {HTMLInputElement} */ (html`<input type="checkbox" checked=${on}>`);
  mount(el, document.body);
  expect(el.checked).toBe(false);

  on.value = true;
  flushSync();
  expect(el.checked).toBe(true); // the attribute alone never did this

  on.value = false;
  flushSync();
  expect(el.checked).toBe(false);
});

test('DOCUMENTED: a control with no write-back is uncontrolled, exactly like vanilla', () => {
  // The user clicks, so the DOM property becomes true while the signal is
  // still false. Writing `false` to the signal is then a no-op (equality
  // cutoff), so nothing re-asserts the DOM and the two stay diverged.
  //
  // This is NOT a bug to fix — it is what hand-written vanilla does too:
  // `effect(() => cb.checked = on.value)` re-runs only when `on` changes.
  // Wiring the event back into the signal is the documented pattern, and the
  // test below proves that pattern keeps them in sync forever.
  const on = signal(false);
  const loose = /** @type {HTMLInputElement} */ (html`<input type="checkbox" checked=${on}>`);
  mount(loose, document.body);
  loose.click();
  on.value = false; // same value the signal already held → nobody wakes
  flushSync();
  expect(loose.checked).toBe(true); // diverged, and honestly so

  // the documented pattern: the event writes back
  const bound = signal(false);
  const tied = /** @type {HTMLInputElement} */ (
    html`<input type="checkbox" checked=${bound}
      onchange=${(/** @type {Event} */ e) =>
        (bound.value = /** @type {HTMLInputElement} */ (e.target).checked)}>`
  );
  mount(tied, document.body);
  tied.click();
  flushSync();
  expect(bound.peek()).toBe(true); // state followed the user
  bound.value = false; // now the app can drive it again
  flushSync();
  expect(tied.checked).toBe(false);
});

test('textarea value is not silently dropped', () => {
  const t = signal('hello');
  const ta = /** @type {HTMLTextAreaElement} */ (html`<textarea value=${t}></textarea>`);
  mount(ta, document.body);
  flushSync();
  expect(ta.value).toBe('hello'); // was '' before the fix — textarea has no value attribute

  t.value = 'goodbye';
  flushSync();
  expect(ta.value).toBe('goodbye');
});

test('select picks the right option when the options come from each()', () => {
  const opts = signal(['a', 'b', 'c']);
  const chosen = signal('b');
  const el = /** @type {HTMLSelectElement} */ (
    html`<select value=${chosen}>${each(opts, (o) => o, (o) =>
      html`<option value=${o}>${o}</option>`)}</select>`
  );
  mount(el, document.body);
  flushSync();

  // two separate bugs met here: setAttribute does nothing on <select>, AND the
  // reversed insertion order left the LAST option selected
  expect(el.value).toBe('b');
  expect(el.selectedIndex).toBe(1);

  chosen.value = 'c';
  flushSync();
  expect(el.value).toBe('c');
});

test('a fresh list is inserted in document order, like an append loop', () => {
  const items = signal(['x', 'y', 'z']);
  const el = /** @type {Element} */ (
    html`<ul>${each(items, (k) => k, (k) => html`<li>${k}</li>`)}</ul>`
  );
  mount(el, document.body);
  const mo = new MutationObserver(() => {});
  mo.observe(el, { childList: true });

  items.value = ['1', '2', '3']; // full replacement — nothing reused
  flushSync();

  /** @type {string[]} */
  const inserted = [];
  for (const m of mo.takeRecords()) {
    for (const n of m.addedNodes) inserted.push(n.textContent ?? '');
  }
  mo.disconnect();
  expect(inserted).toEqual(['1', '2', '3']); // was ['3','2','1'] before the fix
});

test('attributes that stay in sync with their property are still attributes', () => {
  // `disabled` and `class` must NOT become property writes: the attribute is
  // the truth for them, and compiled output must keep emitting setAttribute
  const off = signal(true);
  const el = /** @type {HTMLButtonElement} */ (
    html`<button disabled=${off} class=${() => 'btn'}>x</button>`
  );
  mount(el, document.body);
  expect(el.hasAttribute('disabled')).toBe(true);
  expect(el.getAttribute('class')).toBe('btn');

  off.value = false;
  flushSync();
  expect(el.hasAttribute('disabled')).toBe(false);
  expect(el.disabled).toBe(false);
});

test('a value hole on an element with no such property stays an attribute', () => {
  // <div value=...> is a plain custom attribute — writing el.value would
  // create a dead JS property and never reach the DOM
  const v = signal('7');
  const el = /** @type {Element} */ (html`<div value=${v}>x</div>`);
  mount(el, document.body);
  expect(el.getAttribute('value')).toBe('7');

  v.value = '8';
  flushSync();
  expect(el.getAttribute('value')).toBe('8');
});
