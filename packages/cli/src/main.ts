#!/usr/bin/env node
/**
 * amo — the AmoJS CLI (v0.4b).
 *
 * A thin, zero-dependency wrapper over @amojs/compiler:
 *   amo build <src> <out>   → buildDir  (compile amo modules, copy the rest)
 *   amo eject <src> <out>   → ejectDir  (build + hand over the runtime,
 *                                        rewrite imports to relative paths)
 *
 * Ships as plain JS: tsc compiles this file to dist/main.js (the shebang
 * survives emit), so users need no TypeScript toolchain — node runs it raw.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildDir, ejectDir } from '@amojs/compiler';

const USAGE = `amo — compiles to the vanilla JS you would have written

Usage:
  amo build <src> <out>                 compile amo modules, copy everything else
  amo eject <src> <out> [--runtime <dir>]
                                        build, then hand the runtime over and
                                        rewrite every "@amojs" import to a
                                        relative path (default dir: amo-runtime)
  amo --help | --version
`;

function fail(msg: string): never {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

async function ownVersion(): Promise<string> {
  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return pkg.version;
}

async function requireDir(p: string, label: string): Promise<void> {
  try {
    if ((await stat(p)).isDirectory()) return;
  } catch {
    fail(`amo: ${label} is not a directory: ${p}`);
  }
  fail(`amo: ${label} is not a directory: ${p}`);
}

async function main(argv: string[]): Promise<void> {
  const args: string[] = [];
  let runtimeDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      return;
    }
    if (a === '-v' || a === '--version') {
      process.stdout.write((await ownVersion()) + '\n');
      return;
    }
    if (a === '--runtime') {
      runtimeDir = argv[++i];
      if (!runtimeDir) fail('amo: --runtime needs a value');
    } else if (a.startsWith('-')) {
      fail(`amo: unknown flag "${a}"\n\n${USAGE}`);
    } else {
      args.push(a);
    }
  }

  const [cmd, srcArg, outArg] = args;
  if ((cmd !== 'build' && cmd !== 'eject') || !srcArg || !outArg || args.length > 3) {
    fail(USAGE);
  }
  if (cmd === 'build' && runtimeDir !== undefined) {
    fail('amo: --runtime only applies to eject');
  }

  const src = resolve(srcArg);
  const out = resolve(outArg);
  await requireDir(src, '<src>');
  if (out === src) fail('amo: <out> must differ from <src>');

  if (cmd === 'build') {
    const r = await buildDir(src, out);
    process.stdout.write(
      `amo build — ${r.compiled.length} compiled, ${r.copied.length} copied → ${outArg}\n`,
    );
  } else {
    const r = await ejectDir(src, out, runtimeDir ? { runtimeDir } : {});
    process.stdout.write(
      `amo eject — ${r.compiled.length} compiled, ${r.copied.length} copied, ` +
        `${r.runtime.length} runtime files → ${outArg} (runtime: ${runtimeDir ?? 'amo-runtime'}/)\n` +
        `runtime taken from ${r.runtimeFrom}\n` +
        'no bare "@amojs" imports remain — deleting amo changes nothing.\n',
    );
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  fail(`amo: ${err instanceof Error ? err.message : String(err)}`);
});
