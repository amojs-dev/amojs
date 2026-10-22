/**
 * The afterEach convention: '@amojs.dev/test' registers cleanup with a
 * global afterEach once; '@amojs.dev/test/pure' never does.
 */
import { test, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('importing the main entry registers cleanup with a global afterEach exactly once', async () => {
  const hook = vi.fn();
  vi.stubGlobal('afterEach', hook);
  vi.resetModules();

  const first = await import('../src/index.js');
  const second = await import('../src/index.js');
  expect(second).toBe(first);
  expect(hook).toHaveBeenCalledTimes(1);
  expect(hook).toHaveBeenCalledWith(first.cleanup);
});

test('the pure entry registers nothing, and the main entry still registers once after it', async () => {
  const hook = vi.fn();
  vi.stubGlobal('afterEach', hook);
  vi.resetModules();

  const pure = await import('../src/pure.js');
  expect(hook).not.toHaveBeenCalled();

  const main = await import('../src/index.js');
  expect(hook).toHaveBeenCalledTimes(1);
  expect(main.cleanup).toBe(pure.cleanup); // one registry, whichever entry you import
});

test('without a global afterEach, importing registers nothing and does not throw', async () => {
  vi.stubGlobal('afterEach', undefined);
  vi.resetModules();
  const mod = await import('../src/index.js');
  expect(Object.keys(mod).sort()).toEqual(['cleanup', 'flush', 'render', 'tick']);
});
