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
        JavaScript of its own. The counter below is an island: the only script
        on the page.
      </p>
      <div id="counter"></div>
      <script type="module" src="/islands/counter.js"></script>
    </main>
  </body>
</html>`;
