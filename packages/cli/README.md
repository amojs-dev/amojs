# @amojs.dev/cli

The `amo` binary for [AmoJS](https://github.com/amojs-dev/amojs) — a
fine-grained UI compiler that produces the vanilla JS you would have written.

Zero dependencies beyond AmoJS itself. It is two commands.

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
emitted. Non-JS files (css, images, fonts) are copied verbatim to the same
src-relative path; modules never are — pages and layouts are server
artifacts, and islands ship through the islands pass.

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
arrives, compile with the server target and call the module yourself:

```bash
amo build ssr
```

Pages and layouts become server artifacts — modules that render to strings on
node; `src/islands/` is DOM-compiled to `dist/islands/` in the same run, so
the browser gets only the interactive pieces.

A page is `(props) => template`, so per-request data is just an argument:

```js
import { createServer } from 'node:http';
const page = (await import('./dist/pages/product.js')).default;

createServer(async (req, res) => {
  const product = await db.find(new URL(req.url, 'http://x').searchParams.get('id'));
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<!doctype html>\n' + (await page({ product })));   // ← the whole of SSR
}).listen(3000);
```

That is the entire API. A template evaluates to an object that stringifies to
its HTML, so **your server installs no AmoJS package at runtime** — the
compiler is a build-time tool and nothing of ours is in the request path.
`amo build ssg` calls the same pages with `{}`, so one page module serves both.

Three things worth knowing before you deploy:

- **Serve the client build to the browser, never the server one.** A mix-up
  cannot pass silently in either direction: DOM-target code calls
  `document.createElement` and node throws, and a server-only template fails
  the client build.
- **`<title>${…}</title>` works on the server only** — a page's title has to be
  in the markup for a crawler to see it. The client answer is
  `document.title = …`; binding rawtext content would mean walking into a place
  the runtime deliberately never enters. The DOM target rejects it and says so.
- **All islands on a page must import core from the same url**, because core
  keeps module-level state. The single-file
  [`dist/browser-runtime.js`](https://www.npmjs.com/package/@amojs.dev/core)
  makes that one request.
- **There is no hydration and never will be.** The server sends static HTML;
  interactive islands build their own DOM on the client. So state does not
  survive a navigation — a link is a real document load, as in any static
  site.

### TypeScript

The compiler parses JavaScript. Strip types first — `TS → JS`, then
`amo build`.

## License

MIT © Hamidreza Behzadi
