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

**There is no sourcemap yet.** The compiler is a source-to-source rewrite that
does not emit one, and a wrong map is worse than none, so it returns
`map: null`. Debugging shows compiled output — readable, but not your file.

## Size note

A real Vite build of the counter app measures 2311 B gzipped, against 1983 B for
the same app bundled with esbuild in this repo's size gate. The difference is
the minifier, not the plugin: Vite 8's default keeps comments, and re-minifying
its output with esbuild lands at 2036 B.

## License

MIT © Hamidreza Behzadi
