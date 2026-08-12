#!/usr/bin/env node
/**
 * amo — the AmoJS CLI.
 *
 * A thin, zero-dependency wrapper over @amojs.dev/compiler:
 *   amo build [mode] [src] [out]  → buildDir / ssgDir per mode
 *                                   (csr | ssr | ssg; src → dist by default)
 *   amo eject <src> <out>         → ejectDir (build + hand over the runtime,
 *                                   rewrite imports to relative paths)
 *
 * Ships as plain JS: tsc compiles this file to dist/main.js (the shebang
 * survives emit), so users need no TypeScript toolchain — node runs it raw.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildDir, ejectDir, ssgDir } from '@amojs.dev/compiler';

const USAGE = `amo — compiles to the vanilla JS you would have written

Usage:
  amo build [mode] [src] [out]          mode: csr (default) | ssr | ssg
                                        src defaults to src/, out to dist/

    csr    compile amo modules for the browser, copy everything else
    ssr    compile with the server target — modules render to strings on
           node; import a page and call it with that request's props
    ssg    render every page module under <src>/pages/ to static .html

    with ssr and ssg, <src>/islands/ (if present) is DOM-compiled to
    <out>/islands/ automatically — the interactive pieces of the page

    --islands <dir>                     islands folder inside <src>
                                        (ssr/ssg, default: islands)
    --pages <dir>                       pages folder inside <src>
                                        (ssg only, default: pages)

  amo eject <src> <out> [--runtime <dir>]
                                        build, then hand the runtime over and
                                        rewrite every "@amojs.dev/core" import to a
                                        relative path (default dir: amo-runtime)
  amo --help | --version
`;

const MODES = new Set(['csr', 'ssr', 'ssg'] as const);
type Mode = 'csr' | 'ssr' | 'ssg';

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

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function requireDir(p: string, label: string): Promise<void> {
  if (!(await isDir(p))) fail(`amo: ${label} is not a directory: ${p}`);
}

async function main(argv: string[]): Promise<void> {
  const args: string[] = [];
  let runtimeDir: string | undefined;
  let pagesDir: string | undefined;
  let islandsDir: string | undefined;

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
    } else if (a === '--islands') {
      islandsDir = argv[++i];
      if (!islandsDir) fail('amo: --islands needs a value');
    } else if (a === '--target') {
      fail('amo: --target is gone — use a mode instead: amo build ssr');
    } else if (a.startsWith('-')) {
      fail(`amo: unknown flag "${a}"\n\n${USAGE}`);
    } else {
      args.push(a);
    }
  }

  const cmd = args[0];
  if (cmd === 'ssg') {
    fail('amo: "amo ssg" moved — use: amo build ssg [src] [out]');
  }
  if (cmd !== 'build' && cmd !== 'eject') fail(USAGE);

  if (cmd === 'eject') {
    const [, srcArg, outArg] = args;
    if (!srcArg || !outArg || args.length > 3) fail(USAGE);
    if (pagesDir !== undefined) fail('amo: --pages only applies to build ssg');
    if (islandsDir !== undefined) fail('amo: --islands only applies to build ssr/ssg');
    const src = resolve(srcArg);
    const out = resolve(outArg);
    await requireDir(src, '<src>');
    if (out === src) fail('amo: <out> must differ from <src>');
    const r = await ejectDir(src, out, runtimeDir ? { runtimeDir } : {});
    process.stdout.write(
      `amo eject — ${r.compiled.length} compiled, ${r.copied.length} copied, ` +
        `${r.runtime.length} runtime files → ${outArg} (runtime: ${runtimeDir ?? 'amo-runtime'}/)\n` +
        `runtime taken from ${r.runtimeFrom}\n` +
        'no bare "@amojs.dev/core" imports remain — deleting amo changes nothing.\n',
    );
    return;
  }

  // amo build [mode] [src] [out] — a directory literally named after a mode
  // is written as ./ssr; the bare word always reads as the mode
  if (runtimeDir !== undefined) fail('amo: --runtime only applies to eject');
  const rest = args.slice(1);
  if (rest.length > 3) fail(USAGE);
  let mode: Mode = 'csr';
  if (rest.length > 0 && MODES.has(rest[0] as Mode)) {
    mode = rest.shift() as Mode;
  } else if (rest.length > 0 && rest.length !== 2) {
    fail(`amo: "${rest[0]}" is not a mode (csr | ssr | ssg)\n\n${USAGE}`);
  } else if (rest.length === 2) {
    fail(
      `amo: "${rest[0]}" is not a mode (csr | ssr | ssg) — ` +
        'a build without one is: amo build csr <src> <out>',
    );
  }
  const srcArg = rest.length === 2 ? rest[0] : 'src';
  const outArg = rest.length === 2 ? rest[1] : (rest[0] ?? 'dist');

  if (pagesDir !== undefined && mode !== 'ssg') fail('amo: --pages only applies to build ssg');
  if (islandsDir !== undefined && mode === 'csr') {
    fail('amo: --islands only applies to build ssr/ssg');
  }

  const src = resolve(srcArg);
  const out = resolve(outArg);
  if (srcArg === 'src' && rest.length !== 2 && !(await isDir(src))) {
    fail('amo: no src/ directory here — pass one: amo build <mode> <src> <out>');
  }
  await requireDir(src, '<src>');
  if (out === src) fail('amo: <out> must differ from <src>');

  const islands = islandsDir ?? 'islands';
  const islandsSrc = join(src, islands);
  const hasIslands = mode !== 'csr' && (await isDir(islandsSrc));
  if (islandsDir !== undefined && !hasIslands) {
    fail(`amo: --islands is not a directory: ${islandsSrc}`);
  }

  if (mode === 'ssg') {
    const r = await ssgDir(src, out, pagesDir ? { pagesDir } : {});
    process.stdout.write(
      `amo build ssg — ${r.pages.length} page${r.pages.length === 1 ? '' : 's'} rendered, ` +
        `${r.assets.length} asset${r.assets.length === 1 ? '' : 's'} copied → ${outArg}\n` +
        r.pages.map((p) => `  ${p.src} → ${p.out}\n`).join(''),
    );
  } else {
    const r = await buildDir(
      src,
      out,
      mode === 'ssr' ? { target: 'server', exclude: [islands] } : {},
    );
    process.stdout.write(
      `amo build${mode === 'ssr' ? ' ssr' : ''} — ` +
        `${r.compiled.length} compiled, ${r.copied.length} copied → ${outArg}\n` +
        (mode === 'ssr'
          ? 'these modules render to strings on node — import a page and call it ' +
            'with that request\'s props.\n'
          : ''),
    );
  }

  if (mode !== 'csr') {
    if (hasIslands) {
      const r = await buildDir(islandsSrc, join(out, islands), {});
      process.stdout.write(
        `islands — ${r.compiled.length} compiled, ${r.copied.length} copied → ` +
          `${join(outArg, islands)}\n`,
      );
    } else {
      process.stdout.write(`islands — none (no ${join(srcArg, islands)}/, skipped)\n`);
    }
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  fail(`amo: ${err instanceof Error ? err.message : String(err)}`);
});
