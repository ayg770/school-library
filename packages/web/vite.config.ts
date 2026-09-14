import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The office side, served from GitHub Pages.
 *
 * `base` is the repository name because Pages serves a project site from a
 * subdirectory. Built with a relative base the page would look for its own
 * assets at the domain root and find nothing.
 */
export default defineConfig({
  plugins: [react()],
  base: process.env.PAGES_BASE ?? '/',
  server: { host: '127.0.0.1', port: 5174 },
  build: { outDir: 'dist' },
});
