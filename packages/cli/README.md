# @amojs.dev/cli

The `amo` binary for [AmoJS](https://github.com/amojs-dev/amojs) — a
fine-grained UI compiler that produces the vanilla JS you would have written.

Zero dependencies beyond AmoJS itself. It is three commands.

> **Pre-1.0.** Flags and output layout may change.

## Install

```bash
npm install --save-dev @amojs.dev/cli
```

Or run it without installing:

```bash
npx @amojs.dev/cli build src/ dist/
```

## Usage

```
amo build <src> <out> [--target dom|server]
                                      compile amo modules, copy everything else
amo eject <src> <out> [--runtime <dir>]
                                      build, then hand the runtime over and
                                      rewrite every "@amojs.dev/core" import to a
                                      relative path (default dir: amo-runtime)
amo ssg <src> <out> [--pages <dir>]   render every page module under <src>/pages/
                                      to static .html
amo --help | --version
```

### `amo build`

Walks the project, compiles every module that imports `@amojs.dev/core`, and copies
everything else through untouched. Templates are hoisted and cloned instead of
parsed at runtime, holes become positional node walks decided at build time,
and the template parser is dropped from the output entirely.

This step is **optional**. AmoJS source already runs in a browser with no build
at all; `build` only makes it smaller and faster.

`--target server` compiles the same templates into **string concatenation** for
node instead of DOM calls — see [Rendering per request](#rendering-per-request).

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

### `amo ssg`

Static pages from the same components — **islands, never hydration**:

```bash
amo ssg src/ dist/
```

Every module under `src/pages/` is a page: its default export (sync or async)
returns a template, which is rendered **on node** to `dist/<same path>.html`
with `<!doctype html>` prepended. Signals evaluate once; text and attribute
holes are escaped; no comment markers are emitted.

```js
// src/pages/index.js
import { html } from '@amojs.dev/core';
export default () => html`<html lang="en"><head><title>hi</title></head>
<body><h1>${'hello'}</h1></body></html>`;
```

A page with no interactivity ships **zero** script bytes. An interactive
island is nothing special — a static `<script type="module">` you write in
the page that imports a normal AmoJS component (compiled by `amo build`) and
`mount`s it into its container. Give that container intrinsic size: it is
empty until the island mounts.

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

### Rendering per request

`amo ssg` renders pages when you build. To render them when a request arrives,
compile the same tree with the server target and call the module yourself:

```bash
amo build src/ server/ --target server        # pages → strings, on node
amo build src/islands/ public/islands/        # islands → the browser
```

Note the second command's source: **islands only, not the whole tree.** Pages
and layouts are server artifacts. If you point the client build at them, a
server-only template (a dynamic `<title>`) fails the build — which is how a
mix-up announces itself instead of shipping.

A page is `(props) => template`, so per-request data is just an argument:

```js
import { createServer } from 'node:http';
const page = (await import('./server/pages/product.js')).default;

createServer(async (req, res) => {
  const product = await db.find(new URL(req.url, 'http://x').searchParams.get('id'));
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<!doctype html>\n' + (await page({ product })));   // ← the whole of SSR
}).listen(3000);
```

That is the entire API. A template evaluates to an object that stringifies to
its HTML, so **your server installs no AmoJS package at runtime** — the
compiler is a build-time tool and nothing of ours is in the request path.
`amo ssg` calls the same pages with `{}`, so one page module serves both.

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
