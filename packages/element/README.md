# @amojs.dev/element

Ship an [AmoJS](https://amojs.dev) component into a page that does not use
AmoJS: `define()` registers it as a custom element.

> **Status: pre-1.0.** The API below is implemented and verified in headless
> Chrome (a raw component and its compiled twin) and under happy-dom, but it
> may still change.

```js
import { signal, html } from '@amojs.dev/core';
import { define } from '@amojs.dev/element';

function Counter({ start }) {
  const clicks = signal(0);
  return html`<button onclick=${() => clicks.value++}>${() => Number(start.value) + clicks.value}</button>`;
}

define('x-counter', Counter, { attrs: ['start'] });
```

```html
<x-counter start="3"></x-counter>
```

The component is a plain AmoJS component, unchanged: a function that takes
one props object and returns a `Node`. `define()` returns the element class,
the same one `customElements.get('x-counter')` returns.

## Attributes are signals

Every name in `attrs` becomes a prop holding a `Signal<string | null>`, kept
in sync with the attribute. `setAttribute('start', '9')` writes the signal, so
the holes that read it update and nothing else does. A missing attribute is
`null`, and every value is a string, which is why the example calls `Number()`.
The prop key is the attribute name as written (`max-count` arrives as
`props['max-count']`). Use lowercase names, because that is how HTML stores
attributes.

`host` is the one other prop: the element itself. Dispatch events from it, or
read the children the page put inside it. `host` always means the element, so
an attribute named `host` cannot reach the component.

There are no properties: data reaches the component through attributes only.

## Lifetime

- **Connected:** the component runs inside its own `root()` and its nodes are
  mounted. `onMount` sees live nodes and `onCleanup` works as it does
  anywhere else.
- **Disconnected:** that root is disposed and every node it mounted is
  removed. Nothing stays subscribed to the attribute signals.
- **Moved** (removed and re-added): a clean remount, so the page has exactly
  one copy. Local state such as `clicks` above starts over, and attributes
  keep their current values.

## Light DOM or shadow DOM

By default the component renders into the element itself, after any children
the page put inside it. The component does not own those children: they stay
in place and survive a move.

```js
define('x-card', Card, { shadow: 'open' }); // or 'closed'
```

With `shadow`, the component renders into a shadow root of that mode. The root
is created once and reused on every reconnect. A plain `<slot>` in the
template projects the page's children. That is the platform's own slot, and
this package adds no API for it.

## You register; the import registers nothing

`customElements` is one global registry per page, so registration is always
your call. Importing this package defines nothing.

- If the name is already defined, by this package or anyone else, `define()`
  throws `amo: <x-counter> is already defined`. It never skips and never
  redefines.
- If the name is invalid (it has no hyphen, for example), the platform throws
  its own error.
- On the server there is no `customElements`. Importing is safe there, and
  calling `define()` throws `amo: define() needs a browser`.

## One core per page

AmoJS core keeps module-level state, so two copies on one page do not
interoperate. This package imports core through `@amojs.dev/core/runtime`,
and your component imports `@amojs.dev/core`. Every one of those specifiers
must resolve to **the same file**. If they do not, the prop signals come from
one copy and your template from another. A signal hole then renders
`[object Object]`, and a function hole renders once and never updates.

Without a bundler, map every core specifier to one prebuilt file. A
component that uses `` html`` `` at runtime needs `browser.js`:

```html
<script type="importmap">
  {
    "imports": {
      "@amojs.dev/core": "/node_modules/@amojs.dev/core/dist/browser.js",
      "@amojs.dev/core/runtime": "/node_modules/@amojs.dev/core/dist/browser.js",
      "@amojs.dev/element": "/node_modules/@amojs.dev/element/src/index.js"
    }
  }
</script>
```

A compiled component imports only `/runtime` and `/compiled`. Point both at
`dist/browser-runtime.js`, and the page never loads the template parser.

## Not here

- **Properties.** Data arrives through attributes only, and there is no
  `props` option.
- **A slots API.** Shadow mode's native `<slot>` covers projection.
- **Eject handover.** `amo eject` does not hand this package over, so an
  ejected app keeps importing `@amojs.dev/element`.
- **Server rendering of the element.** It renders in the browser, when it
  connects.

The package's own code is gated in CI at ≤ 600 B min+gz, not counting core.
