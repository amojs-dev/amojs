/**
 * amo eject — the framework you can uninstall.
 *
 * eject = build + hand the runtime over to the user:
 *   1. compile every module (buildDir)
 *   2. copy the runtime source files — plain, commented JS — into
 *      <outDir>/<runtimeDir>/ (they only import each other relatively),
 *      resolved from the PROJECT's own installed amojs when there is
 *      one, so the user keeps the exact version their code was written against
 *   3. rewrite every 'amojs[/runtime|/compiled]' specifier to a
 *      relative path
 *
 * The result has ZERO bare imports: module resolution never touches
 * node_modules, so deleting amo changes nothing. That is the whole promise.
 */

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildDir } from './build.js';
import type { BuildResult } from './build.js';

/**
 * Every file the ejected app can need — `html.js` included, because a module
 * may legitimately keep raw html`` usage, and `index.js` because the ejected
 * copy IS core's public surface (copied verbatim, never regenerated: a
 * hand-written duplicate drifts the moment core gains an export).
 */
export const RUNTIME_FILES = [
  'signal.js',
  'bind.js',
  'list.js',
  'each.js',
  'compiled.js',
  'html.js',
  'mount.js',
  'runtime.js',
  'index.js',
];

/* String-only handling: under a DOM test environment the global URL class is
   not node's, and node's fileURLToPath rejects foreign URL instances. */
const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);

/**
 * Where to copy the runtime FROM.
 *
 * The project being ejected wins: its installed `amojs` is the version
 * its code was written against, so that is the copy the user gets to keep.
 * Then the compiler's own install (`npx amojs-cli` in a project without the
 * dependency). Then the dev-phase workspace layout.
 */
function findCoreSrc(projectDir: string): string {
  for (const base of [projectDir, HERE]) {
    try {
      // resolve() honors the package's `exports` map: "." → src/index.js
      return dirname(createRequire(join(base, 'noop.js')).resolve('amojs'));
    } catch {
      // not installed from here — keep looking
    }
  }
  return join(HERE, '../../core/src');
}

export interface EjectResult extends BuildResult {
  /** runtime files written under <outDir>/<runtimeDir>/ */
  runtime: string[];
  /** absolute directory the runtime was copied from */
  runtimeFrom: string;
}

export async function ejectDir(
  srcDir: string,
  outDir: string,
  options: { runtimeDir?: string } = {},
): Promise<EjectResult> {
  const runtimeDir = options.runtimeDir ?? 'amo-runtime';
  const runtimeFrom = findCoreSrc(srcDir);
  const built = await buildDir(srcDir, outDir);

  // 2) hand over the runtime
  const rtOut = join(outDir, runtimeDir);
  await mkdir(rtOut, { recursive: true });
  const runtime: string[] = [];
  for (const file of RUNTIME_FILES) {
    const from = join(runtimeFrom, file);
    try {
      await copyFile(from, join(rtOut, file));
    } catch {
      throw new Error(
        `amo eject: cannot read the runtime file ${from} — is amojs installed?`,
      );
    }
    runtime.push(join(runtimeDir, file));
  }

  // 3) point every module at its own runtime
  for (const rel of [...built.compiled, ...built.copied]) {
    if (!['.js', '.mjs'].includes(extname(rel))) continue;
    const file = join(outDir, rel);
    const source = await readFile(file, 'utf8');
    let prefix = relative(dirname(join(outDir, rel)), rtOut).split('\\').join('/');
    if (!prefix.startsWith('.')) prefix = `./${prefix}`;
    const out = source
      .replaceAll('"amojs/compiled"', `"${prefix}/compiled.js"`)
      .replaceAll("'amojs/compiled'", `'${prefix}/compiled.js'`)
      .replaceAll('"amojs/runtime"', `"${prefix}/runtime.js"`)
      .replaceAll("'amojs/runtime'", `'${prefix}/runtime.js'`)
      .replaceAll('"amojs"', `"${prefix}/index.js"`)
      .replaceAll("'amojs'", `'${prefix}/index.js'`);
    if (out !== source) await writeFile(file, out);
  }

  return { ...built, runtime, runtimeFrom };
}
