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
        JavaScript. When a piece of a page needs to react in the browser,
        put a module in src/islands/ and give it a container element here;
        the build picks the folder up on its own.
      </p>
    </main>
  </body>
</html>`;
