import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: the build works from any sub-path (e.g. GitHub Pages /repo/).
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    // Loads its .wasm via `new URL(..., import.meta.url)`; pre-bundling breaks that.
    exclude: ['@jsquash/webp', '@jsquash/webp/encode.js'],
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
