# create-amojs

Scaffold an [AmoJS](https://amojs.dev) project.

```bash
npm create amojs my-app
```

A few questions — static (`ssg`), server-rendered (`ssr`) or a browser app
(`csr`); with or without the sample island; TypeScript or not — and you have
a working project:

```
my-app/
  package.json          dev · build · serve (· check for ts)
  src/
    pages/index.js      rendered on node — ships zero JS of its own
    islands/counter.js  the interactive piece — the only client script
    styles/site.css
    public/favicon.svg  files served from the site root
  .vscode/              recommends the AmoJS editor extension
```

Answer **no** to the island question (or pass `--no-island`) and `src/islands/`
is not scaffolded at all: the built site is pure HTML with zero client
JavaScript. Add the folder later and the build picks it up on its own.

The `csr` variant is a browser app instead: `src/index.html` plus
`src/main.js`, everything rendering on the client. Its build is
self-contained too — core is vendored under `_amo/`, no importmap to write.

No infrastructure files — the CLI owns the pipeline:

```bash
cd my-app
npm install
npm run dev       # build + watch + serve — css hot-swaps, islands re-mount
npm run build     # ssg: static .html · ssr: server modules · csr: browser modules
npm run serve     # run what build made (for ssr, this IS the server)
```

## Flags (skip the questions)

```bash
npm create amojs my-app -- --ssg --no-island --ts
```

- `--ssg` — static site: pages render to `.html` at build time (the default)
- `--ssr` — server-rendered: `amo serve ssr` renders pages per request
- `--csr` — browser app: everything renders on the client
- `--island` / `--no-island` — with or without the sample counter island
  (ssg/ssr only; default with)
- `--ts` / `--js` — language (default JavaScript)

Outside a terminal (CI, scripts) nothing is asked; unanswered questions take
the defaults.

## TypeScript

The `--ts` variant is the same project with `.ts` sources and one
`tsconfig.json` — nothing else changes, because `amo build` strips types
itself (erasable syntax only, node's own type-stripper). `npm run check`
type-checks; the build never needs it.

## Requirements

Node 22 or newer (the TypeScript variant needs 22.13+, where node's own
type-stripper lives).

## License

MIT © Hamidreza Behzadi
