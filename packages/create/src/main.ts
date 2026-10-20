#!/usr/bin/env node
/**
 * create-amojs — scaffold an AmoJS project.
 *
 *   npm create amojs my-app                        # asks the questions
 *   npm create amojs my-app -- --ssg --no-island --ts   # flags skip them
 *
 * Templates are frozen copies of proven shapes, driven entirely by the CLI
 * — dev, build, serve. `common/` is shared by all; the variant decides the
 * rest: `site/` (ssg/ssr with the sample island), `site-plain/` (ssg/ssr,
 * zero client JS), `csr/` (a browser app: index.html + main.js). The
 * TypeScript variant is the same files as .ts plus one tsconfig (the build
 * strips types itself); the ssr variant is the same files with ssr in the
 * scripts (pages render per request instead of at build time). No
 * infrastructure files, ever.
 *
 * Questions are asked only on a real terminal; anywhere else (CI, a script)
 * the unanswered ones fall back to the defaults: ssg, sample island,
 * JavaScript.
 */

import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_DEPS } from './deps.js';
import { select } from './prompt.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, '../template');

const USAGE = `create-amojs — scaffold an AmoJS project

Usage:
  npm create amojs <dir>                     asks the questions below
  npm create amojs <dir> -- [--ssg | --ssr | --csr] [--island | --no-island]
                            [--ts | --js]

  ssg    static site — pages render to .html at build time (default)
  ssr    server-rendered — pages render per request from a plain node server
  csr    browser app — everything renders on the client

  --no-island   ssg/ssr without the sample counter island — pure HTML,
                zero client JavaScript (default: --island)
`;

function fail(msg: string): never {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

/** `.git` never counts — scaffolding into a freshly-initialized repo is the
    most common flow there is */
const IGNORED_ENTRIES = new Set(['.git', '.DS_Store']);

async function isEmptyOrMissing(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).filter((f) => !IGNORED_ENTRIES.has(f)).length === 0;
  } catch {
    return true; // missing — mkdir will create it
  }
}

async function main(argv: string[]): Promise<void> {
  let ts: boolean | undefined;
  let mode: 'ssg' | 'ssr' | 'csr' | undefined;
  let island: boolean | undefined;
  const args: string[] = [];
  for (const a of argv) {
    if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      return;
    }
    if (a === '--') continue; // npx forwards it literally; npm create strips it
    if (a === '--ts' || a === '--template=typescript') ts = true;
    else if (a === '--js') ts = false;
    else if (a === '--ssg') mode = 'ssg';
    else if (a === '--ssr') mode = 'ssr';
    else if (a === '--csr') mode = 'csr';
    else if (a === '--island') island = true;
    else if (a === '--no-island') island = false;
    else if (a === '--template') fail('create-amojs: use --ts (or --template=typescript)');
    else if (a.startsWith('-')) fail(`create-amojs: unknown flag "${a}"\n\n${USAGE}`);
    else args.push(a);
  }

  const dirArg = args[0];
  if (!dirArg || args.length > 1) fail(USAGE);
  const dir = resolve(dirArg);
  if (!(await isEmptyOrMissing(dir))) {
    fail(`create-amojs: ${dirArg} exists and is not empty`);
  }

  // ask only what the flags left open, and only on a real terminal
  if (process.stdin.isTTY && process.stdout.isTTY) {
    if (mode === undefined) {
      mode = (await select('What are you building?', [
        { value: 'ssg', label: 'ssg', hint: '— static site: pages render to .html at build time' },
        { value: 'ssr', label: 'ssr', hint: '— server-rendered: pages render per request' },
        { value: 'csr', label: 'csr', hint: '— browser app: everything renders on the client' },
      ])) as 'ssg' | 'ssr' | 'csr';
    }
    if (mode !== 'csr' && island === undefined) {
      island =
        (await select('Include the sample island (a client-side counter)?', [
          { value: 'yes', label: 'yes', hint: '— shows how client JS plugs into a rendered page' },
          { value: 'no', label: 'no', hint: '— pure HTML, zero client JavaScript' },
        ])) === 'yes';
    }
    if (ts === undefined) {
      ts =
        (await select('Language?', [
          { value: 'js', label: 'JavaScript' },
          { value: 'ts', label: 'TypeScript', hint: '— same files, plus one tsconfig' },
        ])) === 'ts';
    }
  }
  mode ??= 'ssg';
  ts ??= false;
  if (mode === 'csr' && island !== undefined) {
    fail('create-amojs: --island/--no-island do not apply to csr — the whole app is client code');
  }
  island ??= true;

  // 1) the template files: common/ plus exactly one variant dir. Renames on
  //    the way out:
  //    gitignore → .gitignore (npm strips real .gitignore from tarballs),
  //    vscode/ → .vscode/ (same reason, editor recommendations),
  //    src/**/*.js → .ts when asked — plain JS is valid TypeScript, and
  //    `amo build` strips whatever types you add later.
  const variant = mode === 'csr' ? 'csr' : island ? 'site' : 'site-plain';
  for (const layer of ['common', variant]) {
    const root = join(TEMPLATE, layer);
    const files: string[] = [];
    async function walk(from: string): Promise<void> {
      for (const entry of await readdir(from, { withFileTypes: true })) {
        const p = join(from, entry.name);
        if (entry.isDirectory()) await walk(p);
        else files.push(relative(root, p));
      }
    }
    await walk(root);

    for (const rel of files.sort()) {
      let destRel = rel;
      if (rel === 'gitignore') destRel = '.gitignore';
      if (rel.startsWith('vscode' + sep)) destRel = '.' + rel;
      if (ts && destRel.startsWith('src' + sep) && destRel.endsWith('.js') && !destRel.endsWith('.mjs')) {
        destRel = destRel.slice(0, -3) + '.ts';
      }
      const dest = join(dir, destRel);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(join(root, rel), dest);
    }
  }

  // 2) package.json — generated, so it carries the project's own name
  const pkg = {
    name: basename(dir),
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: `amo dev ${mode}`,
      build: `amo build ${mode}`,
      serve: `amo serve ${mode}`,
      ...(ts ? { check: 'tsc --noEmit' } : {}),
    },
    dependencies: { '@amojs.dev/core': TEMPLATE_DEPS['@amojs.dev/core'] },
    devDependencies: {
      '@amojs.dev/cli': TEMPLATE_DEPS['@amojs.dev/cli'],
      ...(ts ? { typescript: TEMPLATE_DEPS.typescript } : {}),
    },
    engines: { node: '>=22' },
  };
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // 3) tsconfig — the one extra file TypeScript costs
  if (ts) {
    const tsconfig = {
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'es2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        lib: ['es2022', 'dom'],
        erasableSyntaxOnly: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
      },
      include: ['src'],
    };
    await writeFile(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n');
  }

  const shape =
    mode === 'csr'
      ? `src/main.${ts ? 'ts' : 'js'} is the client entry`
      : island
        ? 'src/pages/ renders on node · src/islands/ is the client JS'
        : 'src/pages/ renders on node · zero client JS (add src/islands/ when needed)';
  process.stdout.write(
    `created ${dirArg} (${mode}${mode !== 'csr' && !island ? ', no island' : ''}` +
      `${ts ? ', TypeScript' : ''})\n\n` +
      `  cd ${dirArg}\n` +
      '  npm install\n' +
      '  npm run dev\n\n' +
      `${shape} ·\n` +
      'src/public/ serves from / · the editor will suggest the AmoJS extension\n',
  );
}

main(process.argv.slice(2)).catch((err: unknown) => {
  fail(`create-amojs: ${err instanceof Error ? err.message : String(err)}`);
});
