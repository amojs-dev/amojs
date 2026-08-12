# @amojs.dev/cli

The `amo` binary for [AmoJS](https://github.com/amojs-dev/amojs) — a
fine-grained UI compiler that produces the vanilla JS you would have written.

Zero dependencies beyond AmoJS itself. It is four commands.

> **Pre-1.0.** Flags and output layout may change.

## Install

```bash
npm install --save-dev @amojs.dev/cli
```

Or run it without installing:

```bash
npx @amojs.dev/cli build
```

## Usage

```
amo build [mode] [src] [out]          mode: csr (default) | ssr | ssg
                                      src defaults to src/, out to dist/
amo dev [mode] [src] [out] [--port <n>]
                                      build, watch <src>, rebuild on change,
                                      serve <out> (default port 4700); ssr
                                      renders pages per request as you work
amo serve [mode] [dir] [--port <n>]   serve a built <dir> (default dist):
                                      csr | ssg static; ssr renders
                                      <dir>/pages/ per request
amo eject <src> <out> [--runtime <dir>]
                                      build, then hand the runtime over and
                                      rewrite every "@amojs.dev/core" import to a
                                      relative path (default dir: amo-runtime)
amo --help | --version
```

```bash
amo build              # csr: src/ → dist/, for the browser
amo build ssr          # server target + automatic islands pass
amo build ssg          # static .html from src/pages/ + islands pass
amo build ssg out/     # custom output dir
amo build ssr app/ out/   # fully explicit
```

A directory literally named after a mode is written as `./ssr`; the bare word
always reads as the mode.

`<out>` is emptied before the build **when it sits inside the project** —
a source file you deleted must not survive as a stale artifact. An `<out>`
outside the working directory is never touched beyond being written into.

`<src>/public/` is the root-asset folder: everything in it is copied
**verbatim to the root of `<out>`** (`public/favicon.svg` → `/favicon.svg`),
never compiled — the place for icons, `robots.txt`, fonts, anything whose
url must be exact.

### `amo dev`

The dev loop: one build, then watch `<src>`, rebuild on change, and serve
`<out>` with pretty urls (`/docs/` answers from `docs/index.html`). A rebuild
that fails prints its error and keeps serving the last good build.

Open tabs update themselves, each change taking the cheapest honest path:

- **css** — stylesheets swap in place: no reload, island state survives
- **an island** — the changed island re-imports and **re-mounts in place**
  (a dev-only mount facade removes the old version's DOM first). Its local
  state resets, and the old version's timers linger until a real reload —
  said plainly rather than pretended away.
- **anything else** (pages, lib, public) — the page is server-rendered HTML,
  so there is no client module to swap: the browser reloads itself.

The channel is one SSE endpoint and a small client injected into served
HTML — never into the build: `dist/` and `amo serve` output stay
byte-identical to production. Zero dependencies, as ever.

```bash
amo dev ssg            # the docs-site loop: src/ → dist/, on :4700
amo dev ssr            # server-rendered: every request renders fresh
amo dev                # csr projects work too
```

### `amo serve`

Run what `build` made. For `csr` and `ssg` it is a static server with pretty
urls; for `ssr` it is the server — static files (islands, `_amo/`, public
assets) plus every other url mapped to a compiled page module, rendered per
request:

```
/          →  dist/pages/index.js
/about     →  dist/pages/about.js
/docs/x    →  dist/pages/docs/x.js  (or docs/x/index.js)
```

A page receives `{ url }` — a `URL`, so `url.pathname` and `url.searchParams`
are per-request data. (`amo build ssg` calls the same page with `{}`, so a
page that uses `url` is an ssr page — that is the whole difference.)

Deliberately dumb, like the compiler: url → file path, no route params, no
middleware, no config, no compression. **The server you can replace** — when
you outgrow it, your own server is ~10 lines (below) and nothing else changes.
In ssr mode, `.js` is served statically only from `islands/` and `_amo/`:
everything else compiled for node is server code, and server code is never
handed to a browser.

Port: `--port`, else `$PORT`, else 3000.

### `amo build` (csr)

Walks the project, compiles every module that imports `@amojs.dev/core`, and copies
everything else through untouched. Templates are hoisted and cloned instead of
parsed at runtime, holes become positional node walks decided at build time,
and the template parser is dropped from the output entirely.

This step is **optional**. AmoJS source already runs in a browser with no build
at all; `build` only makes it smaller and faster.

### Islands (ssr and ssg)

With `ssr` and `ssg`, if `<src>/islands/` exists it is DOM-compiled to
`<out>/islands/` automatically — those are the interactive pieces of your
pages, and they are the only client JavaScript a server-rendered site ships.
No `islands/` folder means a fully static site: the pass is skipped and says
so. `--islands <dir>` renames the folder (inside `<src>`).

Islands come out **self-contained**: core's prebuilt browser bundle is copied
to `<out>/_amo/` and every island's `@amojs.dev/core` import is rewritten to
reach it relatively — no importmap to write, nothing to copy by hand, and one
core url for every island (core keeps module-level state, so two copies would
not interoperate). Islands that never import core vendor nothing.

### `amo eject`

Build, then hand the runtime over:

```bash
amo eject src/ dist/
```

The output is readable vanilla JavaScript with the runtime files written to
`dist/amo-runtime/` and every `@amojs.dev/core` specifier rewritten to a relative path.
There are no bare-specifier imports left, so module resolution never touches
`node_modules` — the project's test suite executes ejected output and asserts
exactly that.

Delete AmoJS afterwards and your app keeps working. It is the framework you can
uninstall.

`--runtime <dir>` renames the runtime folder. The runtime is resolved from the
**ejected project's own** installed `@amojs.dev/core` when there is one, so the output
keeps the exact version the code was written against; the CLI prints where it
came from.

### `amo build ssg`

Static pages from the same components — **islands, never hydration**:

```bash
amo build ssg
```

Every module under `src/pages/` (rename with `--pages <dir>`) is a page: its
default export (sync or async) returns a template, which is rendered **on
node** to `dist/<same path>.html` with `<!doctype html>` prepended. Signals
evaluate once; text and attribute holes are escaped; no comment markers are
emitted. Non-module files (css, images, fonts) are copied verbatim to the
same src-relative path; modules (`.js` and `.ts` alike) never are — pages and
layouts are server artifacts, and islands ship through the islands pass.

```js
// src/pages/index.js
import { html } from '@amojs.dev/core';
export default () => html`<html lang="en"><head><title>hi</title></head>
<body><h1>${'hello'}</h1></body></html>`;
```

A page with no interactivity ships **zero** script bytes. An interactive
island is nothing special — a static `<script type="module">` you write in
the page that imports a normal AmoJS component (the automatic islands pass
compiles it) and `mount`s it into its container. Give that container
intrinsic size: it is empty until the island mounts.

Server data reaches an island through `data-*` attributes on that container,
not through the script tag — `<script>` content is static (a hole in it is a
build error), and interpolating server data into a script is an injection
vector anyway:

```html
<div id="cart" data-stock="${String(product.stock)}"></div>
<script type="module">
  import { mountCart } from '/islands/cart.js';
  mountCart();          // reads host.dataset.stock
</script>
```

Server-side notes, stated rather than hidden: render lists with `.map()`
(`each()` is client-side keyed reconciliation); `ref` holes are skipped (no
element exists to hand over); a `value` hole on `<textarea>` renders as its
content; `value` on `<select>` is a build error — put `selected=${…}` on the
matching `<option>` instead.

### `amo build ssr` — rendering per request

`amo build ssg` renders pages when you build. To render them when a request
arrives:

```bash
amo build ssr
amo serve ssr
```

Pages and layouts become server artifacts — modules that render to strings on
node; `src/islands/` is DOM-compiled to `dist/islands/` in the same run, so
the browser gets only the interactive pieces. `amo serve ssr` maps urls to
those page modules and renders each request.

You never have to use `amo serve`. A page is `(props) => template` and a
template stringifies to its HTML, so your own server is ~10 lines — and then
**no AmoJS package is in the request path at all** (the compiler is a
build-time tool):

```js
import { createServer } from 'node:http';
const page = (await import('./dist/pages/product.js')).default;

createServer(async (req, res) => {
  const product = await db.find(new URL(req.url, 'http://x').searchParams.get('id'));
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<!doctype html>\n' + (await page({ product })));   // ← the whole of SSR
}).listen(3000);
```

That is the entire API. `amo serve ssr` is that same loop with static-file
serving around it — a convenience, not a dependency. `amo build ssg` calls
the same pages with `{}`, so one page module serves both.

Four things worth knowing before you deploy:

- **Serve the client build to the browser, never the server one.** A mix-up
  cannot pass silently in either direction: DOM-target code calls
  `document.createElement` and node throws, and a server-only template fails
  the client build.
- **`<title>${…}</title>` works on the server only** — a page's title has to be
  in the markup for a crawler to see it. The client answer is
  `document.title = …`; binding rawtext content would mean walking into a place
  the runtime deliberately never enters. The DOM target rejects it and says so.
- **All islands on a page share one core url** — core keeps module-level
  state, so two copies would not interoperate. The islands pass enforces this
  for you: the vendored `_amo/` bundle is that single url.
- **There is no hydration and never will be.** The server sends static HTML;
  interactive islands build their own DOM on the client. So state does not
  survive a navigation — a link is a real document load, as in any static
  site.

### TypeScript

Write `.ts` — `amo build` and `amo dev` strip the types themselves (node's own
type-stripper, still zero dependencies) and emit `.js`. Two rules, both loud
build errors when broken:

- **Erasable syntax only.** An `enum`, `namespace`, or parameter property has
  runtime meaning and is not a type annotation — write it as plain JS. (The
  same subset TypeScript's own `erasableSyntaxOnly` flag enforces.)
- **Import the emitted path**: `./util.js`, not `./util.ts` — TypeScript's own
  convention for ESM.

`.d.ts` files are for your editor and are skipped. Type *checking* stays your
toolchain's job (`tsc --noEmit`) — the build erases types, it does not check
them.

## License

MIT © Hamidreza Behzadi
