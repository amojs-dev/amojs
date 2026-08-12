import { html } from '@amojs.dev/core';

export default () => html`<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>my amo app</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles/site.css" />
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
