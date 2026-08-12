/**
 * The dependency ranges written into a scaffolded project. A drift-guard
 * test asserts these match the workspace's real versions, so a release that
 * forgets to update them fails loudly instead of scaffolding stale apps.
 *
 * Its own module (not main.ts) so the test can import it without running
 * the bin.
 */
export const TEMPLATE_DEPS = {
  '@amojs.dev/core': '^0.8.1',
  '@amojs.dev/cli': '^0.11.0',
  typescript: '^7.0.0', // --ts only; verified against the template tsconfig
} as const;
