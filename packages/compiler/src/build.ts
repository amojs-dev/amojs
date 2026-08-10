/**
 * amo build — compile a whole directory.
 *
 * Walks srcDir; every .js/.mjs module goes through compileModule (which
 * returns it untouched when it owns no amo templates); everything else is
 * copied verbatim. The CLI binary (v0.4b) is a thin wrapper over this.
 */

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { compileModule } from './codegen.js';
import type { CompileOptions } from './codegen.js';

export interface BuildResult {
  /** files that actually changed during compilation (repo-relative) */
  compiled: string[];
  /** files passed through untouched */
  copied: string[];
}

const JS_EXT = new Set(['.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

export async function buildDir(
  srcDir: string,
  outDir: string,
  opts: CompileOptions = {},
): Promise<BuildResult> {
  const result: BuildResult = { compiled: [], copied: [] };

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const src = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(src);
        continue;
      }
      const rel = relative(srcDir, src);
      const dest = join(outDir, rel);
      await mkdir(dirname(dest), { recursive: true });

      if (JS_EXT.has(extname(entry.name))) {
        const source = await readFile(src, 'utf8');
        const out = compileModule(source, opts);
        await writeFile(dest, out);
        (out !== source ? result.compiled : result.copied).push(rel);
      } else {
        await copyFile(src, dest);
        result.copied.push(rel);
      }
    }
  }

  await walk(srcDir);
  return result;
}
