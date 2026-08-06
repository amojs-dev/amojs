// @vitest-environment happy-dom
/**
 * AmoJS vs Lit — the honest head-to-head.
 *
 * Lit is the closest existing library to AmoJS: `html` tagged templates, zero
 * dependencies, no build step required, template cached once and cloned per
 * instance with positional paths to the dynamic parts. The same technique.
 *
 * The architectural difference is the UPDATE MODEL, and that is what this file
 * measures. Lit re-runs the template function and dirty-checks every Part
 * against its previous value. AmoJS wires one effect per hole to a signal
 * graph, so only the holes whose dependencies changed are even evaluated.
 *
 * Two scenarios, deliberately including the one where Lit's model should win:
 *   A. one of five bindings changes  → AmoJS should evaluate 1, Lit 5
 *   B. all five bindings change      → both do the same work; Lit does it in
 *      ONE pass while AmoJS wakes five effects
 *
 * Fairness notes:
 * - Lit is used through bare `lit-html` (html + render), NOT LitElement. That
 *   is Lit's SMALLEST configuration — no class, no decorators, no custom
 *   element, no shadow DOM. The trade-off, stated rather than hidden: bare
 *   lit-html needs a manual `render()` per update, whereas an AmoJS signal
 *   write updates on its own. LitElement automates that but costs more bytes.
 * - Both sides count the same thing: how many times a value expression that
 *   feeds a hole is computed, and how many DOM mutations reach the container.
 */
import { test, expect } from 'vitest';
import { html as litHtml, render as litRender } from 'lit';
import { signal, html, mount, flushSync } from 'amojs';

/** @returns the number of MutationRecords seen while running `fn` */
function countMutations(target: Element, fn: () => void): number {
  const mo = new MutationObserver(() => {});
  mo.observe(target, { childList: true, characterData: true, attributes: true, subtree: true });
  fn();
  const n = mo.takeRecords().length;
  mo.disconnect();
  return n;
}

/* ------------------------------------------------------------------ */
/* the same five-binding card, built each way                          */
/* ------------------------------------------------------------------ */

function amoCard() {
  const s = {
    a: signal(0), b: signal('b0'), c: signal('c0'), d: signal('d0'), e: signal('e0'),
  };
  let evals = 0;
  const host = document.createElement('div');
  document.body.append(host);
  const el = html`<div class="card"
    ><span>${() => (evals++, String(s.a.value))}</span
    ><span>${() => (evals++, s.b.value)}</span
    ><span>${() => (evals++, s.c.value)}</span
    ><span>${() => (evals++, s.d.value)}</span
    ><span>${() => (evals++, s.e.value)}</span
  ></div>`;
  mount(el, host);
  return {
    host,
    reset: () => (evals = 0),
    evals: () => evals,
    text: () => host.textContent,
    /** update whichever keys are given, then let effects run */
    update: (patch: Record<string, string | number>) => {
      for (const [k, v] of Object.entries(patch)) {
        (s as Record<string, { value: unknown }>)[k].value = v;
      }
      flushSync();
    },
  };
}

function litCard() {
  const s: Record<string, string | number> = { a: 0, b: 'b0', c: 'c0', d: 'd0', e: 'e0' };
  let evals = 0;
  const host = document.createElement('div');
  document.body.append(host);
  // Lit's unit of update is the whole template function
  const tpl = () => litHtml`<div class="card"
    ><span>${(evals++, String(s.a))}</span
    ><span>${(evals++, s.b)}</span
    ><span>${(evals++, s.c)}</span
    ><span>${(evals++, s.d)}</span
    ><span>${(evals++, s.e)}</span
  ></div>`;
  litRender(tpl(), host);
  return {
    host,
    reset: () => (evals = 0),
    evals: () => evals,
    text: () => host.textContent,
    update: (patch: Record<string, string | number>) => {
      Object.assign(s, patch);
      litRender(tpl(), host); // the manual step AmoJS does not need
    },
  };
}

/* ------------------------------------------------------------------ */

test('both render the same five bindings to start with', () => {
  const amo = amoCard();
  const lit = litCard();
  expect(amo.text()).toBe('0b0c0d0e0');
  expect(lit.text()).toBe('0b0c0d0e0');
  // building costs both sides five evaluations — no difference at mount
  expect(amo.evals()).toBe(5);
  expect(lit.evals()).toBe(5);
});

test('SCENARIO A — one binding changes: AmoJS evaluates 1, Lit evaluates all 5', () => {
  const amo = amoCard();
  const lit = litCard();
  amo.reset();
  lit.reset();

  const amoMut = countMutations(amo.host, () => amo.update({ a: 1 }));
  const litMut = countMutations(lit.host, () => lit.update({ a: 1 }));

  expect(amo.text()).toBe(lit.text()); // identical output
  console.log(
    `[lit] scenario A (1 of 5 changed) — evaluations: amo ${amo.evals()} vs lit ${lit.evals()} · ` +
      `DOM mutations: amo ${amoMut} vs lit ${litMut}`,
  );

  // the architectural difference, asserted
  expect(amo.evals()).toBe(1); // only the hole that read `a`
  expect(lit.evals()).toBe(5); // the whole template function re-ran
  // ...while the DOM work is identical: both write exactly one text node
  expect(amoMut).toBe(1);
  expect(litMut).toBe(1);
});

test('SCENARIO B — all five change: same work, and Lit needs no scheduler', () => {
  const amo = amoCard();
  const lit = litCard();
  amo.reset();
  lit.reset();

  const patch = { a: 9, b: 'b1', c: 'c1', d: 'd1', e: 'e1' };
  const amoMut = countMutations(amo.host, () => amo.update(patch));
  const litMut = countMutations(lit.host, () => lit.update(patch));

  expect(amo.text()).toBe(lit.text());
  console.log(
    `[lit] scenario B (5 of 5 changed) — evaluations: amo ${amo.evals()} vs lit ${lit.evals()} · ` +
      `DOM mutations: amo ${amoMut} vs lit ${litMut}`,
  );

  // HONEST RESULT: no advantage here. Both evaluate five expressions and write
  // five text nodes. Lit does it in one pass; AmoJS pays for five effect
  // wakeups to reach the same place. This is the case where fine-grained
  // granularity buys nothing — the mirror of the grouping benchmark.
  expect(amo.evals()).toBe(5);
  expect(lit.evals()).toBe(5);
  expect(amoMut).toBe(5);
  expect(litMut).toBe(5);
});

test('churn — writing the same values: AmoJS does nothing, Lit still re-evaluates', () => {
  const amo = amoCard();
  const lit = litCard();
  amo.reset();
  lit.reset();

  const same = { a: 0, b: 'b0', c: 'c0', d: 'd0', e: 'e0' };
  const amoMut = countMutations(amo.host, () => amo.update(same));
  const litMut = countMutations(lit.host, () => lit.update(same));

  console.log(
    `[lit] churn (same values) — evaluations: amo ${amo.evals()} vs lit ${lit.evals()} · ` +
      `DOM mutations: amo ${amoMut} vs lit ${litMut}`,
  );

  // AmoJS cuts off at the signal: an equal write wakes nobody at all
  expect(amo.evals()).toBe(0);
  // Lit re-runs the template, then its Parts dirty-check and skip the commit
  expect(lit.evals()).toBe(5);
  // neither touches the DOM — Lit's per-Part comparison is genuinely good
  expect(amoMut).toBe(0);
  expect(litMut).toBe(0);
});
