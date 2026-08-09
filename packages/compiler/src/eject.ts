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

/**
 * The router's source files, handed over only when the project actually
 * imports '@amojs.dev/router' — the router you can uninstall. They land in
 * <runtimeDir>/router/ so their own core imports resolve one level up.
 */
export const ROUTER_FILES = ['match.js', 'router.js', 'index.js'];

/* String-only handling: under a DOM test environment the global URL class is
   not node's, and node's fileURLToPath rejects foreign URL instances. */
const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);

/**
 * Where to copy the runtime FROM.
 *
 * The project being ejected wins: its installed `@amojs.dev/core` is the version
 * its code was written against, so that is the copy the user gets to keep.
 * Then the compiler's own install (`npx @amojs.dev/cli` in a project without the
 * dependency). Then the dev-phase workspace layout.
 */
function findCoreSrc(projectDir: string): string {
  for (const base of [projectDir, HERE]) {
    try {
      // resolve() honors the package's `exports` map: "." → src/index.js
      return dirname(createRequire(join(base, 'noop.js')).resolve('@amojs.dev/core'));
    } catch {
      // not installed from here — keep looking
    }
  }
  return join(HERE, '../../core/src');
}

/** Same resolution order for '@amojs.dev/router' — project first. */
function findRouterSrc(projectDir: string): string {
  for (const base of [projectDir, HERE]) {
    try {
      return dirname(createRequire(join(base, 'noop.js')).resolve('@amojs.dev/router'));
    } catch {
      // not installed from here — keep looking
    }
  }
  return join(HERE, '../../router/src');
}

export interface EjectResult extends BuildResult {
  /** runtime files written under <outDir>/<runtimeDir>/ */
  runtime: string[];
  /** absolute directory the runtime was copied from */
  runtimeFrom: string;
  /** absolute directory the router was copied from (projects that use it) */
  routerFrom?: string;
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

  // 2b) a project that routes gets the router handed over too — detected from
  // the emitted modules, so only apps that import it pay for the copy
  const jsFiles = [...built.compiled, ...built.copied].filter((rel) =>
    ['.js', '.mjs'].includes(extname(rel)),
  );
  let routerFrom: string | undefined;
  for (const rel of jsFiles) {
    if ((await readFile(join(outDir, rel), 'utf8')).includes('@amojs.dev/router')) {
      routerFrom = findRouterSrc(srcDir);
      break;
    }
  }
  if (routerFrom) {
    const routerOut = join(rtOut, 'router');
    await mkdir(routerOut, { recursive: true });
    for (const file of ROUTER_FILES) {
      let source: string;
      try {
        source = await readFile(join(routerFrom, file), 'utf8');
      } catch {
        throw new Error(
          `amo eject: cannot read the router file ${join(routerFrom, file)} — is @amojs.dev/router installed?`,
        );
      }
      // the handed-over router finds core one level up (subpaths FIRST — the
      // bare specifier is a prefix of both, same ordering rule as step 3)
      const out = source
        .replaceAll('"@amojs.dev/core/compiled"', '"../compiled.js"')
        .replaceAll("'@amojs.dev/core/compiled'", "'../compiled.js'")
        .replaceAll('"@amojs.dev/core/runtime"', '"../runtime.js"')
        .replaceAll("'@amojs.dev/core/runtime'", "'../runtime.js'")
        .replaceAll('"@amojs.dev/core"', '"../index.js"')
        .replaceAll("'@amojs.dev/core'", "'../index.js'");
      await writeFile(join(routerOut, file), out);
      runtime.push(join(runtimeDir, 'router', file));
    }
  }

  // 3) point every module at its own runtime
  for (const rel of jsFiles) {
    const file = join(outDir, rel);
    const source = await readFile(file, 'utf8');
    let prefix = relative(dirname(join(outDir, rel)), rtOut).split('\\').join('/');
    if (!prefix.startsWith('.')) prefix = `./${prefix}`;
    const out = source
      .replaceAll('"@amojs.dev/core/compiled"', `"${prefix}/compiled.js"`)
      .replaceAll("'@amojs.dev/core/compiled'", `'${prefix}/compiled.js'`)
      .replaceAll('"@amojs.dev/core/runtime"', `"${prefix}/runtime.js"`)
      .replaceAll("'@amojs.dev/core/runtime'", `'${prefix}/runtime.js'`)
      .replaceAll('"@amojs.dev/core"', `"${prefix}/index.js"`)
      .replaceAll("'@amojs.dev/core'", `'${prefix}/index.js'`)
      .replaceAll('"@amojs.dev/router"', `"${prefix}/router/index.js"`)
      .replaceAll("'@amojs.dev/router'", `'${prefix}/router/index.js'`);
    if (out !== source) await writeFile(file, out);
  }

  return { ...built, runtime, runtimeFrom, routerFrom };
}
