/**
 * amo eject — the framework you can uninstall.
 *
 * eject = build + hand the runtime over to the user:
 *   1. compile every module (buildDir)
 *   2. copy the runtime source files — plain, commented JS — into
 *      <outDir>/<runtimeDir>/ (they only import each other relatively)
 *   3. rewrite every '@amojs/core[/compiled]' specifier to a relative path
 *
 * The result has ZERO bare imports: module resolution never touches
 * node_modules, so deleting amo changes nothing. That is the whole promise.
 */

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDir } from './build.js';
import type { BuildResult } from './build.js';

/* everything a compiled app can need — html.js included, because a module
   may legitimately keep raw html`` usage (e.g. passing `html` around) */
const RUNTIME_FILES = [
  'signal.js',
  'bind.js',
  'list.js',
  'each.js',
  'compiled.js',
  'html.js',
  'mount.js',
];

const RUNTIME_INDEX = `/**
 * amo runtime — ejected copy. This code is YOURS now: readable, dependency-
 * free, and no longer connected to the amo package in any way.
 */
export { signal, computed, effect, isSignal, flushSync, tick } from './signal.js';
export { html } from './html.js';
export { mount } from './mount.js';
export { each } from './each.js';
`;

/* dev-phase resolution: the workspace layout. The CLI package (v0.4b) will
   resolve the installed @amojs/core location instead.
   String-only handling: under a DOM test environment the global URL class is
   not node's, and node's fileURLToPath rejects foreign URL instances. */
const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const CORE_SRC = join(HERE, '../../core/src/');

export interface EjectResult extends BuildResult {
  /** runtime files written under <outDir>/<runtimeDir>/ */
  runtime: string[];
}

export async function ejectDir(
  srcDir: string,
  outDir: string,
  options: { runtimeDir?: string } = {},
): Promise<EjectResult> {
  const runtimeDir = options.runtimeDir ?? 'amo-runtime';
  const built = await buildDir(srcDir, outDir);

  // 2) hand over the runtime
  const rtOut = join(outDir, runtimeDir);
  await mkdir(rtOut, { recursive: true });
  const runtime: string[] = [];
  for (const file of RUNTIME_FILES) {
    await copyFile(join(CORE_SRC, file), join(rtOut, file));
    runtime.push(join(runtimeDir, file));
  }
  await writeFile(join(rtOut, 'index.js'), RUNTIME_INDEX);
  runtime.push(join(runtimeDir, 'index.js'));

  // 3) point every module at its own runtime
  for (const rel of [...built.compiled, ...built.copied]) {
    if (!['.js', '.mjs'].includes(extname(rel))) continue;
    const file = join(outDir, rel);
    const source = await readFile(file, 'utf8');
    let prefix = relative(dirname(join(outDir, rel)), rtOut).split('\\').join('/');
    if (!prefix.startsWith('.')) prefix = `./${prefix}`;
    const out = source
      .replaceAll('"@amojs/core/compiled"', `"${prefix}/compiled.js"`)
      .replaceAll("'@amojs/core/compiled'", `'${prefix}/compiled.js'`)
      .replaceAll('"@amojs/core"', `"${prefix}/index.js"`)
      .replaceAll("'@amojs/core'", `'${prefix}/index.js'`);
    if (out !== source) await writeFile(file, out);
  }

  return { ...built, runtime };
}
