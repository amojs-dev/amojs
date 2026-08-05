/**
 * Codegen — TemplateIR → the vanilla JS you would have written.
 *
 * `compileModule(source)` replaces every `html\`…\`` owned by @amojs/core
 * with generated code: a hoisted cached template + positional childNodes
 * walks + one binding per hole. In the browser, compiled output does no
 * template parsing at all — that removed work is the whole point.
 *
 * Generated code imports its helpers from '@amojs/core/compiled'
 * (never the template parser). The hole-rule dispatch (constant | signal |
 * function) stays at runtime inside bindChild/bindAttr — the same functions
 * raw mode uses, so identical behavior holds by construction.
 *
 * Nested templates (an html`` inside a hole) are compiled innermost-first;
 * an offset map keeps outer expression slices correct after inner rewrites.
 */

import { parse } from 'acorn';
import { detectTemplates } from './detect.js';
import { parseTemplate } from './template.js';
import type { TemplateIR } from './ir.js';

export function compileModule(source: string): string {
  const templates = detectTemplates(source);
  if (templates.length === 0) return source;

  // insertion point for the helper import + hoisted templates:
  // right after the last original import statement
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  let importEnd = 0;
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') importEnd = node.end;
  }

  /** completed rewrites, for mapping original offsets into the edited source */
  const edits: { origEnd: number; delta: number }[] = [];
  const map = (x: number): number =>
    x + edits.reduce((acc, e) => acc + (e.origEnd <= x ? e.delta : 0), 0);

  let src = source;
  const hoisted: string[] = [];
  let usesChild = false;
  let usesAttr = false;

  // innermost/last-in-file first, so outer templates see compiled inners
  const ordered = templates
    .map((t, id) => ({ t, id }))
    .sort((a, b) => b.t.start - a.t.start);

  for (const { t, id } of ordered) {
    const ir = parseTemplate(t.strings);
    const exprs = t.expressions.map((e) => src.slice(map(e.start), map(e.end)));
    const g = generate(ir, exprs, id);
    hoisted[id] = g.hoisted;
    usesChild ||= g.usesChild;
    usesAttr ||= g.usesAttr;

    const ms = map(t.start);
    const me = map(t.end);
    src = src.slice(0, ms) + g.expr + src.slice(me);
    edits.push({ origEnd: t.end, delta: g.expr.length - (me - ms) });
  }

  const names = ['tpl as _amoTpl'];
  if (usesChild) names.push('bindChild as _amoBindChild');
  if (usesAttr) names.push('bindAttr as _amoBindAttr');
  const header =
    `\nimport { ${names.join(', ')} } from "@amojs/core/compiled";\n` +
    hoisted.join('\n') +
    '\n';

  const at = map(importEnd);
  return src.slice(0, at) + header + src.slice(at);
}

interface Generated {
  /** module-level cached template declaration */
  hoisted: string;
  /** the expression that replaces the html`` call */
  expr: string;
  usesChild: boolean;
  usesAttr: boolean;
}

function generate(ir: TemplateIR, exprs: string[], id: number): Generated {
  const tplVar = `_amo_t${id}`;
  const placeholderPaths = ir.holes
    .filter((h) => h.kind === 'child')
    .map((h) => h.path);
  const hoisted = `const ${tplVar} = _amoTpl(${JSON.stringify(ir.html)}, ${JSON.stringify(placeholderPaths)});`;

  const lines: string[] = [`const _f = ${tplVar}();`];
  const vars = new Map<string, string>();
  let n = 0;
  const varFor = (path: number[]): string => {
    if (path.length === 0) return '_f';
    const key = path.join(',');
    let v = vars.get(key);
    if (!v) {
      // walk from the nearest already-resolved ancestor, like a human would
      let baseLen = path.length - 1;
      while (baseLen > 0 && !vars.has(path.slice(0, baseLen).join(','))) baseLen--;
      const base = baseLen === 0 ? '_f' : vars.get(path.slice(0, baseLen).join(','));
      const rest = path
        .slice(baseLen)
        .map((i) => `.childNodes[${i}]`)
        .join('');
      v = `_n${n++}`;
      vars.set(key, v);
      lines.push(`const ${v} = ${base}${rest};`);
    }
    return v;
  };

  // resolve every node before any binding runs (bindings may replace nodes)
  for (const h of ir.holes) varFor(h.path);

  let usesChild = false;
  let usesAttr = false;
  for (const h of ir.holes) {
    const v = varFor(h.path);
    const e = exprs[h.expr];
    if (h.kind === 'event') {
      lines.push(`${v}.addEventListener(${JSON.stringify(h.name)}, ${e});`);
    } else if (h.kind === 'attr') {
      usesAttr = true;
      lines.push(`_amoBindAttr(${v}, ${JSON.stringify(h.name)}, ${e});`);
    } else {
      usesChild = true;
      lines.push(`_amoBindChild(${v}, ${e});`);
    }
  }

  // static unwrap decision — mirrors the runtime's unwrap() exactly
  const rootChildHole = ir.holes.some((h) => h.kind === 'child' && h.path.length === 1);
  let ret = '_f';
  if (ir.singleRootIndex !== null && !rootChildHole) {
    ret =
      vars.get(String(ir.singleRootIndex)) ??
      `_f.childNodes[${ir.singleRootIndex}]`;
  }
  lines.push(`return ${ret};`);

  const expr = `(() => {\n  ${lines.join('\n  ')}\n})()`;
  return { hoisted, expr, usesChild, usesAttr };
}
