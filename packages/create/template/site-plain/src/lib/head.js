import { html } from '@amojs.dev/core';

// shared by every page — imported with a `.js` specifier, which also
// resolves the `.ts` twin when the project is TypeScript
export const head = () => html`<meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/styles/site.css" />`;
