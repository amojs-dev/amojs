/**
 * amo dev — the dev loop: build, serve <out>, rebuild when <src> changes,
 * and tell the open browser tabs what to do about it (see hmr.ts):
 * css swaps in place, a changed island re-mounts, anything else reloads.
 *
 * A rebuild that fails prints its error and keeps serving the last good
 * build; the server never dies with the code it is serving.
 *
 * The server itself lives in serve.ts, shared with `amo serve` — dev adds
 * the watcher, the update channel, and, for ssr, a version counter so
 * rebuilt page modules re-import fresh on the next request.
 */

import { existsSync, watch } from 'node:fs';
import { basename, join } from 'node:path';
import { startServer } from './serve.js';
import type { SsrOptions } from './serve.js';
import { applyDevFacade, broadcast, classify } from './hmr.js';
import type { DevChannel } from './hmr.js';

export interface DevOptions {
  srcDir: string;
  outDir: string;
  port: number;
  /** the islands dir (src-relative) when the mode has one; null for csr */
  islandsDir: string | null;
  /** render pages per request while developing an ssr project */
  ssr?: Omit<SsrOptions, 'version'>;
  /** runs the full build; a throw is printed, never fatal */
  build: () => Promise<void>;
}

/** never resolves — the process is the server until the user stops it */
export async function runDev(opts: DevOptions): Promise<void> {
  const { srcDir, outDir, port, islandsDir, ssr, build } = opts;
  const dev: DevChannel = { clients: new Set() };
  let version = 1;

  async function rebuild(): Promise<boolean> {
    try {
      await build();
      await applyDevFacade(outDir); // the build rewrote _amo/ — wrap it again
      version++;
      return true;
    } catch (err) {
      process.stderr.write(
        `amo dev: build failed — serving the last good build\n${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
      return false;
    }
  }

  await rebuild();

  startServer({
    outDir,
    port,
    cacheControl: 'no-store',
    dev,
    ssr: ssr ? { ...ssr, version: () => version } : undefined,
  });

  let pending: NodeJS.Timeout | undefined;
  const changed = new Set<string>();
  watch(srcDir, { recursive: true }, (_event, filename) => {
    if (filename) changed.add(filename.toString());
    clearTimeout(pending);
    pending = setTimeout(async () => {
      // editors save atomically through temp files (.name!123, name~, .swp);
      // those are noise: hidden/backup names never classify, and a path that
      // no longer exists was a temp file already cleaned up (a deleted real
      // file still reloads — the batch just goes empty and reload is the
      // empty batch's answer)
      const batch = [...changed].filter(
        (p) =>
          !basename(p).startsWith('.') && !p.endsWith('~') && existsSync(join(srcDir, p)),
      );
      changed.clear();
      process.stdout.write('\nrebuilding…\n');
      if (await rebuild()) {
        const update = classify(batch, { islandsDir, v: version });
        broadcast(dev, update);
        process.stdout.write(
          update.type === 'css'
            ? 'hot — stylesheets swapped in place\n'
            : update.type === 'island'
              ? `hot — ${update.paths.join(', ')} re-mounted\n`
              : 'reload\n',
        );
      }
    }, 60);
  });

  return new Promise(() => {
    // resolves never — ^C is the exit
  });
}
