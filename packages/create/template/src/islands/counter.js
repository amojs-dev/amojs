import { signal, html, mount } from '@amojs.dev/core';

const n = signal(0);

const Counter = () =>
  html`<button class="counter" onclick=${() => n.value++}>count: ${n}</button>`;

mount(Counter, document.getElementById('counter'));
