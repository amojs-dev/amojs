# @amojs.dev/devtools

Watch the DOM work a page does, on the page itself: every write flashes,
every moved node glides, and a small panel keeps count.

[AmoJS](https://amojs.dev) gates this promise in CI: it emits exactly the DOM
mutations a careful hand-written vanilla app does — no more. This package is
the visual form of that gate. Click a button that changes one signal shown in
one place and you see one node flash and the panel read `1`; write a value
that is already there and nothing happens at all.

> **Status: pre-1.0.** The API may still change.

```js
import { devtools } from '@amojs.dev/devtools';

devtools(); // watches document.body
```

It is a development tool. A dynamic import behind a check means a production
page never loads it:

```js
if (location.hostname === 'localhost') {
  const { devtools } = await import('@amojs.dev/devtools');
  devtools();
}
```

## Reading it

| color | what happened |
|---|---|
| **yellow** — write | a text node's content or an attribute changed; the element holding it flashes |
| **green** — insertion | a node entered the DOM |
| **red** — removal | a node left the DOM; it is gone, so the parent it left flashes instead |
| **blue** — move | the same node was taken out and put back in one batch; it glides from its previous position |

The panel, bottom right, counts each kind since `devtools()` was called —
text writes, attribute writes, insertions, removals, moves — plus **last
batch**: how many of those the most recent batch performed. A batch is one
`MutationObserver` delivery; for AmoJS that is one effect flush. Any key or
pointer press resets *last batch* to `0`, so a click that writes nothing
reads `0`.

What an AmoJS app shows:

- **A click that changes one signal read by one text hole:** one yellow flash,
  text writes +1, last batch `1`.
- **Writing a signal's current value:** nothing. The signal stops it, so
  there is no batch at all.
- **Reversing a keyed list of n rows:** n − 1 moves, zero insertions, zero
  removals. One row is never touched — the one the reconciler kept in place —
  so it does not animate even though its neighbors moved around it.

## API

```js
const dispose = devtools(target, options);
```

| | |
|---|---|
| `target` | the `Element` to watch; defaults to `document.body` |
| `options.colors` | `{ write, insert, remove, move }`, any CSS colors, each optional |
| `options.panel` | `false` to hide the panel; flashes and glides still run |
| `dispose()` | disconnects the observer, removes the panel, cancels running animations |

## It observes the DOM, not the runtime

There are no hooks into AmoJS. `devtools` puts a `MutationObserver` on
`target` and paints what it reports, so it behaves identically for raw and
compiled AmoJS — and it shows any other code's writes the same way: a
vanilla script, a third-party widget, another framework.

- **Painting writes nothing.** Flashes and glides run through `el.animate()`,
  never through a class or a style attribute, so they cause no mutations of
  their own. The panel lives in a shadow root, which the observer never sees.
- **Glides need a previous position.** `devtools` records every element's
  layout position (`offsetLeft` / `offsetTop`, which ignore transforms) when
  it starts and again after every batch; a moved node glides from its
  recorded position. When there is none — an SVG element, a `position: fixed`
  element, a node whose offset parent changed — the node flashes blue without
  gliding. A node moved in the DOM that lands where it already was flashes
  without gliding too.
- **Glides compose.** They are additive animations, so an element's own
  `transform` stays applied, and a node moved again mid-glide continues from
  where it is on screen.

## Not in scope

- **Hole evaluations.** Counting how often a template hole re-ran needs a
  hook inside the runtime; this package sees the DOM only. A hole that re-runs
  and produces the same text shows nothing here, because nothing was written.
- **Production.** It reads layout after every batch and animates every write.
  Attach it while developing — not in a shipped app, and not while profiling.
- **Framework knowledge.** It knows nothing about signals, components or
  AmoJS; it reports DOM mutations, whoever made them.

It imports nothing — not even AmoJS. Its size is gated in CI at ≤ 1920 B
min+gz.
