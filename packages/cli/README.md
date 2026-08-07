# amojs-cli

The `amo` binary for [AmoJS](https://github.com/amojs-dev/amojs) — a
fine-grained UI compiler that produces the vanilla JS you would have written.

Zero dependencies beyond AmoJS itself. It is two commands.

> **Pre-1.0.** Flags and output layout may change.

## Install

```bash
npm install --save-dev amojs-cli
```

Or run it without installing:

```bash
npx amojs-cli build src/ dist/
```

## Usage

```
amo build <src> <out>                 compile amo modules, copy everything else
amo eject <src> <out> [--runtime <dir>]
                                      build, then hand the runtime over and
                                      rewrite every "amojs" import to a
                                      relative path (default dir: amo-runtime)
amo --help | --version
```

### `amo build`

Walks the project, compiles every module that imports `amojs`, and copies
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
`dist/amo-runtime/` and every `amojs` specifier rewritten to a relative path.
There are no bare-specifier imports left, so module resolution never touches
`node_modules` — the project's test suite executes ejected output and asserts
exactly that.

Delete AmoJS afterwards and your app keeps working. It is the framework you can
uninstall.

`--runtime <dir>` renames the runtime folder. The runtime is resolved from the
**ejected project's own** installed `amojs` when there is one, so the output
keeps the exact version the code was written against; the CLI prints where it
came from.

### TypeScript

The compiler parses JavaScript. Strip types first — `TS → JS`, then
`amo build`.

## License

MIT © Hamidreza Behzadi
