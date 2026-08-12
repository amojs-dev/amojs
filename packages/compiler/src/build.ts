/**
 * amo build — compile a whole directory.
 *
 * Walks srcDir; every module goes through compileModule (which returns it
 * untouched when it owns no amo templates); everything else is copied
 * verbatim. The CLI binary is a thin wrapper over this.
 *
 * TypeScript input: a `.ts`/`.mts` module has its types erased first — via
 * node's own `stripTypeScriptTypes` (zero dependencies) — and is emitted as
 * `.js`/`.mjs`. Erasable syntax only: an enum or namespace has runtime
 * meaning, so it is a build error, not a silent transform. `.d.ts` files are
 * for the editor and are skipped entirely. The compiler itself still parses
 * only JavaScript — stripping happens before it, never inside it.
 *
 * `<src>/public/` is the root-asset folder: everything in it is copied
 * VERBATIM to the root of `<out>` (public/favicon.svg → favicon.svg), never
 * compiled — the place for files whose url must be exact. It is copied
 * first, so generated output wins a path collision.
 */

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import module from 'node:module';
import { compileModule } from './codegen.js';
import type { CompileOptions } from './codegen.js';

export interface BuildResult {
  /** files that actually changed during compilation (out-relative) */
  compiled: string[];
  /** files passed through untouched (out-relative) */
  copied: string[];
}

export interface BuildOptions extends CompileOptions {
  /** src-relative directory paths to skip entirely (e.g. 'islands') */
  exclude?: string[];
}

/** module extension → emitted extension */
const MODULE_EXT = new Map([
  ['.js', '.js'],
  ['.mjs', '.mjs'],
  ['.ts', '.js'],
  ['.mts', '.mjs'],
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/** a module file the build compiles (as opposed to an asset it copies) */
export function isModuleFile(name: string): boolean {
  return MODULE_EXT.has(extname(name));
}

/** declaration files serve the editor, not the build */
export function isDeclarationFile(name: string): boolean {
  return name.endsWith('.d.ts') || name.endsWith('.d.mts');
}

/** the emitted `.js` file imports `.js` paths — TypeScript's own ESM convention */
const TS_SPECIFIER = /(?:from|import)\s*\(?\s*(['"])([^'"\n]*\.m?ts)\1/;

function stripTypes(source: string, rel: string): string {
  const strip = (
    module as unknown as { stripTypeScriptTypes?: (src: string, opts?: object) => string }
  ).stripTypeScriptTypes;
  if (!strip) {
    throw new Error('TypeScript input needs node >= 22.13 (module.stripTypeScriptTypes)');
  }
  let out: string;
  try {
    out = strip(source, { mode: 'strip' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${rel}: ${msg}` +
        (/not supported|strip/i.test(msg)
          ? ' — amo erases types only; syntax with runtime meaning (enum, namespace, parameter properties) is written as plain JS instead'
          : ''),
    );
  }
  const bad = TS_SPECIFIER.exec(out);
  if (bad) {
    const cure = bad[2].replace(/\.mts$/, '.mjs').replace(/\.ts$/, '.js');
    throw new Error(
      `${rel} imports "${bad[2]}" — import the emitted path instead: "${cure}"`,
    );
  }
  return out;
}

export const PUBLIC_DIR = 'public';

/**
 * Copy `<srcDir>/public/**` verbatim to the root of outDir. Returns the
 * out-relative paths written; [] when there is no public folder.
 */
export async function copyPublicDir(srcDir: string, outDir: string): Promise<string[]> {
  const root = join(srcDir, PUBLIC_DIR);
  const written: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
        continue;
      }
      const rel = relative(root, p);
      const dest = join(outDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(p, dest);
      written.push(rel);
    }
  }
  try {
    await walk(root);
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return []; // no public/ — fine
    throw err;
  }
  return written.sort();
}

export async function buildDir(
  srcDir: string,
  outDir: string,
  opts: BuildOptions = {},
): Promise<BuildResult> {
  const result: BuildResult = { compiled: [], copied: [] };
  const excluded = new Set((opts.exclude ?? []).map((p) => join(p)));
  excluded.add(PUBLIC_DIR); // root assets copy verbatim below, never compile

  result.copied.push(...(await copyPublicDir(srcDir, outDir)));

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const src = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !excluded.has(relative(srcDir, src))) await walk(src);
        continue;
      }
      if (isDeclarationFile(entry.name)) continue;
      const rel = relative(srcDir, src);
      const ext = extname(entry.name);
      const emitExt = MODULE_EXT.get(ext);
      const outRel = emitExt ? rel.slice(0, -ext.length) + emitExt : rel;
      const dest = join(outDir, outRel);
      await mkdir(dirname(dest), { recursive: true });

      if (emitExt) {
        const raw = await readFile(src, 'utf8');
        const source = emitExt === ext ? raw : stripTypes(raw, rel);
        const out = compileModule(source, opts);
        await writeFile(dest, out);
        (out !== raw ? result.compiled : result.copied).push(outRel);
      } else {
        await copyFile(src, dest);
        result.copied.push(outRel);
      }
    }
  }

  await walk(srcDir);
  return result;
}
