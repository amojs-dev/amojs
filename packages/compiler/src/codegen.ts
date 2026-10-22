/**
 * Codegen — TemplateIR → the vanilla JS you would have written.
 *
 * `compileModule(source)` replaces every `html\`…\`` owned by amojs
 * with generated code: a hoisted cached template + positional childNodes
 * walks + one binding per hole. In the browser, compiled output does no
 * template parsing at all — that removed work is the whole point.
 *
 * Generated code imports its helpers from '@amojs.dev/core/compiled'
 * (never the template parser). The hole-rule dispatch (constant | signal |
 * function) stays at runtime inside bindChild/bindAttr — the same functions
 * raw mode uses, so identical behavior holds by construction.
 *
 * Nested templates (an html`` inside a hole) are compiled innermost-first;
 * an offset map keeps outer expression slices correct after inner rewrites.
 */

import { parse } from 'acorn';
import MagicString from 'magic-string';
import type { SourceMap } from 'magic-string';
import { detectTemplates, walk } from './detect.js';
import type { AnyNode } from './detect.js';
import { parseTemplate, TemplateError } from './template.js';
import type { TemplateIR } from './ir.js';
import { generateServer, SSR_PREAMBLE } from './codegen-ssr.js';

/** the two template tags core exports — both pull the parser in */
const PARSER_TAGS = new Set(['html', 'svg']);

export interface CompileOptions {
  /**
   * 'dom' (default) — the browser backend: hoisted templates + positional
   * walks + one binding per hole.
   * 'server' — the SSR/SSG backend: the same templates become string
   * concatenation (static HTML, no markers — islands, never hydration).
   * Server output runs on node; it is a build intermediate, not shipped code.
   */
  target?: 'dom' | 'server';
  /**
   * The source map's `sources[0]` — the module's file name as the consumer
   * wants it spelled (usually relative to where the map will sit).
   * @default 'module.js'
   */
  filename?: string;
  /**
   * The text embedded as `sourcesContent`. Pass the original `.ts` when
   * `source` is its type-stripped twin: node's strip mode keeps every
   * position, so the map stays exact and DevTools shows the file the user
   * actually wrote.
   * @default source
   */
  sourcesContent?: string;
}

export interface CompileResult {
  code: string;
  /** a v3 source map; null when the module owned no template and came back untouched */
  map: SourceMap | null;
}

/** source in, compiled source out — the compiler as a string function */
export function compileModule(source: string, opts: CompileOptions = {}): string {
  return compile(source, opts).code;
}

/**
 * `compileModule` with a source map. Every rewrite is an overwrite of the
 * original range, so untouched code maps exactly and a compiled template maps
 * to the `html` tag it replaced: coarse inside the generated block, exact
 * everywhere else, never wrong.
 */
export function compile(source: string, opts: CompileOptions = {}): CompileResult {
  const target = opts.target ?? 'dom';
  const templates = detectTemplates(source);
  if (templates.length === 0) return { code: source, map: null };

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
      decl.source.value === '@amojs.dev/core' &&
      decl.specifiers.some(
        (s: AnyNode) =>
          s.type === 'ImportSpecifier' &&
          s.imported.type === 'Identifier' &&
          PARSER_TAGS.has(s.imported.name),
      )
    ) {
      coreImport = decl;
    }
  }

  const s = new MagicString(source);
  const hoisted: string[] = [];
  let usesChild = false;
  let usesAttr = false;
  let usesEvent = false;

  // innermost/last-in-file first, so outer templates see compiled inners
  const ordered = templates
    .map((t, id) => ({ t, id }))
    .sort((a, b) => b.t.start - a.t.start);

  for (const { t, id } of ordered) {
    const ir = parseTemplate(t.strings, { svg: t.svg });
    // the CURRENT text of each hole — an inner template compiled a moment ago is already in it
    const exprs = t.expressions.map((e) => s.slice(e.start, e.end));
    let expr: string;
    if (target === 'server') {
      expr = generateServer(ir, exprs, t.strings);
    } else {
      const content = ir.holes.find((h) => h.kind === 'content');
      if (content) {
        throw new TemplateError(
          `a hole inside <${content.tag}> renders on the server only — on the client set document.title`,
          content.expr,
          t.strings[content.expr].length,
        );
      }
      const g = generate(ir, exprs, id, t.svg);
      hoisted[id] = g.hoisted;
      usesChild ||= g.usesChild;
      usesAttr ||= g.usesAttr;
      usesEvent ||= g.usesEvent;
      expr = g.expr;
    }
    s.overwrite(t.start, t.end, expr);
  }

  // strip `html` from the core import when nothing references it anymore —
  // a compiled module must not pull the template parser in raw-ESM setups
  if (coreImport) {
    const htmlSpecs: AnyNode[] = coreImport.specifiers.filter(
      (s: AnyNode) =>
        s.type === 'ImportSpecifier' &&
        s.imported.type === 'Identifier' &&
        PARSER_TAGS.has(s.imported.name),
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
      // parser-free import → the '/runtime' entry: raw ESM has no
      // tree-shaking, and the package root statically pulls html.js in
      const keepsHtml = keep.some((s: AnyNode) => PARSER_TAGS.has(s.imported.name));
      const from = keepsHtml ? '@amojs.dev/core' : '@amojs.dev/core/runtime';
      const text = keep.length
        ? `import { ${keep
            .map((s) =>
              s.imported.name === s.local.name
                ? s.local.name
                : `${s.imported.name} as ${s.local.name}`,
            )
            .join(', ')} } from '${from}';`
        : '';
      if (text) s.overwrite(coreImport.start, coreImport.end, text);
      else s.remove(coreImport.start, coreImport.end);
    }
  }

  // retarget every OTHER parser-free '@amojs.dev/core' import / re-export to
  // '@amojs.dev/core/runtime' as well (e.g. `export { flushSync } from …`) —
  // one html-free specifier list means the module never needs the parser
  const RUNTIME_SPEC = `'@amojs.dev/core/runtime'`;
  for (const node of ast.body) {
    const decl = node as unknown as AnyNode;
    if (decl === coreImport) continue; // handled (or deliberately kept) above
    let touchesHtml: boolean;
    if (node.type === 'ImportDeclaration' && decl.source.value === '@amojs.dev/core') {
      touchesHtml = decl.specifiers.some(
        (s: AnyNode) => s.type !== 'ImportSpecifier' || PARSER_TAGS.has(s.imported.name),
      );
    } else if (
      node.type === 'ExportNamedDeclaration' &&
      decl.source &&
      decl.source.value === '@amojs.dev/core'
    ) {
      touchesHtml = decl.specifiers.some((s: AnyNode) => PARSER_TAGS.has(s.local.name));
    } else {
      continue; // `export * from` would re-export html — left untouched
    }
    if (touchesHtml) continue;
    s.overwrite(decl.source.start, decl.source.end, RUNTIME_SPEC);
  }

  let header: string;
  if (target === 'server') {
    // isSignal is the one runtime fact the string backend needs, and core
    // runs on node by design (LOCKED RULE #5 — no DOM at module top level)
    header =
      `\nimport { isSignal as _$is } from "@amojs.dev/core/runtime";\n` +
      SSR_PREAMBLE +
      '\n';
  } else {
    const names = ['tpl as _$t'];
    if (usesChild) names.push('bindChild as _$child');
    if (usesAttr) names.push('bindAttr as _$attr');
    if (usesEvent) names.push('bindEvent as _$event');
    header =
      `\nimport { ${names.join(', ')} } from "@amojs.dev/core/compiled";\n` +
      hoisted.join('\n') +
      '\n';
  }
  s.appendLeft(importEnd, header);

  const map = s.generateMap({
    source: opts.filename ?? 'module.js',
    includeContent: true,
    hires: 'boundary',
  });
  if (opts.sourcesContent !== undefined) map.sourcesContent = [opts.sourcesContent];
  return { code: s.toString(), map };
}

interface Generated {
  /** module-level cached template declaration */
  hoisted: string;
  /** the expression that replaces the html`` call */
  expr: string;
  usesChild: boolean;
  usesAttr: boolean;
  usesEvent: boolean;
}

/** `.firstChild` for index 0, `.childNodes[i]` otherwise — like a human. */
function accessor(indexes: number[]): string {
  return indexes
    .map((i) => (i === 0 ? '.firstChild' : `.childNodes[${i}]`))
    .join('');
}

function generate(ir: TemplateIR, exprs: string[], id: number, svg: boolean): Generated {
  const tplVar = `_t${id}`;
  const placeholderPaths = ir.holes
    .filter((h) => h.kind === 'child')
    .map((h) => h.path);
  const hoisted = `const ${tplVar} = _$t(${JSON.stringify(ir.html)}, ${JSON.stringify(placeholderPaths)}${svg ? ', 1' : ''});`;

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

  // children first: an element's live properties must be set AFTER its
  // children exist (`<select value=${x}>` cannot select an <option> that is
  // not there yet), which is also the order a human writes. Stable sort, so
  // document order survives within each group.
  const ordered = [...ir.holes].sort(
    (a, b) => (a.kind === 'child' ? 0 : 1) - (b.kind === 'child' ? 0 : 1),
  );

  let usesChild = false;
  let usesAttr = false;
  let usesEvent = false;
  for (const h of ordered) {
    const v = varFor(h.path);
    const e = exprs[h.expr];
    if (h.kind === 'event') {
      // via the runtime helper, not a bare addEventListener: a non-function
      // listener must fail the same way in both modes (LOCKED RULE #3)
      usesEvent = true;
      lines.push(`_$event(${v}, ${JSON.stringify(h.name)}, ${e});`);
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
  return { hoisted, expr, usesChild, usesAttr, usesEvent };
}
