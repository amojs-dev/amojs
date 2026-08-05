import { test, expect } from 'vitest';
import { compileModule } from '../src/codegen.js';

const COUNTER = [
  "import { signal, computed, html } from '@amojs/core';",
  'export function Counter() {',
  '  const count = signal(0);',
  '  const double = computed(() => count.value * 2);',
  '  return html`<button class="btn" onclick=${() => count.value++}>c:${count}|${double}</button>`;',
  '}',
].join('\n');

test('a module without amo templates passes through untouched', () => {
  const src = "export const n = 1;\nconst t = css`a { color: red }`;";
  expect(compileModule(src)).toBe(src);
});

test('compiles the counter: hoisted template, walks, bindings — no html`` left', () => {
  const out = compileModule(COUNTER);
  expect(out).not.toContain('html`');
  expect(out).toContain('from "@amojs/core/compiled"');
  expect(out).toContain('c:<!---->|<!----></button>'); // static html + hole markers
  expect(out).toContain('[[0,1],[0,3]]'); // placeholder paths
  expect(out).toContain('.addEventListener("click", () => count.value++)');
  expect(out).toContain('_$child(');
  // helper import + hoisted template land AFTER the original imports
  expect(out.indexOf('@amojs/core/compiled')).toBeGreaterThan(out.indexOf("'@amojs/core'"));
});

test('unwrap decision is static: single-root template roots the walks at the element', () => {
  const out = compileModule(COUNTER);
  expect(out).toContain('const _r = _t0().firstChild;');
  expect(out).toContain('return _r;');
  expect(out).not.toContain('return _f;');
});

test('nested templates compile innermost-first, offsets stay correct', () => {
  const src = [
    "import { html } from '@amojs/core';",
    'export function Wrap() {',
    '  return html`<div>[${html`<em>in</em>`}]</div>`;',
    '}',
  ].join('\n');
  const out = compileModule(src);
  expect(out).not.toContain('html`');
  expect(out).toContain('_t0');
  expect(out).toContain('_t1');
  expect(out).toContain('<em>in</em>');
});

test('only used helpers are imported', () => {
  const src = [
    "import { html } from '@amojs/core';",
    'export const el = html`<p>static</p>`;',
  ].join('\n');
  const out = compileModule(src);
  expect(out).toContain('tpl as _$t');
  expect(out).not.toContain('_$child');
  expect(out).not.toContain('_$attr');
});
