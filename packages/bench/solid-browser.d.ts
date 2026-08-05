/**
 * The bench imports solid's BROWSER build directly (the node build's
 * createEffect is deliberately inert) — same API, same types.
 */
declare module 'solid-js/dist/solid.js' {
  export * from 'solid-js';
}
