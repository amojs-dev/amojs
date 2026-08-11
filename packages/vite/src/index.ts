/**
 * The AmoJS Vite plugin — one `transform` hook, nothing else.
 *
 * Everything a bundler is for (tree-shaking, code-splitting, minification,
 * hashing, a dev server) stays Vite's job; this only turns html`` templates
 * into the compiled form on the way past. That division is deliberate: a
 * bundler of our own would be a worse rollup, and the compiler must stay a
 * local source-to-source rewrite.
 *
 * NO `enforce`, on purpose. Vite's own esbuild transform strips TypeScript
 * before user plugins in the normal phase run, so by our turn a `.ts` file is
 * already JavaScript — which is what the compiler's acorn parser needs. Setting
 * `enforce: 'pre'` would hand us raw TS and fail on the first type annotation.
 */

import type { Plugin } from 'vite';
import { compileModule } from '@amojs.dev/compiler';

export interface AmoPluginOptions {
  /**
   * Compile target. `'server'` emits string concatenation for rendering on
   * node — use it in a separate SSR build, never for browser output.
   * @default 'dom'
   */
  target?: 'dom' | 'server';
  /**
   * Which module ids to compile. Files without an `@amojs.dev/core` import pass
   * through untouched regardless, so this is a cost filter, not a correctness one.
   * @default /\.(?:m?js|ts)$/
   */
  include?: RegExp;
  /**
   * Skip ids containing `/node_modules/`. Dependencies ship compiled already.
   * @default true
   */
  skipNodeModules?: boolean;
}

export default function amo(options: AmoPluginOptions = {}): Plugin {
  const include = options.include ?? /\.(?:m?js|ts)$/;
  const target = options.target ?? 'dom';
  const skipNodeModules = options.skipNodeModules ?? true;

  return {
    name: 'amojs',

    transform(code, id) {
      if (skipNodeModules && id.includes('/node_modules/')) return null;
      const file = id.split('?')[0]; // drop Vite's query suffixes (?worker, ?raw)
      if (!include.test(file)) return null;

      let out: string;
      try {
        out = compileModule(code, { target });
      } catch (err) {
        // name the file: a template error's own message points at the template
        throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
      // no sourcemap: the compiler is a source-to-source rewrite without one
      // yet, and a wrong map is worse than none
      return out === code ? null : { code: out, map: null };
    },
  };
}
