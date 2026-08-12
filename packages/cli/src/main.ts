#!/usr/bin/env node
/**
 * amo — the AmoJS CLI.
 *
 * A thin, zero-dependency wrapper over @amojs.dev/compiler:
 *   amo build [mode] [src] [out]  → buildDir / ssgDir per mode
 *                                   (csr | ssr | ssg; src → dist by default)
 *   amo dev [mode] [src] [out]    → build, watch <src>, serve <out>
 *   amo eject <src> <out>         → ejectDir (build + hand over the runtime,
 *                                   rewrite imports to relative paths)
 *
 * Ships as plain JS: tsc compiles this file to dist/main.js (the shebang
 * survives emit), so users need no TypeScript toolchain — node runs it raw.
 */

import { readFile, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { buildDir, ejectDir, ssgDir, vendorCore } from '@amojs.dev/compiler';
import { runDev } from './dev.js';
import { startServer } from './serve.js';

const USAGE = `amo — compiles to the vanilla JS you would have written

Usage:
  amo build [mode] [src] [out]          mode: csr (default) | ssr | ssg
                                        src defaults to src/, out to dist/

    csr    compile amo modules for the browser, copy everything else
    ssr    compile with the server target — modules render to strings on
           node; import a page and call it with that request's props
    ssg    render every page module under <src>/pages/ to static .html

    with ssr and ssg, <src>/islands/ (if present) is DOM-compiled to
    <out>/islands/ automatically, core's browser bundle is copied to
    <out>/_amo/, and island imports are rewritten to reach it — no
    importmap to write, one core url for every island

    source may be TypeScript — .ts modules are type-stripped (erasable
    syntax only) and emitted as .js; .d.ts files are skipped

    <src>/public/ is copied verbatim to the ROOT of <out> — the place
    for favicon.svg, robots.txt, fonts: files whose url must be exact

    <out> is emptied first when it sits inside the project, so nothing
    stale survives a rebuild; an <out> elsewhere is left to accumulate

    --islands <dir>                     islands folder inside <src>
                                        (ssr/ssg, default: islands)
    --pages <dir>                       pages folder inside <src>
                                        (ssg only, default: pages)

  amo dev [mode] [src] [out]            build, watch <src>, rebuild on change,
                                        serve <out>; ssr renders pages per
                                        request while you work
    --port <n>                          dev server port (default 4700)

  amo serve [mode] [dir]                serve a built <dir> (default dist):
                                        csr | ssg serve static files; ssr
                                        renders <dir>/pages/ per request,
                                        pages receive { url }
    --port <n>                          port (default $PORT, then 3000)

  amo eject <src> <out> [--runtime <dir>]
                                        build, then hand the runtime over and
                                        rewrite every "@amojs.dev/core" import to a
                                        relative path (default dir: amo-runtime)
  amo --help | --version
`;

/* node announces its type-stripper as experimental on every run — noise for
   every TS project. Swallow exactly that warning; everything else re-prints.
   (The default printer is itself a 'warning' listener, so it is removable.) */
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && w.message.includes('stripTypeScriptTypes')) return;
  process.stderr.write(`${w.name}: ${w.message}\n`);
});

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

/** strictly inside — never the directory itself */
function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Empty <out> before building, so a deleted source file cannot survive as a
 * stale artifact — but only when it is provably safe: <out> must sit inside
 * the project (never the project itself, never somewhere a typo points at),
 * and deleting it must not take <src> along. Anywhere else, files accumulate
 * and that is the user's arrangement to keep.
 */
async function cleanOut(out: string, src: string): Promise<void> {
  if (within(process.cwd(), out) && !within(out, src) && out !== src) {
    await rm(out, { recursive: true, force: true });
  }
}

interface BuildJob {
  mode: Mode;
  src: string;
  out: string;
  srcArg: string;
  outArg: string;
  pagesDir?: string;
  islands: string;
}

/** one full build — the body of `amo build`, and every `amo dev` rebuild */
async function runBuild(job: BuildJob): Promise<void> {
  const { mode, src, out, srcArg, outArg, pagesDir, islands } = job;
  const islandsSrc = join(src, islands);
  const hasIslands = mode !== 'csr' && (await isDir(islandsSrc));

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
      const v = await vendorCore(out, join(out, islands), src);
      if (v.vendored.length > 0) {
        process.stdout.write(
          `vendor — core → ${v.vendored.join(', ')} ` +
            `(${v.rewritten.length} island import${v.rewritten.length === 1 ? '' : 's'} ` +
            'rewritten — no importmap needed)\n',
        );
      }
    } else {
      process.stdout.write(`islands — none (no ${join(srcArg, islands)}/, skipped)\n`);
    }
  }
}

async function main(argv: string[]): Promise<void> {
  const args: string[] = [];
  let runtimeDir: string | undefined;
  let pagesDir: string | undefined;
  let islandsDir: string | undefined;
  let portArg: string | undefined;

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
    } else if (a === '--port') {
      portArg = argv[++i];
      if (!portArg) fail('amo: --port needs a value');
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
  if (cmd !== 'build' && cmd !== 'dev' && cmd !== 'serve' && cmd !== 'eject') fail(USAGE);

  if (cmd === 'eject') {
    const [, srcArg, outArg] = args;
    if (!srcArg || !outArg || args.length > 3) fail(USAGE);
    if (pagesDir !== undefined) fail('amo: --pages only applies to build ssg');
    if (islandsDir !== undefined) fail('amo: --islands only applies to build ssr/ssg');
    if (portArg !== undefined) fail('amo: --port only applies to dev');
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

  // amo serve [mode] [dir] — run what build made; no src, no watching
  if (cmd === 'serve') {
    if (runtimeDir !== undefined) fail('amo: --runtime only applies to eject');
    const rest = args.slice(1);
    if (rest.length > 2) fail(USAGE);
    let mode: Mode = 'csr';
    if (rest.length > 0 && MODES.has(rest[0] as Mode)) mode = rest.shift() as Mode;
    else if (rest.length === 2) fail(`amo: "${rest[0]}" is not a mode (csr | ssr | ssg)\n\n${USAGE}`);
    const dirArg = rest[0] ?? 'dist';
    const dir = resolve(dirArg);
    await requireDir(dir, '<dir>');

    if (mode !== 'ssr') {
      if (pagesDir !== undefined) fail('amo: --pages only applies to serve ssr');
      if (islandsDir !== undefined) fail('amo: --islands only applies to serve ssr');
    }
    const pages = pagesDir ?? 'pages';
    if (mode === 'ssr' && !(await isDir(join(dir, pages)))) {
      fail(`amo: no ${join(dirArg, pages)}/ to render — build first: amo build ssr`);
    }

    const port = portArg === undefined ? Number(process.env.PORT ?? 3000) : Number(portArg);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      fail(`amo: --port must be a port number, got "${portArg ?? process.env.PORT}"`);
    }
    startServer({
      outDir: dir,
      port,
      ssr: mode === 'ssr' ? { pagesDir: pages, islandsDir: islandsDir ?? 'islands' } : undefined,
    });
    await new Promise(() => {
      // resolves never — ^C is the exit
    });
    return;
  }

  // amo build|dev [mode] [src] [out] — a directory literally named after a
  // mode is written as ./ssr; the bare word always reads as the mode
  if (runtimeDir !== undefined) fail('amo: --runtime only applies to eject');
  if (portArg !== undefined && cmd !== 'dev') fail('amo: --port only applies to dev and serve');
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
        `a ${cmd} without one is: amo ${cmd} csr <src> <out>`,
    );
  }
  const srcArg = rest.length === 2 ? rest[0] : 'src';
  const outArg = rest.length === 2 ? rest[1] : (rest[0] ?? 'dist');

  if (pagesDir !== undefined && mode === 'csr') fail('amo: --pages does not apply to csr');
  if (pagesDir !== undefined && mode === 'ssr' && cmd === 'build') {
    fail('amo: --pages only applies to build ssg (build ssr compiles the whole tree)');
  }
  if (islandsDir !== undefined && mode === 'csr') {
    fail('amo: --islands only applies to build ssr/ssg');
  }
  const src = resolve(srcArg);
  const out = resolve(outArg);
  if (srcArg === 'src' && rest.length !== 2 && !(await isDir(src))) {
    fail(`amo: no src/ directory here — pass one: amo ${cmd} <mode> <src> <out>`);
  }
  await requireDir(src, '<src>');
  if (out === src) fail('amo: <out> must differ from <src>');

  const islands = islandsDir ?? 'islands';
  const islandsSrc = join(src, islands);
  if (islandsDir !== undefined && mode !== 'csr' && !(await isDir(islandsSrc))) {
    fail(`amo: --islands is not a directory: ${islandsSrc}`);
  }

  const job: BuildJob = { mode, src, out, srcArg, outArg, pagesDir, islands };

  if (cmd === 'dev') {
    const port = portArg === undefined ? 4700 : Number(portArg);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      fail(`amo: --port must be a port number, got "${portArg}"`);
    }
    // clean once at start — mid-session rebuilds write over a live server
    await cleanOut(out, src);
    await runDev({
      srcDir: src,
      outDir: out,
      port,
      islandsDir: mode === 'csr' ? null : islands,
      ssr: mode === 'ssr' ? { pagesDir: pagesDir ?? 'pages', islandsDir: islands } : undefined,
      build: () => runBuild(job),
    });
    return;
  }

  await cleanOut(out, src);
  await runBuild(job);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  fail(`amo: ${err instanceof Error ? err.message : String(err)}`);
});
