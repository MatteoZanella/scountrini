// Service worker registration with an "update available" prompt, and the
// install prompt (Chrome/Edge/Android only; iOS has no install API).

import { registerSW } from 'virtual:pwa-register';
import { isAndroid, isFirefox, isFirefoxAndroid, isIOS } from './core/device.js';
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

/**
 * Where to install from by hand, when there is no install prompt; null where
 * the browser can't install apps (Firefox on macOS/Linux).
 * Sources: Mozilla and Chrome help pages, Safari 26 (Share is in the ⋯ menu).
 */
export function installHint() {
  if (isIOS()) return 'Safari: Condividi (anche dal menu ⋯) → “Aggiungi alla schermata Home”';
  if (isFirefoxAndroid()) return 'Menu ⋮ → “Installa”';
  if (isAndroid()) return 'Menu ⋮ → “Aggiungi a schermata Home” → “Installa”';
  if (isFirefox()) {
    // Firefox 143+ on Windows only
    return /Windows/.test(navigator.userAgent)
      ? 'Icona “app web” nella barra degli indirizzi → “Aggiungi alla barra delle applicazioni”'
      : null;
  }
  return 'Icona di installazione nella barra degli indirizzi';
}

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
