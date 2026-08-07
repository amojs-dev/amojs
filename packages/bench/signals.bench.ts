/**
 * Signal-core micro-benchmarks: amojs vs the reactivity engines of
 * Solid, Vue Vapor (@vue/reactivity 3.6 = alien-based) and alien-signals.
 *
 * Methodology notes (also in RESULTS.md):
 * - node, not a browser — this measures graph bookkeeping, not rendering.
 * - amo batches effects into a microtask; every write here is followed by
 *   flushSync() so all four libraries do synchronous, comparable work.
 * - solid-js is imported from its browser build: the node build's
 *   createEffect is deliberately inert.
 */
import { bench, describe } from 'vitest';
import {
  signal as aSignal, computed as aComputed, effect as aEffect, flushSync,
} from '@amojs.dev/core/runtime';
import {
  createRoot, createSignal, createMemo, createEffect,
} from 'solid-js/dist/solid.js';
import { ref, computed as vComputed, effect as vEffect } from '@vue/reactivity';
import {
  signal as lSignal, computed as lComputed, effect as lEffect,
} from 'alien-signals';

let sink = 0;

/* ---------------- diamond: a → (b, c) → effect ---------------- */

describe('diamond ×100 writes', () => {
  {
    const a = aSignal(1);
    const b = aComputed(() => a.value * 2);
    const c = aComputed(() => a.value + 1);
    aEffect(() => { sink = b.value + c.value; });
    bench('amo', () => {
      for (let i = 0; i < 100; i++) { a.value = i; flushSync(); }
    });
  }
  createRoot(() => {
    const [a, setA] = createSignal(1);
    const b = createMemo(() => a() * 2);
    const c = createMemo(() => a() + 1);
    createEffect(() => { sink = b() + c(); });
    bench('solid', () => {
      for (let i = 0; i < 100; i++) setA(i);
    });
  });
  {
    const a = ref(1);
    const b = vComputed(() => a.value * 2);
    const c = vComputed(() => a.value + 1);
    vEffect(() => { sink = b.value + c.value; });
    bench('vue-vapor core', () => {
      for (let i = 0; i < 100; i++) a.value = i;
    });
  }
  {
    const a = lSignal(1);
    const b = lComputed(() => a() * 2);
    const c = lComputed(() => a() + 1);
    lEffect(() => { sink = b() + c(); });
    bench('alien-signals', () => {
      for (let i = 0; i < 100; i++) a(i);
    });
  }
});

/* ---------------- chain of 10 computeds ---------------- */

describe('chain(10) ×100 writes', () => {
  {
    const src = aSignal(0);
    let last = aComputed(() => src.value + 1);
    for (let d = 1; d < 10; d++) { const p = last; last = aComputed(() => p.value + 1); }
    aEffect(() => { sink = last.value; });
    bench('amo', () => {
      for (let i = 0; i < 100; i++) { src.value = i; flushSync(); }
    });
  }
  createRoot(() => {
    const [src, setSrc] = createSignal(0);
    let last = createMemo(() => src() + 1);
    for (let d = 1; d < 10; d++) { const p = last; last = createMemo(() => p() + 1); }
    createEffect(() => { sink = last(); });
    bench('solid', () => {
      for (let i = 0; i < 100; i++) setSrc(i);
    });
  });
  {
    const src = ref(0);
    let last = vComputed(() => src.value + 1);
    for (let d = 1; d < 10; d++) { const p = last; last = vComputed(() => p.value + 1); }
    vEffect(() => { sink = last.value; });
    bench('vue-vapor core', () => {
      for (let i = 0; i < 100; i++) src.value = i;
    });
  }
  {
    const src = lSignal(0);
    let last = lComputed(() => src() + 1);
    for (let d = 1; d < 10; d++) { const p = last; last = lComputed(() => p() + 1); }
    lEffect(() => { sink = last(); });
    bench('alien-signals', () => {
      for (let i = 0; i < 100; i++) src(i);
    });
  }
});

/* ---------------- fanout: 1 signal → 50 effects ---------------- */

describe('fanout 1→50 effects, ×20 writes', () => {
  {
    const s = aSignal(0);
    for (let i = 0; i < 50; i++) aEffect(() => { sink = s.value + i; });
    bench('amo', () => {
      for (let i = 0; i < 20; i++) { s.value = i; flushSync(); }
    });
  }
  createRoot(() => {
    const [s, setS] = createSignal(0);
    for (let i = 0; i < 50; i++) createEffect(() => { sink = s() + i; });
    bench('solid', () => {
      for (let i = 0; i < 20; i++) setS(i);
    });
  });
  {
    const s = ref(0);
    for (let i = 0; i < 50; i++) vEffect(() => { sink = s.value + i; });
    bench('vue-vapor core', () => {
      for (let i = 0; i < 20; i++) s.value = i;
    });
  }
  {
    const s = lSignal(0);
    for (let i = 0; i < 50; i++) lEffect(() => { sink = s() + i; });
    bench('alien-signals', () => {
      for (let i = 0; i < 20; i++) s(i);
    });
  }
});

/* ---------------- churn: 1000 same-value writes (cutoff) ---------------- */

describe('churn — 1000 same-value writes', () => {
  {
    const s = aSignal(7);
    aEffect(() => { sink = s.value; });
    bench('amo', () => {
      for (let i = 0; i < 1000; i++) s.value = 7;
      flushSync();
    });
  }
  createRoot(() => {
    const [s, setS] = createSignal(7);
    createEffect(() => { sink = s(); });
    bench('solid', () => {
      for (let i = 0; i < 1000; i++) setS(7);
    });
  });
  {
    const s = ref(7);
    vEffect(() => { sink = s.value; });
    bench('vue-vapor core', () => {
      for (let i = 0; i < 1000; i++) s.value = 7;
    });
  }
  {
    const s = lSignal(7);
    lEffect(() => { sink = s(); });
    bench('alien-signals', () => {
      for (let i = 0; i < 1000; i++) s(7);
    });
  }
});
