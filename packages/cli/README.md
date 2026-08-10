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
amo build <src> <out>                 compile amo modules, copy everything else
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

Server-side notes, stated rather than hidden: render lists with `.map()`
(`each()` is client-side keyed reconciliation); `ref` holes are skipped (no
element exists to hand over); a `value` hole on `<textarea>` renders as its
content; `value` on `<select>` is a build error — put `selected=${…}` on the
matching `<option>` instead.

### TypeScript

The compiler parses JavaScript. Strip types first — `TS → JS`, then
`amo build`.

## License

MIT © Hamidreza Behzadi
