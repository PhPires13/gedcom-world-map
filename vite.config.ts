import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Pages: the sales landing page (index.html), the map app (app.html; app.html#tree opens the
// family tree), the heritage print designer (print.html), the customer's order page (order.html)
// and the shop's operations page (ops.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        landing: fileURLToPath(new URL('./index.html', import.meta.url)),
        main: fileURLToPath(new URL('./app.html', import.meta.url)),
        print: fileURLToPath(new URL('./print.html', import.meta.url)),
        order: fileURLToPath(new URL('./order.html', import.meta.url)),
        ops: fileURLToPath(new URL('./ops.html', import.meta.url)),
      },
    },
  },
});
