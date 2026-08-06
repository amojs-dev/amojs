import { test, expect } from 'vitest';
import { detectTemplates } from '../src/detect.js';

test('detects a basic html`` template with strings and expression offsets', () => {
  const src = [
    `import { html } from 'amojs';`,
    'const el = html`<p>${x} و ${y}</p>`;',
  ].join('\n');
  const found = detectTemplates(src);
  expect(found).toHaveLength(1);
  expect(found[0].tag).toBe('html');
  expect(found[0].strings).toEqual(['<p>', ' و ', '</p>']);
  expect(found[0].expressions).toHaveLength(2);
  const [e1, e2] = found[0].expressions;
  expect(src.slice(e1.start, e1.end)).toBe('x');
  expect(src.slice(e2.start, e2.end)).toBe('y');
});

test('tracks an import alias: import { html as h }', () => {
  const src = [
    `import { html as h } from 'amojs';`,
    'export const a = h`<i>t</i>`;',
  ].join('\n');
  const found = detectTemplates(src);
  expect(found).toHaveLength(1);
  expect(found[0].tag).toBe('h');
});

test('ignores an html tag imported from another package', () => {
  const src = [
    `import { html } from 'lit';`,
    'const el = html`<p>${x}</p>`;',
  ].join('\n');
  expect(detectTemplates(src)).toHaveLength(0);
});

test('ignores a local function named html (no amojs import)', () => {
  const src = ['const html = (s) => s;', 'html`<p>t</p>`;'].join('\n');
  expect(detectTemplates(src)).toHaveLength(0);
});

test('ignores unrelated tagged templates in a file that does import html', () => {
  const src = [
    `import { html } from 'amojs';`,
    'const css = (s) => s;',
    'css`p { color: red }`;',
    'const el = html`<p>t</p>`;',
  ].join('\n');
  const found = detectTemplates(src);
  expect(found).toHaveLength(1);
  expect(found[0].strings).toEqual(['<p>t</p>']);
});

test('finds multiple templates, including one nested inside a hole', () => {
  const src = [
    `import { html } from 'amojs';`,
    'const a = html`<div>${html`<em>in</em>`}</div>`;',
    'const b = html`<span>${x}</span>`;',
  ].join('\n');
  const found = detectTemplates(src);
  expect(found).toHaveLength(3); // outer div + nested em + span
  const allStrings = found.map((f) => f.strings.join('|'));
  expect(allStrings).toContain('<em>in</em>');
});

test('a file with no amojs import returns [] fast', () => {
  expect(detectTemplates('export const n = 1;')).toEqual([]);
});
