/**
 * @amojs/compiler — public surface.
 *
 * Pipeline (v0.2):
 *   detect (acorn)  →  template parse  →  TemplateIR  →  codegen
 *   step 1 ✓            step 2 ✓            contract ✓     step 3 ✓
 *
 * Entry point: compileModule(source) — source in, compiled source out.
 */

export * from './ir.js';
export * from './detect.js';
export * from './template.js';
export * from './codegen.js';
export * from './build.js';
export * from './eject.js';
