/**
 * THE ROUTER SIZE BUDGET — enforced in CI forever.
 *
 * The router's own cost, bundled+min+gz with @amojs.dev/core external (an app
 * already pays for core; this gate measures what ROUTING adds on top).
 */
import { test, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);

/* The plan's pre-code estimate was ≤ 768 B; the real, verified feature set
   measured 1091 B with nothing left to trim that isn't code-golf. Then:
   +90 B — searchParams, captured race-safe from the navigation's own URL and
   passed to load/action/default (a ctx-dedup refactor saved ZERO bytes after
   gzip, so the explicit form stays). +97 B — three bug-class killers from
   reading other routers' issue trackers: redirect-loop cap (10 hops, named
   error), never-render-a-superseded-page guard, trailing-slash
   normalization. Budget set tight above the measurement, house style. */
test('the router bundles to ≤ 1328 B min+gz (core external)', async () => {
  const r = await build({
    entryPoints: [join(HERE, '../src/index.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    external: ['@amojs.dev/core', '@amojs.dev/core/*'],
  });
  const bytes = gzipSync(Buffer.from(r.outputFiles[0].contents), { level: 9 }).length;
  console.log(`[size] router, bundled (core external): ${bytes} B min+gz (budget 1328)`);
  expect(bytes).toBeLessThanOrEqual(1328);
});
