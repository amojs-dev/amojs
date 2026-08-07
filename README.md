# AmoJS

**Compiles to the vanilla JS you would have written.**

A build-time compiler and a fine-grained reactive runtime for UI. You write
standard JavaScript — signals plus `` html`` `` tagged templates — and it runs
in the browser with no build step at all. The compiler is an optimizer, not a
requirement. No virtual DOM, no re-render-and-diff, zero runtime dependencies.

A complete compiled counter app — runtime included, minified and gzipped — is
**1.98 KB**.

```js
import { signal, computed, html, mount } from '@amojs.dev/core';

function Counter() {
  const count = signal(0);
  const double = computed(() => count.value * 2);

  return html`
    <div>
      <p>count = ${count} · double = ${double}</p>
      <button onclick=${() => count.value++}>+1</button>
    </div>`;
}

mount(Counter, document.getElementById('app'));
```

> **Pre-1.0.** Published so the name is claimed and tooling can depend on a real
> version. There is no router, no SSR, and no documentation site yet — see
> [packages/core/README.md](packages/core/README.md#status--what-is-not-here)
> for the full list of what is missing.

## Packages

| package | what it is | published |
|---|---|---|
| [`@amojs.dev/core`](packages/core) | the runtime — signals, `` html`` ``, `mount`. Plain JS, ships to browsers raw. Subpaths `@amojs.dev/core/runtime` and `@amojs.dev/core/compiled` never load the template parser. | yes |
| [`@amojs.dev/compiler`](packages/compiler) | parse → IR → codegen, plus `build`, `eject` and `diagnose`. TypeScript, runs on node only. | yes |
| [`@amojs.dev/cli`](packages/cli) | the `amo` binary — `amo build`, `amo eject`. | yes |
| `@amojs.dev/bench` | micro-benchmarks. Competitor libraries are quarantined here so the runtime keeps zero dependencies. | never |

Editor support lives in a separate repository:
[`amojs-dev/language-tools`](https://github.com/amojs-dev/language-tools) —
template highlighting, embedded HTML/JS IntelliSense, and inline diagnostics
produced by this compiler's own parser, so the editor and `amo build` cannot
disagree.

## What is enforced in CI

Every claim above is a gate, not an adjective.

| gate | measured | budget |
|---|---|---|
| compiled counter app, all-in (bundle + min + gz) | **1982 B** | ≤ 2048 B |
| runtime minus template parser, bundled | 2520 B | ≤ 2560 B |
| no-build app, template parser included | 4020 B | ≤ 4096 B |
| compiled bytes ÷ hand-written vanilla bytes | **1.087** | ≤ 1.10 |

Plus two correctness gates that are the real point:

- **DOM-work parity.** AmoJS emits exactly the mutations a hand-written vanilla
  app does — create, update, churn, toggle, append, prepend, remove, clear —
  and list moves are LIS-minimal (swap = 2, reverse = n−1, rotate = 1).
- **Both modes, one meaning.** Every golden fixture is executed raw *and*
  compiled and asserted identical. The uncompiled runtime is the semantic
  source of truth; the compiler may only be faster and smaller.

Benchmark numbers and their caveats live in
[`packages/bench/RESULTS.md`](packages/bench/RESULTS.md).

## Design rules

These are locked, and the codebase is shaped by them:

1. **A hole is a constant, a signal, or a function** — same meaning compiled
   and uncompiled.
2. **Zero runtime dependencies.** Compiler-side dependencies run on node and
   never reach a browser.
3. **The uncompiled runtime is the semantic source of truth.**
4. **The IR never names DOM APIs.** It describes intent, so a second target is
   a second codegen, not a rewrite.
5. **Browser-shipped code is JS + JSDoc** (type-checked with `tsc --checkJs`);
   **node-only code is TypeScript.**
6. **No custom file extension.** The compiler finds its targets by the
   `import … from '@amojs.dev/core'` statement, never by filename.
7. **The compiler stays dumb.** It rewrites templates and specifiers and
   touches nothing else — no module-boundary reasoning, no lazy-loading, no
   closure serialization. A local, mechanical rewrite can be trusted next to
   any other tool.

Deliberately never built: hydration, a virtual DOM, a component API or
lifecycle object, deep reactivity via Proxy, global event delegation, and a
styling solution inside the core.

## Development

```bash
pnpm install     # dev tooling only — vitest, happy-dom, esbuild, tsc
pnpm test        # unit, golden, size, parity and e2e suites
pnpm build       # compile @amojs.dev/compiler and @amojs.dev/cli to dist/
pnpm check       # build, then type-check everything including JS via JSDoc
pnpm bench       # reactive-graph micro-benchmarks
pnpm amo build <src> <out>                     # the CLI, after pnpm build
pnpm amo eject <src> <out> [--runtime <dir>]
```

Package manager is **pnpm**; `pnpm-workspace.yaml` drives the monorepo.

## License

MIT © Hamidreza Behzadi
