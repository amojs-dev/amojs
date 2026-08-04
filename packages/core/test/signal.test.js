import { test, expect } from 'vitest';
import { signal, computed, effect, flushSync } from '../src/signal.js';

test('signal: read / write / peek', () => {
  const s = signal(1);
  expect(s.value).toBe(1);
  s.value = 2;
  expect(s.peek()).toBe(2);
});

test('computed is lazy: computes nothing until read, then caches', () => {
  let runs = 0;
  const s = signal(1);
  const c = computed(() => {
    runs++;
    return s.value * 2;
  });
  expect(runs).toBe(0);
  expect(c.value).toBe(2);
  expect(runs).toBe(1);
  expect(c.value).toBe(2);
  expect(runs).toBe(1); // cached
});

test('an unread computed never recomputes, no matter how much you write', () => {
  let runs = 0;
  const s = signal(1);
  computed(() => {
    runs++;
    return s.value * 100;
  });
  s.value = 2;
  s.value = 3;
  flushSync();
  expect(runs).toBe(0);
});

test('effect runs immediately, then once per flush no matter how many writes', () => {
  let runs = 0;
  const s = signal(0);
  effect(() => {
    runs++;
    s.value;
  });
  expect(runs).toBe(1);
  s.value = 1;
  s.value = 2; // batched into the same flush
  flushSync();
  expect(runs).toBe(2);
});

test('cutoff at the source: same-value writes wake nobody (churn)', () => {
  let runs = 0;
  const s = signal(5);
  effect(() => {
    runs++;
    s.value;
  });
  for (let i = 0; i < 25; i++) s.value = 5;
  flushSync();
  expect(runs).toBe(1);
});

test('cutoff at computeds: a woken effect can prove itself clean and decline to run', () => {
  const count = signal(4);
  let evenRuns = 0;
  let labelRuns = 0;
  let effectRuns = 0;
  const isEven = computed(() => {
    evenRuns++;
    return count.value % 2 === 0;
  });
  const label = computed(() => {
    labelRuns++;
    return isEven.value ? 'even' : 'odd';
  });
  effect(() => {
    effectRuns++;
    label.value;
  });
  expect([evenRuns, labelRuns, effectRuns]).toEqual([1, 1, 1]);

  count.value = 6; // parity unchanged
  flushSync();
  expect(evenRuns).toBe(2); // had to check
  expect(labelRuns).toBe(1); // proven unnecessary — never ran
  expect(effectRuns).toBe(1); // slept through the whole thing

  count.value = 7; // parity flips
  flushSync();
  expect([evenRuns, labelRuns, effectRuns]).toEqual([3, 2, 2]);
});

test('diamond: one effect run per flush, values are consistent', () => {
  const a = signal(1);
  const b = computed(() => a.value * 2);
  const c = computed(() => a.value + 1);
  let runs = 0;
  let last = 0;
  effect(() => {
    runs++;
    last = b.value + c.value;
  });
  expect(last).toBe(4);
  a.value = 2;
  flushSync();
  expect(runs).toBe(2);
  expect(last).toBe(7);
});

test('dynamic dependencies retrack on every run', () => {
  const cond = signal(true);
  const x = signal('x');
  const y = signal('y');
  let runs = 0;
  let seen = '';
  effect(() => {
    runs++;
    seen = cond.value ? x.value : y.value;
  });
  expect(seen).toBe('x');

  y.value = 'y2'; // not a dependency yet
  flushSync();
  expect(runs).toBe(1);

  cond.value = false;
  flushSync();
  expect(seen).toBe('y2');

  x.value = 'x2'; // no longer a dependency
  flushSync();
  expect(runs).toBe(2);
});

test('dispose stops future runs', () => {
  const s = signal(0);
  let runs = 0;
  const stop = effect(() => {
    runs++;
    s.value;
  });
  stop();
  s.value = 1;
  flushSync();
  expect(runs).toBe(1);
});
