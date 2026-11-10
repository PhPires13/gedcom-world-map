import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Two pages: the map (index.html) and the heritage print designer (print.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        print: fileURLToPath(new URL('./print.html', import.meta.url)),
      },
    },
  },
});
