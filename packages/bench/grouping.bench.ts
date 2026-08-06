// @vitest-environment happy-dom
/**
 * THE ADAPTIVE-GROUPING HYPOTHESIS, measured before designed.
 *
 * render-lab showed the granularity trade-off: Svelte-style GROUPING (one
 * effect re-checks a whole row) vs fine-grained (one effect per hole — amo
 * and Vapor today). Grouping wins when several holes share ONE dependency;
 * it loses when deps are independent (every run re-evaluates everything).
 * If the compiler could prove "these holes read exactly the same signals"
 * it could group them at build time. These benches tell us whether that
 * optimization is worth its complexity — with numbers, not vibes.
 */
import { bench, describe } from 'vitest';
import { signal, effect, flushSync } from 'amojs/runtime';

function textNodes(n: number): Text[] {
  const host = document.createElement('div');
  document.body.append(host);
  return Array.from({ length: n }, () => {
    const t = document.createTextNode('');
    host.append(t);
    return t;
  });
}

/* -------- case 1: three holes, ONE shared dependency (a row's `done`) -------- */

describe('shared dep — 3 holes ← 1 signal, ×100 toggles', () => {
  {
    const done = signal(false);
    const [t1, t2, t3] = textNodes(3);
    effect(() => { const v = done.value ? 'done' : ''; if (t1.data !== v) t1.data = v; });
    effect(() => { const v = done.value ? 'on' : 'off'; if (t2.data !== v) t2.data = v; });
    effect(() => { const v = done.value ? '✓' : ' '; if (t3.data !== v) t3.data = v; });
    bench('fine-grained (amo today: 3 effects)', () => {
      for (let i = 0; i < 100; i++) { done.value = !done.peek(); flushSync(); }
    });
  }
  {
    const done = signal(false);
    const [t1, t2, t3] = textNodes(3);
    effect(() => {
      const d = done.value;
      const v1 = d ? 'done' : ''; if (t1.data !== v1) t1.data = v1;
      const v2 = d ? 'on' : 'off'; if (t2.data !== v2) t2.data = v2;
      const v3 = d ? '✓' : ' '; if (t3.data !== v3) t3.data = v3;
    });
    bench('grouped (svelte-style: 1 effect)', () => {
      for (let i = 0; i < 100; i++) { done.value = !done.peek(); flushSync(); }
    });
  }
});

/* -------- case 2: three holes, INDEPENDENT dependencies, one changes -------- */

describe('independent deps — 3 holes ← 3 signals, only #1 written ×100', () => {
  {
    const s1 = signal(0); const s2 = signal(0); const s3 = signal(0);
    const [t1, t2, t3] = textNodes(3);
    effect(() => { const v = String(s1.value); if (t1.data !== v) t1.data = v; });
    effect(() => { const v = String(s2.value); if (t2.data !== v) t2.data = v; });
    effect(() => { const v = String(s3.value); if (t3.data !== v) t3.data = v; });
    bench('fine-grained (amo today: only 1 effect wakes)', () => {
      for (let i = 0; i < 100; i++) { s1.value = i; flushSync(); }
    });
  }
  {
    const s1 = signal(0); const s2 = signal(0); const s3 = signal(0);
    const [t1, t2, t3] = textNodes(3);
    effect(() => {
      const v1 = String(s1.value); if (t1.data !== v1) t1.data = v1;
      const v2 = String(s2.value); if (t2.data !== v2) t2.data = v2;
      const v3 = String(s3.value); if (t3.data !== v3) t3.data = v3;
    });
    bench('grouped (svelte-style: re-evaluates all 3)', () => {
      for (let i = 0; i < 100; i++) { s1.value = i; flushSync(); }
    });
  }
});
