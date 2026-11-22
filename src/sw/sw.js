/* Service worker — bundled into dist/sw.js by vite-plugin-pwa (injectManifest).
 * - App shell + OpenCV + OCR model are precached: the app works offline.
 * - Navigations: network first (fresh deploys), precached shell when offline.
 * - Same-origin assets: precached, or cached at first use (Tesseract cores).
 * - Microsoft login / Graph traffic is never intercepted.
 */
import { cleanupOutdatedCaches, precacheAndRoute, PrecacheFallbackPlugin } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';

// Versioned caches of the previous hand-written service worker
const LEGACY_CACHE = /^scontrini-[0-9a-f]{12}$/;

// Same origin only: Microsoft's sign-in pages are navigations too, and must
// never be answered (offline) with this app's shell. Registered before the
// precache route, so a navigation to ./ goes to the network first.
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && url.origin === self.location.origin,
  new NetworkOnly({
    networkTimeoutSeconds: 4,
    plugins: [new PrecacheFallbackPlugin({ fallbackURL: 'index.html' })],
  }),
);

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(({ url }) => url.origin === self.location.origin, new CacheFirst({ cacheName: 'scontrini-runtime' }));

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (LEGACY_CACHE.test(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
