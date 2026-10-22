# @amojs.dev/vite

The [AmoJS](https://amojs.dev) plugin for Vite: one `transform` hook that
compiles `` html`` `` templates while Vite does everything a bundler is for.

```bash
npm install -D @amojs.dev/vite
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import amo from '@amojs.dev/vite';

export default defineConfig({ plugins: [amo()] });
```

That is the whole setup. Your source stays standard JavaScript, so it still runs
with no build at all — this plugin only makes the built output smaller and
faster, the same deal `amo build` offers.

## What you get that raw ESM cannot give you

AmoJS ships as plain source files, and raw ESM has no tree-shaking: a browser
loads whatever the import chain reaches. A bundler cuts what your app never
touches. A CI test in this package builds a real counter app and asserts the
result contains neither the template parser nor `each()`'s keyed
reconciliation — roughly 600 B gzipped that no importmap can drop.

You also get code-splitting, minification, asset hashing and a dev server,
none of which this package implements. That is the point: a bundler of our own
would be a worse rollup.

## Options

| option | default | |
|---|---|---|
| `target` | `'dom'` | `'server'` emits string concatenation for rendering on node. Use it in a **separate** SSR build — never for browser output. |
| `include` | `/\.(?:m?js\|ts)$/` | Which ids to compile. Files with no `@amojs.dev/core` import pass through untouched anyway, so this is a cost filter. |
| `skipNodeModules` | `true` | Dependencies ship compiled already. |

## Two things to know

**TypeScript works, and the plugin order is why.** It declares no `enforce`, so
it runs in Vite's normal phase — after Vite's own esbuild transform has stripped
types. By the time a `.ts` file reaches the compiler it is already JavaScript,
which is what its acorn parser needs. `enforce: 'pre'` would break that.

**Source maps are real.** Every compiler rewrite is an overwrite of an original
range, so the map this plugin hands Vite points untouched code at its own line
and a compiled template at the `html` tag it replaced — coarse inside the
generated block, exact everywhere else, never wrong. Vite chains it with
esbuild's own map, so a `.ts` file still maps to the file you wrote.

## Size note

A real Vite build of the counter app lands a few hundred bytes above this
repo's esbuild size gate for the same app. The difference is the minifier, not
the plugin: Vite's default keeps comments, and re-minifying its output with
esbuild closes most of the gap.

## License

MIT © Hamidreza Behzadi
