// Protected storage (navigator.storage.persist): the browser won't clear the
// receipts waiting to upload when the device runs low on space.
// Chromium and Safari decide silently (mostly for installed apps). Firefox
// shows its own prompt, only after a tap: closing it without answering lets
// the app ask again, a refusal is remembered and must be changed in the
// site's permissions.

import { isFirefox, isFirefoxAndroid } from '../core/device.js';
import { settings } from '../core/settings.js';
import { requestPersistence } from '../storage/db.js';
import { confirmDialog, h, openDialog, toast } from './dom.js';

export const canPersist = () => Boolean(navigator.storage?.persist);

/** 'granted', 'denied', 'prompt', or 'unknown' where the browser can't tell. */
export async function persistenceState() {
  try {
    return (await navigator.permissions.query({ name: 'persistent-storage' })).state;
  } catch {
    return 'unknown';
  }
}

/**
 * Protected now. persisted() alone isn't enough: Firefox keeps answering true
 * after the permission is removed or blocked (bug 1558478), so the permission
 * must still be granted too (Safari can't tell: trust persisted()).
 */
export async function isProtected() {
  try {
    if (!(await navigator.storage.persisted())) return false;
  } catch {
    return false;
  }
  const state = await persistenceState();
  return state === 'granted' || state === 'unknown';
}

/** True where the browser can still show its prompt (Firefox, not refused). */
async function canAskUser() {
  return isFirefox() && canPersist() && !(await isProtected()) && (await persistenceState()) !== 'denied';
}

/** Where to allow it once refused (or, outside Firefox, how to earn it). */
export function showPersistenceHelp() {
  const b = (text) => h('b', {}, text);
  const steps = isFirefoxAndroid()
    ? [
        ['Apri il sito in Firefox e tocca lo ', b('scudo'), ' accanto all’indirizzo'],
        ['Alla voce ', b('Archiviazione permanente'), ' scegli ', b('Consentito')],
        ['Ricarica la pagina'],
      ]
    : isFirefox()
      ? [
          ['Clicca l’icona delle ', b('impostazioni'), ' accanto all’indirizzo'],
          ['Alla voce ', b('Salvare dati nell’archivio permanente'), ' scegli ', b('Consentito')],
        ]
      : [['Installa l’app e aprila dall’icona'], ['Tocca di nuovo ', b('Proteggi')]];
  const body = h('ol.persistence-steps', {}, ...steps.map((parts) => h('li', {}, h('span', {}, ...parts))));
  return openDialog({ title: 'Consenti l’archivio protetto', body, ok: 'Ok', cancel: null });
}

/**
 * Asks the browser (call it from a tap) and handles the answer: closed without
 * answering → can retry; refused → where to change it.
 */
export async function protectStorage() {
  const started = performance.now();
  if ((await requestPersistence()) && (await isProtected())) {
    toast('Archivio protetto', { type: 'success' });
    return true;
  }
  // A remembered refusal answers at once, without showing anything
  const refused = (await persistenceState()) === 'denied' || performance.now() - started < 400;
  if (isFirefox() && !refused) toast('Richiesta chiusa: puoi riprovare quando vuoi');
  else await showPersistenceHelp();
  return false;
}

/** First visit to "Nuovo" (Firefox): explain why, then the browser's prompt. */
export async function offerStorageProtection() {
  if (settings.get('storageOffered') || !(await canAskUser())) return;
  settings.set('storageOffered', true);
  const ok = await confirmDialog({
    title: 'Consenti l’ archiviazione',
    body: 'Con l’archiviazione attiva, gli scontrini sono protetti finché non sono caricati.',
    ok: 'Abilita',
    cancel: 'Non ora',
  });
  if (ok) await protectStorage();
}

/** Saving a receipt (a tap): if the prompt was only closed, show it again. */
export async function askAgainOnSave() {
  if (await canAskUser()) requestPersistence();
}
