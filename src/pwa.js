// Service worker registration with an "update available" prompt, and the
// install prompt (Chrome/Edge/Android only; iOS has no install API).

import { registerSW } from 'virtual:pwa-register';
import { toast } from './ui/dom.js';

let deferredInstall = null;
/** Fires "change" when installing becomes (un)available. */
export const installEvents = new EventTarget();
const installChanged = () => installEvents.dispatchEvent(new Event('change'));

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // replace the browser's mini-infobar with our own button
  deferredInstall = e;
  installChanged();
});
addEventListener('appinstalled', () => {
  deferredInstall = null;
  installChanged();
});

export const canPromptInstall = () => Boolean(deferredInstall);

/** Shows the native install dialog. Resolves true if the user accepted. */
export async function promptInstall() {
  const e = deferredInstall;
  if (!e) return false;
  deferredInstall = null; // the event can be used only once
  e.prompt();
  const { outcome } = await e.userChoice;
  installChanged();
  return outcome === 'accepted';
}

/**
 * Registers the service worker (vite-plugin-pwa + workbox-window; a no-op in
 * dev). A new version waits until the user taps "Aggiorna", then the page
 * reloads once it takes over: never on the first visit.
 */
export function registerServiceWorker() {
  const updateSW = registerSW({
    onNeedRefresh: () =>
      toast('Nuova versione disponibile', {
        timeout: 0,
        action: { label: 'Aggiorna', run: () => updateSW(true) },
      }),
    // Check for updates when the app comes back to the foreground
    onRegisteredSW: (_url, reg) =>
      reg &&
      document.addEventListener(
        'visibilitychange',
        () => document.visibilityState === 'visible' && reg.update().catch(() => {}),
      ),
    onRegisterError: (e) => console.warn('Service worker registration failed', e),
  });
}
