/**
 * @amojs/compiler — public surface.
 *
 * Pipeline (v0.2, being built step by step):
 *   detect (acorn)  →  template parse  →  TemplateIR  →  codegen
 *   step 1 ✓            step 2 ✓            contract ✓     step 3
 */

export * from './ir.js';
export * from './detect.js';
export * from './template.js';
