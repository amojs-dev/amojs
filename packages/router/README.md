# @amojs.dev/router

Routing for [AmoJS](https://amojs.dev), built on the **Navigation API**
(Baseline since January 2026) — the router you can uninstall.

> **Status: pre-1.0.** The API below is implemented and verified in a real
> browser (Chrome, both raw and compiled modes), but it may still change.

```js
import { html, mount } from '@amojs.dev/core';
import { router } from '@amojs.dev/router';

const app = router({
  '/':          () => import('./pages/home.js'),
  '/users':     () => import('./pages/users.js'),
  '/users/:id': () => import('./pages/user.js'),
  '*':          () => import('./pages/404.js'),
}, {
  pending: () => html`<p>loading…</p>`,                      // ONCE, for every page
  error: (err, retry) => html`<p>${err.message} <button onclick=${retry}>retry</button></p>`,
});

mount(app, document.getElementById('app'));
```

```js
// pages/user.js
export async function load({ params, signal }) {
  return (await fetch(`/api/users/${params.id}`, { signal })).json();
}
export const title = (data) => data.name;
export default ({ data }) => html`<h1>${data.name}</h1>`;
```

## The one idea everything rests on

**`data` is a resolved value, not a resource.** The router does not render a
page until its `load` settles — so a page never sees a loading or error
state. Those live in ONE place, the router options. You never write a
loading state again.

## What the platform does (so this package doesn't)

- **`<a href>` just works** — no `<Link>` component, no document-level click
  listener, no `metaKey` / `target="_blank"` / `download` edge cases.
- **Stale responses cancel themselves** — every navigation carries an
  `AbortSignal`; hand it to `fetch` and an abandoned page's request aborts.
- **Scroll restoration is free** — back/forward puts you back where you were,
  zero router code.
- **Forms**: `<form method="post">` submits are intercepted and handed to the
  page's `action({ formData })`; return `redirect('/thanks')` to move on.
  Native `required` validation runs before any router code.
- **Browsers without the Navigation API get full page loads** — the app is
  slower, not broken. No polyfill, no bytes.

Two behaviors to know about, both deliberate:

- **The tab spinner runs during `load`.** During an intercepted navigation the
  browser shows its real loading UI until the handler settles. That is the
  platform's honest progress indicator — and its stop button feeds the
  `AbortSignal` for free. It is not a full page reload.
- **The URL commits before the content arrives.** With `pending` UI this is
  correct behavior, but it differs from React Router and may surprise you.
- The old page stays on screen for the first 100 ms of a navigation, so fast
  pages swap old → new with no pending flash in between.

## Options

| option | meaning |
|---|---|
| `base` | path prefix the app lives under (subpath deployments) |
| `pending` | `() => Node`, shown once a load passes 100 ms |
| `error` | `(err, retry) => Node`, shown when `load`/`action` throw |
| `viewTransitions` | `true` to crossfade page swaps via the View Transitions API (opt-in) |

When the error UI shows, `document.title` defaults to the error's message —
the previous page's title never lingers. Set `document.title` inside your
`error()` if you want something else.

## `link()` — hrefs under a base

With a `base`, every in-app href needs the prefix. `link()` is that prefix,
bound by `router()` at creation; with no base it is the identity function:

```js
import { link } from '@amojs.dev/router';

html`<a href="${link('/users')}">users</a>`;
```

No `<Link>` component — an `<a>` is already the router's link.

## Parser-free by construction

The outlet is built the way compiled AmoJS output builds a child hole
(an anchor + `bindChild`), so an app that routes — compiled or raw — never
loads the template parser through this package. Size is gated in CI at
≤ 1152 B min+gz. `amo eject` hands the router over along with the runtime:
the ejected app keeps routing with the package deleted.
