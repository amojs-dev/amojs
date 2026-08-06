# AmoJS benchmark results — v0.6

**Date:** 2026-08-05 · **Machine:** Apple M4 Pro, node v24.12.0, happy-dom (no real browser)
**Versions:** amojs 0.6.0-dev · solid-js 1.9.14 · @vue/reactivity 3.6.0-rc.2 (the alien-signals-based Vapor core) · alien-signals 3.2.1

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

## AmoJS vs Lit — the closest existing library

Lit deserves its own section because it is the nearest neighbour, not a distant
competitor: `html` tagged templates, zero dependencies, no build step required,
template cached once and cloned per instance with positional paths to the
dynamic parts. **The same technique.** The difference is the update model, and
that is what these numbers isolate. Enforced by `lit.test.ts` and
`lit-size.test.ts` (Lit 3.3.3).

**Fairness:** Lit is measured through bare `html` + `render` — its *smallest*
configuration, no LitElement, no decorators, no custom element, no shadow DOM.
Anything more only adds bytes on Lit's side. Stated rather than hidden: bare
lit-html needs a manual `render()` per update, while an AmoJS signal write
updates by itself; LitElement automates that and costs more.

### Expression evaluations per update — a card with five text bindings

| scenario | AmoJS | Lit | DOM mutations |
|---|---|---|---|
| **1 of 5 bindings changes** | **1** | 5 | 1 vs 1 |
| 5 of 5 bindings change | 5 | 5 | 5 vs 5 |
| churn — same values rewritten | **0** | 5 | 0 vs 0 |

**Reading it honestly.** Row 1 is the architectural win: Lit re-runs the whole
template function and dirty-checks every Part, so all five expressions are
recomputed to discover that four did not change. AmoJS wakes exactly the one
effect whose signal moved; the other four are never evaluated. Row 3 is the
same story at the source — an equal write in AmoJS wakes nobody at all.

**Row 2 is where fine-grained granularity buys nothing** — both do five
evaluations and five DOM writes, and Lit reaches that in one pass while AmoJS
pays for five effect wakeups. This mirrors the grouping result above. Also
worth saying plainly: Lit's per-Part comparison is genuinely good — the DOM
mutation column is a tie in every row. Neither library does wasted DOM work.

### Shipped bytes — the same app, bundled + minified + gzipped

The app: a card with five dynamic bindings, an event listener, and a keyed list
(`each` vs Lit's `repeat` directive), runtime included.

| | min+gz |
|---|---|
| **AmoJS (compiled)** | **2,336 B** |
| Lit (bare, smallest config) | 6,890 B |

**Lit is 2.95× larger for the same app** — and that is Lit at its smallest.

### What these numbers do NOT measure

Ecosystem, SSR, tooling maturity, browser-vendor buy-in, and five years of
production hardening — all of which Lit has and AmoJS does not. Being
technically distinct is not the same as winning adoption.

## Size gates (enforced in CI, `core/test/size.test.js` + identity benchmark)

Measured 2026-08-06 (core 0.6.4-dev), after the form-control, `onMount`/`ref`
and event-hole work. The per-file rows are the two real shipping shapes: a
no-build app loads the parser, a compiled app never does.

| gate | measured | budget | headroom |
|---|---|---|---|
| compiled counter app, ALL-IN (bundle+min+gz) | **1982 B** | ≤ 2048 B | 66 B |
| framework minus parser, bundled | 2520 B | ≤ 2560 B | 40 B |
| shape A — no-build app, parser included, per-file sum | 4020 B | ≤ 4096 B | 76 B |
| shape B — compiled app, no parser, per-file sum | 3248 B | ≤ 3328 B | 80 B |
| identity: compiled ÷ hand-written vanilla (gz) | **1.087** | ≤ 1.10 | — |

The first row is the number frameworks quote: a complete compiled AmoJS
counter — runtime included — costs **1.98 KB**. A Svelte 5 hello-world lands
around 4–6 KB on the same metric; alien-signals' famous 1.95 KB is the graph
alone, with no DOM layer at all.

**Headroom is now the binding constraint, not the budget.** Every gate passes,
but all four sit within 40–80 B of their lid, so the next feature that touches
the shipped runtime has to pay for itself in architecture (the `/runtime` entry
is the template for that) rather than in bytes. Two v0.6-era numbers moved for
recorded reasons: form-control properties cost +154 B, and routing event holes
through a shared `bindEvent` cost +59 B on shape A while making compiled output
*smaller* (`_$event(…)` beats `.addEventListener(…)`), which is why the identity
ratio improved from 1.089 to 1.087.
