/**
 * Source maps — every rewrite is an overwrite of an original range, so
 * untouched code maps exactly and a compiled template maps to the html tag
 * it replaced. Verified by decoding the map, not by trusting its shape.
 */
import { test, expect } from 'vitest';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { compile, compileModule } from '../src/codegen.js';

const SRC = [
  "import { signal, html } from '@amojs.dev/core';",
  '',
  'const count = signal(0);',
  'export function Counter() {',
  '  return html`<button onclick=${() => count.value++}>c:${count}</button>`;',
  '}',
  '',
  'export const answer = 42;',
].join('\n');

/** generated line/column (1-based line, 0-based column) of the first occurrence */
function positionOf(code: string, needle: string) {
  const at = code.indexOf(needle);
  if (at === -1) throw new Error(`not in output: ${needle}`);
  const before = code.slice(0, at);
  return { line: before.split('\n').length, column: at - before.lastIndexOf('\n') - 1 };
}

test('compile() returns what compileModule() returns, plus a v3 map with the source embedded', () => {
  const { code, map } = compile(SRC, { filename: 'counter.js' });
  expect(code).toBe(compileModule(SRC));
  expect(map?.version).toBe(3);
  expect(map?.sources).toEqual(['counter.js']);
  expect(map?.sourcesContent).toEqual([SRC]);
  expect(map?.mappings.length).toBeGreaterThan(0);
});

test('untouched code maps to its own line; generated binding code maps to the html tag it replaced', () => {
  const { code, map } = compile(SRC, { filename: 'counter.js' });
  const tracer = new TraceMap(map!.toString());
  // the statement AFTER the template moved down (helper import + hoisted template above it)
  const answer = originalPositionFor(tracer, positionOf(code, 'export const answer'));
  expect(answer).toMatchObject({ source: 'counter.js', line: 8, column: 0 });
  // a line inside the generated block points at the template's `html` tag
  const binding = originalPositionFor(tracer, positionOf(code, '_$event('));
  expect(binding.line).toBe(5);
  expect(binding.column).toBe(SRC.split('\n')[4].indexOf('html`'));
  // the import that was retargeted still maps to line 1
  const imp = originalPositionFor(tracer, positionOf(code, "from '@amojs.dev/core/runtime'"));
  expect(imp.line).toBe(1);
});

test('the server target maps the same way', () => {
  const { code, map } = compile(SRC, { target: 'server', filename: 'counter.js' });
  const tracer = new TraceMap(map!.toString());
  expect(originalPositionFor(tracer, positionOf(code, 'export const answer')).line).toBe(8);
});

test('a module without templates has no map and comes back untouched', () => {
  const r = compile('export const x = 1;');
  expect(r.map).toBeNull();
  expect(r.code).toBe('export const x = 1;');
});

test('sourcesContent can carry the original text — the .ts before type stripping', () => {
  const ts = SRC.replace('const count = signal(0);', 'const count: Signal<number> = signal(0);');
  const stripped = ts.replace(': Signal<number>', ' '.repeat(': Signal<number>'.length)); // node's strip mode keeps positions
  const { map } = compile(stripped, { filename: 'counter.ts', sourcesContent: ts });
  expect(map?.sourcesContent).toEqual([ts]);
  const tracer = new TraceMap(map!.toString());
  expect(originalPositionFor(tracer, positionOf(compileModule(stripped), 'export const answer')).line).toBe(8);
});
