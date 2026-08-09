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
   (pending choreography, error/retry, action + redirect, base, params, the
   viewTransitions option) measures 1091 B with nothing left to trim that
   isn't code-golf. Budget set tight above the measurement, house style. */
test('the router bundles to ≤ 1152 B min+gz (core external)', async () => {
  const r = await build({
    entryPoints: [join(HERE, '../src/index.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    external: ['@amojs.dev/core', '@amojs.dev/core/*'],
  });
  const bytes = gzipSync(Buffer.from(r.outputFiles[0].contents), { level: 9 }).length;
  console.log(`[size] router, bundled (core external): ${bytes} B min+gz (budget 1152)`);
  expect(bytes).toBeLessThanOrEqual(1152);
});
