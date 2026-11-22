// Service worker registration with an "update available" prompt, and the
// install prompt (Chrome/Edge/Android only; iOS has no install API).

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

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const url = `${import.meta.env.BASE_URL}sw.js`;
  navigator.serviceWorker
    .register(url)
    .then((reg) => {
      const promptUpdate = (worker) =>
        toast('Nuova versione disponibile', {
          timeout: 0,
          action: { label: 'Aggiorna', run: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
        });
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w);
        });
      });
      // Check for updates when the app comes back to the foreground
      document.addEventListener(
        'visibilitychange',
        () => document.visibilityState === 'visible' && reg.update().catch(() => {}),
      );
    })
    .catch((e) => console.warn('Service worker registration failed', e));

  // Reload only when a *new version* takes over. On the very first visit
  // clients.claim() also fires controllerchange: reloading then would
  // interrupt whatever the user is doing.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}
