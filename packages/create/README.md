# create-amojs

Scaffold an [AmoJS](https://amojs.dev) project.

```bash
npm create amojs my-app
```

Two questions — static (`ssg`) or server-rendered (`ssr`), and TypeScript or
not — and you have a working project:

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

No infrastructure files — the CLI owns the pipeline:

```bash
cd my-app
npm install
npm run dev       # build + watch + serve — css hot-swaps, islands re-mount
npm run build     # ssg: static .html · ssr: server modules
npm run serve     # run what build made (for ssr, this IS the server)
```

## Flags (skip the questions)

```bash
npm create amojs my-app -- --ssg --ts
```

- `--ssg` — static site: pages render to `.html` at build time (the default)
- `--ssr` — server-rendered: `amo serve ssr` renders pages per request
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
