# @amojs.dev/test

Helpers for testing [AmoJS](https://amojs.dev) components with vitest and a
DOM environment (happy-dom or jsdom), so a test file does not re-invent mount,
unmount and flush. Four names: `render`, `cleanup`, `flush`, `tick`.

> **Status: pre-1.0.** The API below is implemented, tested with vitest under
> happy-dom, and verified under jsdom, but it may still change.

## Install

```bash
npm install -D @amojs.dev/test
```

`@amojs.dev/core` is a peer dependency: the helpers use your copy, so a test
and the component it renders share one reactive graph.

## A complete test

```js
// counter.test.js
// @vitest-environment happy-dom
import { test, expect } from 'vitest';
import { signal, html } from '@amojs.dev/core';
import { render, flush } from '@amojs.dev/test';

function Counter() {
  const count = signal(0);
  return html`<button onclick=${() => count.value++}>count: ${count}</button>`;
}

test('counts clicks', () => {
  const { container, unmount } = render(Counter);
  const button = container.querySelector('button');

  button.click();
  button.click();
  flush();
  expect(button.textContent).toBe('count: 2');

  unmount();
  expect(container.isConnected).toBe(false);
});
```

## The four names

**`render(component, options?)`** mounts `component` — a function returning a
Node, or a Node — into a fresh `<div>` appended to `document.body`, inside its
own disposable scope. `options.target` supplies the container instead. It
returns `{ container, unmount }`; `onMount` callbacks run before it returns,
exactly as under `mount()`.

`unmount()` disposes everything the component created — every effect, every
`onCleanup`, every `each()` row — and removes the container from the
document, including one passed as `target`. Calling it again does nothing.

Pass the function, not its result: `render(Counter)`, not
`render(Counter())`. A node built outside `render()` belongs to whatever scope
built it, so `unmount()` removes it from the document but cannot dispose its
effects.

**`cleanup()`** unmounts everything `render()` mounted that is still mounted —
including a render whose component threw.

**`flush()`** runs pending effects now. AmoJS batches effects into a
microtask, so after a click or a signal write the DOM updates on the next
`flush()`. It is core's `flushSync`, under the name a test reads naturally.

**`tick()`** is core's `tick`: a promise that resolves once pending effects
have run, for tests that read better with `await`.

## Isolation between tests

Importing `@amojs.dev/test` registers `cleanup` with a global `afterEach` when
the test runner provides one — the Testing Library convention — so nothing
one test rendered is still mounted when the next one starts. Vitest provides a
global `afterEach` only with `globals: true`:

```js
// vitest.config.js
export default { test: { globals: true, environment: 'happy-dom' } };
```

Without globals, register it yourself, in each file or once in a setup file:

```js
import { afterEach } from 'vitest';
import { cleanup } from '@amojs.dev/test';

afterEach(cleanup);
```

To opt out of the automatic registration, import from `@amojs.dev/test/pure`:
the same four names, and nothing is registered.

```js
import { render, cleanup } from '@amojs.dev/test/pure';
```

## What it deliberately is not

- **No query helpers.** `container.querySelector` is the query API.
- **No event helpers.** `el.click()` and `el.dispatchEvent(new Event('input'))`
  are the event API.
- **No fake timers.** Your test runner has them.

## Parser-free by construction

The helpers import only `@amojs.dev/core/runtime`, so a suite of compiled
components never loads the template parser through this package; components
written with raw `` html`` `` work the same and bring the parser themselves.
Its own size is gated in CI at ≤ 384 B min+gz, core excluded.
