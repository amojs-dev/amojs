import { html } from '@amojs.dev/core';
import { head } from '../lib/head.js';

export default () => html`<html lang="en">
  <head>
    ${head()}
    <title>my amo app</title>
  </head>
  <body>
    <main>
      <h1>It runs.</h1>
      <p>
        This page was rendered to static HTML at build time — it ships zero
        JavaScript. When a piece of a page needs to react in the browser,
        put a module in src/islands/ and give it a container element here;
        the build picks the folder up on its own.
      </p>
    </main>
  </body>
</html>`;
