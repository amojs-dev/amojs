# AmoJS benchmark results — v0.6

**Date:** 2026-08-05 · **Machine:** Apple M4 Pro, node v24.12.0, happy-dom (no real browser)
**Versions:** @amojs/core 0.6.0-dev · solid-js 1.9.14 · @vue/reactivity 3.6.0-rc.2 (the alien-signals-based Vapor core) · alien-signals 3.2.1

Run with `pnpm bench`. Higher `hz` = better.

## Methodology & honest caveats

- **node, not a browser.** These measure reactive-graph bookkeeping, not
  rendering. Real-app performance is dominated by DOM work, which is covered
  separately by the DOM-work **parity gate** (`core/test/dom-work.test.js`):
  amo provably emits *exactly* the mutations a hand-written vanilla app does,
  and list moves are LIS-minimal (a swap = 2 moves).
- **amo batches effects into a microtask**; every write in these loops is
  followed by `flushSync()` so all four libraries do synchronous, comparable
  work. amo's numbers therefore include scheduler bookkeeping per write that
  the sync engines don't pay in this loop shape.
- **Svelte 5 is absent** deliberately: its reactivity is compiler-coupled
  internals, not a consumable library. The fair Svelte comparison is a
  full-app browser benchmark (js-framework-benchmark), planned for v1.0.
- solid-js is imported from its browser build (`dist/solid.js`) — the node
  build's `createEffect` is deliberately inert.

## Signal core — amo vs solid vs vue-vapor core vs alien-signals

```
diamond ×100 writes                     hz
  amo                             32,214.07
  solid                           40,644.21
  vue-vapor core                 187,471.80
  alien-signals                  210,587.50   ← 6.5× amo

chain(10) ×100 writes                   hz
  amo                             10,077.12
  solid                           11,197.68
  vue-vapor core                  61,919.19   ← 6.1× amo
  alien-signals                   59,650.21

fanout 1→50 effects, ×20 writes         hz
  amo                             11,908.66
  solid                           23,943.85
  vue-vapor core                  76,682.89
  alien-signals                   77,832.62   ← 6.5× amo

churn — 1000 same-value writes          hz
  amo                            250,408.24   ← beats solid (cutoff at source)
  solid                          208,753.29
  vue-vapor core               2,052,603.01
  alien-signals                1,268,868.69
```

**Reading:** amo's wv/three-flag core sits in Solid's neighborhood (ahead on
churn, behind on fanout) and ~6× behind the alien-signals linked-list
architecture at pure-graph micro scale — exactly what the source study
predicted. This gap is invisible behind real DOM work, but it fixes the
direction for a future core rewrite (alien's Link/no-Set/no-recursion
design), which stays a v1.0+ option, not a v0.x priority.

## The adaptive-grouping hypothesis — measured before designed

```
shared dep — 3 holes ← 1 signal, ×100 toggles       hz
  fine-grained (amo today: 3 effects)          23,290.97
  grouped (svelte-style: 1 effect)             33,507.41   ← 1.44× faster

independent deps — 3 holes ← 3 signals, one written  hz
  fine-grained (amo today: only 1 effect wakes) 48,676.20   ← 1.31× faster
  grouped (svelte-style: re-evaluates all 3)    37,294.59
```

**Verdict: the hypothesis survives.** Grouping wins 1.44× when holes share
one dependency (the classic row-toggle) and loses 1.31× when dependencies
are independent — both effects are real and comparable in size. An ADAPTIVE
compiler pass — group only holes whose dependency sets are provably
identical, keep the rest fine-grained — would take the win without paying
the loss. Neither Svelte (always grouped per fragment) nor Vapor (always
per-binding) does this. Filed as a compiler-optimization candidate for a
later milestone; magnitudes are tens-of-percent on JS bookkeeping, so it
ranks below correctness and size work.

## Size gates (enforced in CI, `core/test/size.test.js` + identity benchmark)

| gate | measured | budget |
|---|---|---|
| compiled counter app, ALL-IN (bundle+min+gz) | **1778 B** | ≤ 2048 B |
| framework minus parser, bundled | 2192 B | ≤ 2560 B |
| raw-ESM everything incl. parser, per-file sum | 3976 B | ≤ 4096 B |

The first row is the number frameworks quote: a complete compiled AmoJS
counter — runtime included — costs **1.78 KB**. A Svelte 5 hello-world lands
around 4–6 KB on the same metric; alien-signals' famous 1.95 KB is the graph
alone, with no DOM layer at all.
