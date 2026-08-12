#!/usr/bin/env node
/**
 * create-amojs — scaffold an AmoJS project.
 *
 *   npm create amojs my-app                 # asks: ssg or ssr? TypeScript?
 *   npm create amojs my-app -- --ssg --ts   # flags skip the questions
 *
 * The template is a frozen copy of a proven shape (the amojs.dev docs-site
 * skeleton): src/pages + src/islands + src/styles + src/public, driven
 * entirely by the CLI — dev, build, serve. The TypeScript variant is the
 * same files as .ts plus one tsconfig (the build strips types itself); the
 * ssr variant is the same files with ssr in the scripts (pages render per
 * request instead of at build time). No infrastructure files, ever.
 *
 * Questions are asked only on a real terminal; anywhere else (CI, a script)
 * the unanswered ones fall back to the defaults: ssg, JavaScript.
 */

import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { TEMPLATE_DEPS } from './deps.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, '../template');

const USAGE = `create-amojs — scaffold an AmoJS project

Usage:
  npm create amojs <dir>                     asks: ssg or ssr? TypeScript?
  npm create amojs <dir> -- [--ssg | --ssr] [--ts | --js]

  ssg    static site — pages render to .html at build time (default)
  ssr    server-rendered — pages render per request from a plain node server
`;

function fail(msg: string): never {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

async function isEmptyOrMissing(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).filter((f) => f !== '.DS_Store').length === 0;
  } catch {
    return true; // missing — mkdir will create it
  }
}

async function main(argv: string[]): Promise<void> {
  let ts: boolean | undefined;
  let mode: 'ssg' | 'ssr' | undefined;
  const args: string[] = [];
  for (const a of argv) {
    if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      return;
    }
    if (a === '--ts' || a === '--template=typescript') ts = true;
    else if (a === '--js') ts = false;
    else if (a === '--ssg') mode = 'ssg';
    else if (a === '--ssr') mode = 'ssr';
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
  if ((mode === undefined || ts === undefined) && process.stdin.isTTY && process.stdout.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (mode === undefined) {
      const a = (await rl.question('static site (ssg) or server-rendered (ssr)? [ssg] '))
        .trim()
        .toLowerCase();
      if (a !== '' && a !== 'ssg' && a !== 'ssr') fail(`create-amojs: "${a}" is not a mode`);
      mode = a === 'ssr' ? 'ssr' : 'ssg';
    }
    if (ts === undefined) {
      const a = (await rl.question('TypeScript? (y/N) ')).trim().toLowerCase();
      ts = a === 'y' || a === 'yes';
    }
    rl.close();
  }
  mode ??= 'ssg';
  ts ??= false;

  // 1) the template files. Renames on the way out:
  //    gitignore → .gitignore (npm strips real .gitignore from tarballs),
  //    vscode/ → .vscode/ (same reason, editor recommendations),
  //    src/**/*.js → .ts when asked — plain JS is valid TypeScript, and
  //    `amo build` strips whatever types you add later.
  const files: string[] = [];
  async function walk(from: string): Promise<void> {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const p = join(from, entry.name);
      if (entry.isDirectory()) await walk(p);
      else files.push(relative(TEMPLATE, p));
    }
  }
  await walk(TEMPLATE);

  for (const rel of files.sort()) {
    let destRel = rel;
    if (rel === 'gitignore') destRel = '.gitignore';
    if (rel.startsWith('vscode' + sep)) destRel = '.' + rel;
    if (ts && destRel.startsWith('src' + sep) && destRel.endsWith('.js') && !destRel.endsWith('.mjs')) {
      destRel = destRel.slice(0, -3) + '.ts';
    }
    const dest = join(dir, destRel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(TEMPLATE, rel), dest);
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

  process.stdout.write(
    `created ${dirArg} (${mode}${ts ? ', TypeScript' : ''})\n\n` +
      `  cd ${dirArg}\n` +
      '  npm install\n' +
      '  npm run dev\n\n' +
      'src/pages/ renders on node · src/islands/ is the client JS ·\n' +
      'src/public/ serves from / · the editor will suggest the AmoJS extension\n',
  );
}

main(process.argv.slice(2)).catch((err: unknown) => {
  fail(`create-amojs: ${err instanceof Error ? err.message : String(err)}`);
});
