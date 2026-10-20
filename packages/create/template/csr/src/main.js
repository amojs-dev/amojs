import { signal, html, mount } from '@amojs.dev/core';

const n = signal(0);

const App = () => html`<div>
  <h1>It runs.</h1>
  <p>
    This page renders in the browser. The build compiles this module to the
    vanilla JS you would have written — the template becomes a cloned node,
    each hole becomes its own targeted update, and the parser ships nowhere.
  </p>
  <button class="counter" onclick=${() => n.value++}>count: ${n}</button>
</div>`;

const app = document.getElementById('app');
if (app) mount(App, app);
