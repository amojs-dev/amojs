import { test, expect } from 'vitest';
import { define } from '../src/index.js';

test('imports cleanly on node; define() throws only when called', () => {
  expect(typeof customElements).toBe('undefined');
  expect(() => define('x-counter', () => /** @type {Node} */ ({}))).toThrowError(/^amo: define\(\) needs a browser$/);
});
