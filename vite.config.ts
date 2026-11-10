import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Pages: the map (index.html), the heritage print designer (print.html), the customer's order
// page (order.html) and the shop's operations page (ops.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        print: fileURLToPath(new URL('./print.html', import.meta.url)),
        order: fileURLToPath(new URL('./order.html', import.meta.url)),
        ops: fileURLToPath(new URL('./ops.html', import.meta.url)),
      },
    },
  },
});
