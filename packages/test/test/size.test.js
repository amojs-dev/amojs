/**
 * The package's own cost (core external), and the parser-free claim.
 */
import { test, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const SRC = join(HERE, '../src');

test('the package bundles to ≤ 384 B min+gz (core external)', async () => {
  const r = await build({
    entryPoints: [join(SRC, 'index.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    external: ['@amojs.dev/core', '@amojs.dev/core/*'],
  });
  const bytes = gzipSync(Buffer.from(r.outputFiles[0].contents), { level: 9 }).length;
  console.log(`[size] test helpers, bundled (core external): ${bytes} B min+gz (budget 384)`);
  expect(bytes).toBeLessThanOrEqual(384);
});

test('neither entry reaches the template parser', async () => {
  const PARSER_ONLY = 'a hole in an unsupported spot'; // a string literal from html.js
  // core declares sideEffects: false, so a normal bundle drops html.js even from a
  // barrel import; this keeps every module the raw import graph loads
  /** @param {import('esbuild').BuildOptions} entry */
  const graph = async (entry) => {
    const r = await build({ ...entry, bundle: true, write: false, format: 'esm', treeShaking: false, ignoreAnnotations: true });
    return r.outputFiles[0].text;
  };
  expect(await graph({ entryPoints: [join(SRC, 'index.js')] })).not.toContain(PARSER_ONLY);
  expect(await graph({ entryPoints: [join(SRC, 'pure.js')] })).not.toContain(PARSER_ONLY);

  // control: the same build over a barrel import does carry the parser
  const barrel = await graph({
    stdin: { contents: "export { signal } from '@amojs.dev/core';", resolveDir: SRC },
  });
  expect(barrel).toContain(PARSER_ONLY);
});
