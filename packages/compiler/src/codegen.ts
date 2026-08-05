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
import { detectTemplates, walk } from './detect.js';
import type { AnyNode } from './detect.js';
import { parseTemplate } from './template.js';
import type { TemplateIR } from './ir.js';

export function compileModule(source: string): string {
  const templates = detectTemplates(source);
  if (templates.length === 0) return source;

  // insertion point for the helper import + hoisted templates:
  // right after the last original import statement
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  let importEnd = 0;
  let coreImport: AnyNode | null = null;
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    importEnd = node.end;
    const decl = node as unknown as AnyNode;
    if (
      decl.source.value === '@amojs/core' &&
      decl.specifiers.some(
        (s: AnyNode) =>
          s.type === 'ImportSpecifier' &&
          s.imported.type === 'Identifier' &&
          s.imported.name === 'html',
      )
    ) {
      coreImport = decl;
    }
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

  // strip `html` from the core import when nothing references it anymore —
  // a compiled module must not pull the template parser in raw-ESM setups
  if (coreImport) {
    const htmlSpecs: AnyNode[] = coreImport.specifiers.filter(
      (s: AnyNode) =>
        s.type === 'ImportSpecifier' &&
        s.imported.type === 'Identifier' &&
        s.imported.name === 'html',
    );
    const exclude = new Set<number>();
    for (const s of htmlSpecs) {
      exclude.add(s.local.start);
      exclude.add(s.imported.start);
    }
    for (const { t } of ordered) exclude.add(t.start); // the tags we replaced
    const locals = new Set(htmlSpecs.map((s) => s.local.name as string));
    const stillUsed = new Set<string>();
    walk(ast as unknown as AnyNode, (n) => {
      if (n.type === 'Identifier' && locals.has(n.name) && !exclude.has(n.start)) {
        stillUsed.add(n.name);
      }
    });
    const removable = htmlSpecs.filter((s) => !stillUsed.has(s.local.name));
    const allNamed = coreImport.specifiers.every(
      (s: AnyNode) => s.type === 'ImportSpecifier',
    );
    if (removable.length > 0 && allNamed) {
      const keep: AnyNode[] = coreImport.specifiers.filter(
        (s: AnyNode) => !removable.includes(s),
      );
      const text = keep.length
        ? `import { ${keep
            .map((s) =>
              s.imported.name === s.local.name
                ? s.local.name
                : `${s.imported.name} as ${s.local.name}`,
            )
            .join(', ')} } from '@amojs/core';`
        : '';
      const ms = map(coreImport.start);
      const me = map(coreImport.end);
      src = src.slice(0, ms) + text + src.slice(me);
      edits.push({ origEnd: coreImport.end, delta: text.length - (me - ms) });
    }
  }

  const names = ['tpl as _$t'];
  if (usesChild) names.push('bindChild as _$child');
  if (usesAttr) names.push('bindAttr as _$attr');
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

/** `.firstChild` for index 0, `.childNodes[i]` otherwise — like a human. */
function accessor(indexes: number[]): string {
  return indexes
    .map((i) => (i === 0 ? '.firstChild' : `.childNodes[${i}]`))
    .join('');
}

function generate(ir: TemplateIR, exprs: string[], id: number): Generated {
  const tplVar = `_t${id}`;
  const placeholderPaths = ir.holes
    .filter((h) => h.kind === 'child')
    .map((h) => h.path);
  const hoisted = `const ${tplVar} = _$t(${JSON.stringify(ir.html)}, ${JSON.stringify(placeholderPaths)});`;

  // static unwrap decision — mirrors the runtime's unwrap() exactly.
  // when the single root element is all we ever hand out, skip the fragment
  // variable entirely and root the walks at the element itself.
  const rootChildHole = ir.holes.some((h) => h.kind === 'child' && h.path.length === 1);
  const unwrapIdx =
    ir.singleRootIndex !== null && !rootChildHole ? ir.singleRootIndex : null;

  const lines: string[] = [];
  const vars = new Map<string, string>();
  let n = 0;
  if (unwrapIdx !== null) {
    vars.set(String(unwrapIdx), '_r');
    lines.push(`const _r = ${tplVar}()${accessor([unwrapIdx])};`);
  } else {
    lines.push(`const _f = ${tplVar}();`);
  }

  const varFor = (path: number[]): string => {
    if (path.length === 0) return '_f';
    const key = path.join(',');
    let v = vars.get(key);
    if (!v) {
      // walk from the nearest already-resolved ancestor, like a human would
      let baseLen = path.length - 1;
      while (baseLen > 0 && !vars.has(path.slice(0, baseLen).join(','))) baseLen--;
      const base = baseLen === 0 ? '_f' : vars.get(path.slice(0, baseLen).join(','));
      v = `_n${n++}`;
      vars.set(key, v);
      lines.push(`const ${v} = ${base}${accessor(path.slice(baseLen))};`);
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
      lines.push(`_$attr(${v}, ${JSON.stringify(h.name)}, ${e});`);
    } else {
      usesChild = true;
      lines.push(`_$child(${v}, ${e});`);
    }
  }

  lines.push(`return ${unwrapIdx !== null ? '_r' : '_f'};`);

  const expr = `(() => {\n  ${lines.join('\n  ')}\n})()`;
  return { hoisted, expr, usesChild, usesAttr };
}
