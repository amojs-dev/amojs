#!/usr/bin/env node
/**
 * amo — the AmoJS CLI (v0.4b).
 *
 * A thin, zero-dependency wrapper over @amojs.dev/compiler:
 *   amo build <src> <out>   → buildDir  (compile amo modules, copy the rest;
 *                                        --target server emits strings for node)
 *   amo ssg   <src> <out>   → ssgDir    (render pages/ to static .html now)
 *   amo eject <src> <out>   → ejectDir  (build + hand over the runtime,
 *                                        rewrite imports to relative paths)
 *
 * Ships as plain JS: tsc compiles this file to dist/main.js (the shebang
 * survives emit), so users need no TypeScript toolchain — node runs it raw.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildDir, ejectDir, ssgDir } from '@amojs.dev/compiler';

const USAGE = `amo — compiles to the vanilla JS you would have written

Usage:
  amo build <src> <out> [--target dom|server]
                                        compile amo modules, copy everything
                                        else. --target server emits string
                                        concatenation instead of DOM calls, for
                                        rendering on node (default: dom)
  amo eject <src> <out> [--runtime <dir>]
                                        build, then hand the runtime over and
                                        rewrite every "@amojs.dev/core" import to a
                                        relative path (default dir: amo-runtime)
  amo ssg <src> <out> [--pages <dir>]   render every page module under
                                        <src>/pages/ (or --pages) to static
                                        .html — zero script bytes unless a page
                                        carries its own island <script>
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
  let pagesDir: string | undefined;
  let target: 'dom' | 'server' | undefined;

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
    } else if (a === '--pages') {
      pagesDir = argv[++i];
      if (!pagesDir) fail('amo: --pages needs a value');
    } else if (a === '--target') {
      const t = argv[++i];
      if (t !== 'dom' && t !== 'server') fail('amo: --target must be "dom" or "server"');
      target = t;
    } else if (a.startsWith('-')) {
      fail(`amo: unknown flag "${a}"\n\n${USAGE}`);
    } else {
      args.push(a);
    }
  }

  const [cmd, srcArg, outArg] = args;
  if (
    (cmd !== 'build' && cmd !== 'eject' && cmd !== 'ssg') ||
    !srcArg ||
    !outArg ||
    args.length > 3
  ) {
    fail(USAGE);
  }
  if (cmd !== 'eject' && runtimeDir !== undefined) {
    fail('amo: --runtime only applies to eject');
  }
  if (cmd !== 'ssg' && pagesDir !== undefined) {
    fail('amo: --pages only applies to ssg');
  }
  // eject hands over a browser runtime, and ssg picks its own target per step
  if (cmd !== 'build' && target !== undefined) {
    fail('amo: --target only applies to build');
  }

  const src = resolve(srcArg);
  const out = resolve(outArg);
  await requireDir(src, '<src>');
  if (out === src) fail('amo: <out> must differ from <src>');

  if (cmd === 'build') {
    const r = await buildDir(src, out, target ? { target } : {});
    process.stdout.write(
      `amo build${target === 'server' ? ' (server target)' : ''} — ` +
        `${r.compiled.length} compiled, ${r.copied.length} copied → ${outArg}\n` +
        (target === 'server'
          ? 'these modules render to strings on node — import a page and call it ' +
            'with that request\'s props.\n'
          : ''),
    );
  } else if (cmd === 'ssg') {
    const r = await ssgDir(src, out, pagesDir ? { pagesDir } : {});
    process.stdout.write(
      `amo ssg — ${r.pages.length} page${r.pages.length === 1 ? '' : 's'} rendered → ${outArg}\n` +
        r.pages.map((p) => `  ${p.src} → ${p.out}\n`).join(''),
    );
  } else {
    const r = await ejectDir(src, out, runtimeDir ? { runtimeDir } : {});
    process.stdout.write(
      `amo eject — ${r.compiled.length} compiled, ${r.copied.length} copied, ` +
        `${r.runtime.length} runtime files → ${outArg} (runtime: ${runtimeDir ?? 'amo-runtime'}/)\n` +
        `runtime taken from ${r.runtimeFrom}\n` +
        'no bare "@amojs.dev/core" imports remain — deleting amo changes nothing.\n',
    );
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  fail(`amo: ${err instanceof Error ? err.message : String(err)}`);
});
