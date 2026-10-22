/**
 * amo test — public surface: render, cleanup, flush, tick.
 * Importing this entry registers cleanup() with a global afterEach when the
 * runner exposes one; '@amojs.dev/test/pure' is the same API without that.
 */

import { cleanup } from './pure.js';

export { render, cleanup, flush, tick } from './pure.js';

const hook = /** @type {{ afterEach?: unknown }} */ (globalThis).afterEach;
if (typeof hook === 'function') hook(cleanup);
