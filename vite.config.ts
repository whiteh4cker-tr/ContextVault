import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` — Electron loads dist-react/index.html from file://, so asset
// URLs must be relative to the document rather than to a server root.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 8000,
    strictPort: true,
  },
  build: {
    outDir: 'dist-react',
  },
});
