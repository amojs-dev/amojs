/**
 * vendorCore — make a built islands directory self-contained.
 *
 * A compiled island imports '@amojs.dev/core/runtime' and '/compiled' — bare
 * specifiers a browser cannot resolve. Before this existed, every project
 * hand-wrote the same two steps: copy core's browser bundle somewhere under
 * dist, and author an importmap pointing at it. Both are the build's job:
 *
 *   1. copy core's prebuilt browser bundle(s) into <outRoot>/_amo/
 *   2. rewrite the islands' core specifiers to relative paths into it
 *
 * One url per bundle, so every island shares ONE core — module-level state
 * means two copies do not interoperate. A bundle is copied only when an
 * island actually references it: a page whose islands never import core
 * vendors nothing, and _amo/ does not appear.
 *
 * Resolution is project-first, the same rule eject follows: the project's own
 * installed core is the version its code was written against.
 */

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export interface VendorResult {
  /** bundles written under <outRoot>/_amo/ (out-relative) */
  vendored: string[];
  /** island files whose core imports were rewritten (islands-relative) */
  rewritten: string[];
}

const VENDOR_DIR = '_amo';

/* String-only handling: under a DOM test environment the global URL class is
   not node's, and node's fileURLToPath rejects foreign URL instances. */
const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);

/** resolve a core subpath project-first, then from the compiler's own install */
function resolveCore(subpath: string, projectDir: string): string {
  for (const base of [projectDir, HERE]) {
    try {
      return createRequire(join(base, 'noop.js')).resolve(subpath);
    } catch {
      // not installed from here — keep looking
    }
  }
  throw new Error(
    `cannot resolve ${subpath} — is @amojs.dev/core installed? ` +
      '(in the amojs workspace: run pnpm build first, the bundles live in dist/)',
  );
}

/**
 * Longest specifier first — the bare name is a prefix of every subpath, the
 * same ordering rule eject.ts follows. Value is the vendored file each one
 * resolves to.
 */
const SPECIFIERS: [specifier: string, bundle: 'runtime.js' | 'core.js'][] = [
  ['@amojs.dev/core/browser/runtime', 'runtime.js'],
  ['@amojs.dev/core/browser', 'core.js'],
  ['@amojs.dev/core/compiled', 'runtime.js'],
  ['@amojs.dev/core/runtime', 'runtime.js'],
  ['@amojs.dev/core', 'core.js'],
];

/** which prebuilt bundle backs each vendored file */
const BUNDLE_SUBPATH = {
  'runtime.js': '@amojs.dev/core/browser/runtime',
  'core.js': '@amojs.dev/core/browser',
} as const;

export async function vendorCore(
  outRoot: string,
  islandsOut: string,
  projectDir: string,
): Promise<VendorResult> {
  const result: VendorResult = { vendored: [], rewritten: [] };
  const vendorOut = join(outRoot, VENDOR_DIR);
  const needed = new Set<'runtime.js' | 'core.js'>();

  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (['.js', '.mjs'].includes(extname(entry.name))) files.push(p);
    }
  }
  await walk(islandsOut);

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    let prefix = relative(dirname(file), vendorOut).split('\\').join('/');
    if (!prefix.startsWith('.')) prefix = `./${prefix}`;
    let out = source;
    for (const [spec, bundle] of SPECIFIERS) {
      const next = out
        .replaceAll(`"${spec}"`, `"${prefix}/${bundle}"`)
        .replaceAll(`'${spec}'`, `'${prefix}/${bundle}'`);
      if (next !== out) needed.add(bundle);
      out = next;
    }
    if (out !== source) {
      await writeFile(file, out);
      result.rewritten.push(relative(islandsOut, file));
    }
  }

  if (needed.size > 0) await mkdir(vendorOut, { recursive: true });
  for (const bundle of [...needed].sort()) {
    await copyFile(resolveCore(BUNDLE_SUBPATH[bundle], projectDir), join(vendorOut, bundle));
    result.vendored.push(join(VENDOR_DIR, bundle));
  }
  return result;
}
