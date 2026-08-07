# amojs-compiler

The build-time compiler for [AmoJS](https://github.com/amojs-dev/amojs):
parse → IR → codegen. Runs on node only and never ships to a browser.

It is an **optimizer, not a requirement** — AmoJS source runs unmodified in a
browser. What compiling buys you: each `` html`` `` template is hoisted and
cloned instead of parsed at runtime, every hole resolves to a positional node
walk decided at build time, and the template parser is dropped from the bundle
entirely.

Most people should use [`amojs-cli`](https://www.npmjs.com/package/amojs-cli)
rather than this package directly.

> **Pre-1.0.** The API below may change.

## Install

```bash
npm install --save-dev amojs-compiler
```

## API

```js
import { compileModule, buildDir, ejectDir } from 'amojs-compiler';

// one module, source in → source out
const compiled = compileModule(source);

// a whole project: compile amo modules, copy everything else verbatim
await buildDir('src', 'dist');

// build, then hand the runtime over and rewrite every "amojs" specifier
// to a relative path, so the output has no bare imports left at all
const result = await ejectDir('src', 'dist', { runtimeDir: 'amo-runtime' });
result.runtimeFrom; // where the runtime was resolved from
```

`ejectDir` resolves the runtime by real module resolution and prefers **the
ejected project's own** installed `amojs`, so the output keeps the exact
version the code was written against.

### Diagnostics

```js
import { diagnose } from 'amojs-compiler/diagnose';

for (const d of diagnose(source)) {   // one diagnostic per broken template
  d.message; // "unclosed <div>", "a hole must be the entire attribute value", …
  d.start;   // absolute document offsets
  d.end;
  d.exact;   // false when an escape sequence makes the range approximate
}
```

This is a narrow entry point with no filesystem access, so an editor extension
can bundle it without pulling `build`/`eject` in. It is what
[`language-tools`](https://github.com/amojs-dev/language-tools) uses — the
editor and `amo build` share one parser and therefore cannot disagree.

## What it will not do

The compiler is deliberately **dumb**: it rewrites `` html`` `` templates and
`amojs` specifiers, and touches nothing else. It does not reason about module
boundaries, lazy-loading, closure serialization, or dead code. That is a
feature — a purely local, mechanical source-to-source rewrite can be trusted
next to any other tool in your pipeline.

It parses JavaScript. If you write TypeScript, strip types first: `TS → JS`,
then `amo build`.

## License

MIT © Hamidreza Behzadi
