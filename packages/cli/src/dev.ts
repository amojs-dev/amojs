/**
 * amo dev — the dev loop: build, serve <out>, rebuild when <src> changes.
 *
 * There is no HMR and none is wanted — a full rebuild is well under a second,
 * and a refresh really is enough. Zero dependencies, like the rest of the CLI.
 * A rebuild that fails prints its error and keeps serving the last good
 * build; the server never dies with the code it is serving.
 *
 * The server itself lives in serve.ts, shared with `amo serve` — dev adds
 * the watcher and, for ssr, a version counter so rebuilt page modules
 * re-import fresh on the next request.
 */

import { watch } from 'node:fs';
import { startServer } from './serve.js';
import type { SsrOptions } from './serve.js';

export interface DevOptions {
  srcDir: string;
  outDir: string;
  port: number;
  /** render pages per request while developing an ssr project */
  ssr?: Omit<SsrOptions, 'version'>;
  /** runs the full build; a throw is printed, never fatal */
  build: () => Promise<void>;
}

/** never resolves — the process is the server until the user stops it */
export async function runDev(opts: DevOptions): Promise<void> {
  const { srcDir, outDir, port, ssr, build } = opts;
  let version = 1;

  async function rebuild(): Promise<void> {
    try {
      await build();
      version++;
    } catch (err) {
      process.stderr.write(
        `amo dev: build failed — serving the last good build\n${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }

  await rebuild();

  startServer({
    outDir,
    port,
    cacheControl: 'no-store',
    ssr: ssr ? { ...ssr, version: () => version } : undefined,
  });

  let pending: NodeJS.Timeout | undefined;
  watch(srcDir, { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      process.stdout.write('\nrebuilding…\n');
      void rebuild();
    }, 60);
  });

  return new Promise(() => {
    // resolves never — ^C is the exit
  });
}
