/**
 * amo test — render, cleanup, flush, tick. Registers nothing on import;
 * index.js is this file plus the afterEach convention.
 */

import { root, mount } from '@amojs.dev/core/runtime';

export { flushSync as flush, tick } from '@amojs.dev/core/runtime';

/** @type {Set<() => void>} */
const mounted = new Set();

/**
 * @typedef {object} Rendered
 * @property {Element} container the element the component was mounted into
 * @property {() => void} unmount disposes everything the render created and removes the container
 */

/**
 * Mount a component into a fresh container inside its own disposable scope.
 * @param {(() => Node) | Node} component
 * @param {{ target?: Element }} [options] `target` replaces the default `<div>` appended to `document.body`
 * @returns {Rendered}
 */
export function render(component, options = {}) {
  const container =
    options.target ?? document.body.appendChild(document.createElement('div'));
  let dispose = () => {};
  const unmount = () => {
    if (!mounted.delete(unmount)) return;
    dispose();
    container.remove();
  };
  // registered before the component runs, so a render that throws is still cleaned up
  mounted.add(unmount);
  root((d) => {
    dispose = d;
    // mount(fn) would open a second, detached root that this one cannot dispose
    mount(typeof component === 'function' ? component() : component, container);
  });
  return { container, unmount };
}

/** Unmount everything render() mounted and has not unmounted yet. */
export function cleanup() {
  for (const unmount of mounted) unmount();
}
