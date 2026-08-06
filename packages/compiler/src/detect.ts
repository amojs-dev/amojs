/**
 * Detection — find the `html` tagged templates the compiler owns.
 *
 * LOCKED RULE #8: target files are identified by the import statement,
 * never by filename. Only tags whose identifier is bound by
 * `import { html [as X] } from 'amojs'` are ours; any other `html`
 * (lit-html, a local helper, …) is left untouched.
 *
 * Known v0.2 limitation (documented, acceptable): local shadowing of the
 * imported name inside inner scopes is not tracked yet.
 */

import { parse } from 'acorn';

export interface DetectedTemplate {
  /** the local identifier used as the tag (usually "html") */
  tag: string;
  /** source offsets of the whole tagged template expression */
  start: number;
  end: number;
  /** the static string parts — what the runtime sees as strings[] */
  strings: string[];
  /** source offsets of each `${…}` expression, in order */
  expressions: { start: number; end: number }[];
}

/**
 * Parse a JS module and return every `html\`…\`` owned by amojs.
 * Returns [] fast when the module doesn't import from 'amojs'.
 */
export function detectTemplates(source: string): DetectedTemplate[] {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });

  const htmlNames = new Set<string>();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.source.value !== 'amojs') continue;
    for (const spec of node.specifiers) {
      if (
        spec.type === 'ImportSpecifier' &&
        spec.imported.type === 'Identifier' &&
        spec.imported.name === 'html'
      ) {
        htmlNames.add(spec.local.name);
      }
    }
  }
  if (htmlNames.size === 0) return [];

  const found: DetectedTemplate[] = [];
  walk(ast, (node) => {
    if (node.type !== 'TaggedTemplateExpression') return;
    const tag = node.tag as { type: string; name?: string };
    if (tag.type !== 'Identifier' || !htmlNames.has(tag.name ?? '')) return;
    const quasi = node.quasi as {
      quasis: { value: { cooked?: string; raw: string } }[];
      expressions: { start: number; end: number }[];
    };
    found.push({
      tag: tag.name ?? '',
      start: node.start,
      end: node.end,
      strings: quasi.quasis.map((q) => q.value.cooked ?? q.value.raw),
      expressions: quasi.expressions.map((e) => ({ start: e.start, end: e.end })),
    });
  });
  return found;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyNode = { type: string; start: number; end: number } & Record<string, any>;

/**
 * Minimal depth-first AST walker. acorn nodes are plain objects whose
 * children are either nodes (have a string `type`) or arrays of nodes —
 * ~20 lines instead of a dependency. (Shared with codegen.)
 */
export function walk(node: AnyNode, visit: (n: AnyNode) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'type') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && typeof item.type === 'string') {
          walk(item, visit);
        }
      }
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}
