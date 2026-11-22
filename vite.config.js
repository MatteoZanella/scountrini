import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { minimal2023Preset } from '@vite-pwa/assets-generator/config';

const BRAND = '#462678';
// Installed apps paint the system navigation bar with this fixed colour:
// the dark tab-bar colour blends in with either theme.
const SHELL = '#1d1927';

// Loaded at runtime by URL (a <script> tag or a Web Worker), not imported:
// served as plain files from our origin, so the service worker caches them.
const VENDOR = [
  ['node_modules/@techstark/opencv-js/dist/opencv.js', 'vendor'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'vendor/tesseract'],
  // Only the LSTM cores are needed (OEM 1); the SIMD one is picked when supported
  ['node_modules/tesseract.js-core/tesseract-core{,-simd}-lstm.wasm.js', 'vendor/tesseract/core'],
  ['node_modules/@tesseract.js-data/ita/4.0.0_best_int/ita.traineddata.gz', 'vendor/tesseract/lang'],
];

export default defineConfig({
  // Relative base: the build works from any sub-path (e.g. GitHub Pages /repo/).
  base: './',
  plugins: [
    viteStaticCopy({
      targets: VENDOR.map(([src, dest]) => ({ src, dest, rename: { stripBase: true } })),
    }),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.js',
      // Registered by src/pwa.js (virtual:pwa-register), with the app's own update prompt
      injectRegister: false,
      // Icons, favicon and their <link>s, generated from public/icon.svg
      pwaAssets: {
        image: 'public/icon.svg',
        preset: {
          ...minimal2023Preset,
          maskable: { sizes: [512], padding: 0.12, resizeOptions: { background: BRAND } },
          apple: { sizes: [180], padding: 0, resizeOptions: { background: BRAND } },
        },
        // index.html has its own theme-color metas, one per colour scheme
        injectThemeColor: false,
      },
      manifest: {
        name: 'Scountrini',
        short_name: 'Scountrini',
        description: 'Fotografa gli scontrini e archiviali su OneDrive per anno associativo e branca.',
        lang: 'it',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: SHELL,
        theme_color: SHELL,
      },
      injectManifest: {
        // Everything the app needs offline, except the Tesseract cores (large,
        // and each device needs only one): those are cached at first use.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,gz,wasm}'],
        globIgnores: ['**/vendor/tesseract/core/**'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
    }),
  ],
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
