/**
 * Prebuilt browser bundles — the shipped `dist/` twins of the raw `src/` entries.
 *
 * WHY THEY EXIST: raw ESM has no bundler, so an import chain IS the network
 * cost. A compiled app fetches SEVEN files three levels deep (runtime →
 * mount/each → signal, compiled → bind → list) for 3248 B gzipped, and gzip
 * compresses seven small files worse than one. These bundles collapse that to
 * ONE request and 2520 B with no build step on the consumer's side — the same
 * artifact every library of this shape ships (`vue.esm-browser.js`).
 *
 * `src/` stays the source of truth: it is what a reader reads, what `checkJs`
 * type-checks, and what `amo eject` hands over. These files are a transport
 * optimization, nothing more.
 *
 * TWO artifacts, because one would break a headline claim — a fully compiled
 * app must never download the template parser:
 *   dist/browser.js          the bundled twin of "."  (parser included, plus
 *                            the compiled helpers: 93 B so that ONE file can
 *                            also serve a mixed app that has both raw
 *                            html`` templates and compiled ones)
 *   dist/browser-runtime.js  the bundled twin of "/runtime" + "/compiled",
 *                            parser-free
 *
 * An importmap points every core specifier at ONE of these files. Mapping them
 * all to the SAME url is required, not cosmetic: module-level state
 * (`activeOwner`, the flush queue, the mount queue) means two copies of core on
 * one page do not interoperate.
 */

import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../src');
const DIST = join(HERE, '../dist');

const ENTRIES = [
  {
    file: 'browser.js',
    contents: `export * from './index.js';\nexport * from './compiled.js';\n`,
  },
  {
    file: 'browser-runtime.js',
    contents: `export * from './runtime.js';\nexport * from './compiled.js';\n`,
  },
];

/**
 * Build every bundle in memory. The size gate calls this too, so it measures
 * exactly the bytes that ship instead of re-deriving them.
 *
 * @returns {Promise<{ file: string, code: string }[]>}
 */
export async function buildBundles() {
  /** @type {{ file: string, code: string }[]} */
  const out = [];
  for (const entry of ENTRIES) {
    const result = await build({
      stdin: { contents: entry.contents, resolveDir: SRC, loader: 'js' },
      bundle: true,
      minify: true,
      format: 'esm',
      write: false,
    });
    out.push({ file: entry.file, code: result.outputFiles[0].text });
  }
  return out;
}

// run directly (`pnpm build`) → write them out
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await mkdir(DIST, { recursive: true });
  for (const { file, code } of await buildBundles()) {
    await writeFile(join(DIST, file), code);
    process.stdout.write(`core bundle → dist/${file} (${code.length} B min)\n`);
  }
}
