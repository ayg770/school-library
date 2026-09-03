import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * ARCHITECTURE.md AD-2: the UI reaches data only over HTTP. In development it
 * proxies `/api` to the local service so both are same-origin — the same
 * relative URLs then work unchanged when the service serves the built UI
 * itself, with no CORS configuration anywhere.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    // PRODUCT_SPEC.md §2 / ARCHITECTURE.md AD-5: everything is bundled. No
    // asset may be fetched from a CDN at runtime.
    assetsInlineLimit: 0,
  },
});
