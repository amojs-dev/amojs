# AmoJS

**Compiles to the vanilla JS you would have written.**

AmoJS is a fine-grained reactive UI library that a build-time compiler can
optimize — but never requires. You write standard JavaScript: signals plus
`` html`` `` tagged templates. It runs in the browser with no build step, no
bundler, and no configuration. No virtual DOM, no re-render-and-diff, and zero
runtime dependencies.

A complete compiled counter app — runtime included, minified and gzipped —
is **1.98 KB**.

> **Pre-1.0.** This is published so the name is claimed and tooling can depend
> on a real version. The core is well tested and the size and correctness gates
> below run in CI, but there is no router, no SSR, and no documentation site
> yet. Read [Status](#status--what-is-not-here) before adopting it. The API may
> still change.

---

## Install

```bash
npm install @amojs.dev/core
```

Or skip installing altogether — it is plain ESM, so a browser can load it
directly:

```html
<script type="importmap">
  { "imports": { "@amojs.dev/core": "https://esm.sh/@amojs.dev/core" } }
</script>
<script type="module" src="./app.js"></script>
```

## The whole idea

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

That file is the deployable artifact. There is no compile step between what you
wrote and what the browser runs.

A component is a plain function that returns a `Node`. Props are its arguments.
Composition is `import`. There is no component API, no lifecycle object, and no
file format — your file already runs.

### How a hole is bound

A template hole is exactly one of three things, and it means the same thing
compiled or not:

```js
html`<p>${'written once'}</p>`          // a constant   — written at build time
html`<p>${count}</p>`                    // a signal     — bound reactively
html`<p>${() => a.value * b.value}</p>`  // a function   — wrapped in an effect
```

Each hole gets its own tiny effect. When one signal changes, exactly one
expression re-evaluates and exactly one DOM node is touched. Nothing is
compared, because nothing needs to be.

### Lists

```js
import { each } from '@amojs.dev/core';

html`<ul>${each(items, (item) => item.id, Item)}</ul>`;
```

The key function is the second positional argument, so you cannot forget it.
Rows are rendered once per key and *moved*, never rebuilt — reconciliation is
move-minimal via a longest-increasing-subsequence pass (a swap costs 2 moves, a
reverse costs n−1, a rotate costs 1).

## Why it is this small

| gate (enforced in CI) | measured | budget |
|---|---|---|
| compiled counter app, all-in (bundle + min + gz) | **1982 B** | ≤ 2048 B |
| runtime minus template parser, bundled | 2520 B | ≤ 2560 B |
| no-build app, template parser included | 4020 B | ≤ 4096 B |
| compiled bytes ÷ hand-written vanilla bytes | **1.087** | ≤ 1.10 |

That last row is the point of the project. Compiled AmoJS output costs under
10% more than the vanilla DOM code a person would have written by hand — and
CI fails if that ever stops being true.

There is a second gate that matters more than bytes: AmoJS provably emits
*exactly* the DOM mutations a hand-written vanilla app does — on create,
update, churn, toggle, append, prepend, remove and clear. Writing a signal with
a value it already had produces zero DOM work, not a cheap diff.

## The compiler is an optimizer, not a requirement

The same source can be compiled ahead of time. The compiler hoists each
template, resolves every hole to a positional node walk, and drops the template
parser from the bundle entirely:

```bash
npx @amojs.dev/cli build src/ dist/
```

Every test fixture in this project runs in **both** modes and asserts identical
behavior. The uncompiled runtime is the semantic source of truth; the compiler
is only allowed to be faster and smaller.

## You can uninstall it

```bash
npx @amojs.dev/cli eject src/ dist/
```

`eject` emits readable vanilla JavaScript, hands over the runtime files, and
rewrites every `@amojs.dev/core` specifier to a relative path. The test suite executes
the ejected output and asserts there are zero bare-specifier imports left, so
module resolution never touches `node_modules` again. Delete AmoJS and the app
keeps working.

## The whole API — 12 names

| | |
|---|---|
| **state** | `signal` · `computed` · `effect` · `isSignal` |
| **template** | `html` · `each` · the reserved `ref` attribute |
| **lifetime** | `mount` · `root` · `onCleanup` · `onMount` |
| **scheduling** | `flushSync` · `tick` |

Subpath entries for compiled and ejected output, which never load the template
parser: `@amojs.dev/core/runtime` and `@amojs.dev/core/compiled`.

## Status — what is not here

Stated plainly, because finding out later is worse:

- **No router.** Design is in progress; nothing ships today.
- **No async-data primitive.** There is no `resource()`; a screen writes its
  own loading signal.
- **No SSR.** Planned as static islands, never hydration.
- **No documentation site yet.** [amojs.dev](https://amojs.dev) is currently a
  landing page.
- **No deep reactivity, deliberately.** There is no Proxy layer. Replace the
  array (`items.value = [...items.value, x]`) or put a signal inside each item.
  Magic mutation cannot be ejected as "code you would have written", which is
  the whole promise.
- **The template language is a strict subset of HTML.** Closing tags must be
  explicit, raw-text elements (`<textarea>`, `<script>`, `<style>`) are
  rejected inside templates, and an attribute hole must be the entire attribute
  value — `class="${x}"`, not `class="a ${x}"`.
- **No global event delegation.** Listeners are attached per element, exactly
  as in vanilla.

Things it is measured against, honestly: on pure reactive-graph micro-benchmarks
the signal core sits roughly 6× behind `alien-signals`, which is invisible
behind real DOM work but is true. And no benchmark measures ecosystem, tooling
maturity, or production hardening — all of which the established frameworks
have and this does not.

## License

MIT © Hamidreza Behzadi
