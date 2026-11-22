// "Il tuo dispositivo": a checklist of everything this phone needs for
// uploads to work, each item with a one-tap fix or plain instructions.

import { CONFIG } from '../config.js';
import { formatDateTimeIT } from '../core/dates.js';
import { isAndroid, isFirefox, isFirefoxAndroid, isIOS, isStandalone } from '../core/device.js';
import { jobs, requestPersistence } from '../storage/db.js';
import { getAccount, reauthenticate } from '../cloud/auth.js';
import { verifyDestination } from '../cloud/graph.js';
import { destination } from '../cloud/destination.js';
import { describeError, isAccessDenied } from '../cloud/errors.js';
import { showAccessRequest } from './access-request.js';
import { uploadQueue } from '../cloud/upload-queue.js';
import { canPromptInstall, installEvents, promptInstall } from '../pwa.js';
import { h, icon, toast, openDialog } from './dom.js';

const STALE_MS = 2 * 24 * 3600 * 1000;

// Result of the last folder verification, kept for the session
let folderCheck = { state: 'unknown', key: '', detail: '' };
const destKey = (d) => (d ? `${d.driveId}/${d.itemId}` : '');

async function runFolderCheck(dest) {
  folderCheck = { state: 'checking', key: destKey(dest), detail: '' };
  try {
    const { name } = await verifyDestination(dest);
    folderCheck = { state: 'ok', key: destKey(dest), detail: `Puoi caricare in “${name}”` };
  } catch (e) {
    console.warn('Folder check failed', e);
    folderCheck = {
      state: navigator.onLine ? 'fail' : 'unknown',
      key: destKey(dest),
      detail: navigator.onLine ? describeError(e, { account: getAccount()?.username }) : 'Serve la connessione',
      denied: isAccessDenied(e),
    };
  }
}

function accountCheck() {
  const account = getAccount();
  if (!account) return { state: 'todo', title: 'Accesso Microsoft', detail: 'Non hai effettuato l’accesso' };
  if (uploadQueue.authBlocked) {
    return {
      state: 'warn',
      title: 'Accesso Microsoft scaduto',
      detail: 'Gli scontrini restano in coda finché non accedi di nuovo',
      action: { label: 'Accedi', run: () => reauthenticate() },
    };
  }
  return { state: 'ok', title: 'Accesso Microsoft', detail: account.username };
}

function folderItem(dest, rerender) {
  if (!dest) return { state: 'todo', title: 'Cartella OneDrive', detail: 'Nessuna cartella collegata' };
  if (!getAccount()) return { state: 'info', title: 'Cartella OneDrive', detail: 'Accedi per verificarla' };
  const verify = { label: 'Verifica', run: async () => (await runFolderCheck(dest), rerender()) };
  const current = folderCheck.key === destKey(dest) ? folderCheck : { state: 'unknown' };
  switch (current.state) {
    case 'ok':
      return { state: 'ok', title: 'Cartella OneDrive', detail: current.detail };
    case 'fail': {
      const askAccess = current.denied && dest.kind === 'share';
      return {
        state: 'warn',
        title: 'Cartella non accessibile',
        detail: current.detail,
        action: askAccess
          ? { label: 'Chiedi accesso', run: () => showAccessRequest({ shareUrl: dest.shareUrl }) }
          : verify,
      };
    }
    case 'checking':
      return { state: 'busy', title: 'Cartella OneDrive', detail: 'Verifico il permesso di scrittura…' };
    default:
      return {
        state: 'info',
        title: 'Cartella OneDrive',
        detail: current.detail || 'Non ancora verificata',
        action: verify,
      };
  }
}

function installCheck(rerender) {
  if (isStandalone()) return { state: 'ok', title: 'App installata', detail: 'Si apre dalla schermata Home' };
  if (isIOS()) {
    return {
      state: 'warn',
      title: 'Installa l’app',
      detail: `In Safari tocca Condividi → “Aggiungi alla schermata Home”, poi usa l’icona ${CONFIG.appName}. Senza installazione Safari può cancellare gli scontrini in coda dopo 7 giorni.`,
    };
  }
  if (canPromptInstall()) {
    return {
      state: 'warn',
      title: 'Installa l’app',
      detail: 'Si apre a schermo intero e protegge gli scontrini in coda',
      action: {
        label: 'Installa',
        run: async () => {
          await promptInstall();
          rerender();
        },
      },
    };
  }
  return {
    state: 'info',
    title: 'Installa l’app',
    detail: isAndroid() ? 'Menu ⋮ del browser → “Installa”' : 'Dal menu del browser: “Installa app”',
  };
}

/** Firefox for Android works, but Chrome adds the photo picker, one-tap install and protected storage. */
function browserCheck() {
  if (!isFirefoxAndroid() || isStandalone()) return null;
  const url = location.host + location.pathname;
  return {
    state: 'info',
    title: 'Con Chrome va meglio',
    detail: 'Foto da Google Foto, installazione con un tocco, coda protetta',
    action: {
      label: 'Apri in Chrome',
      run: () => (location.href = `intent://${url}#Intent;scheme=https;package=com.android.chrome;end`),
    },
  };
}

/** Permission state where the Permissions API knows it: 'prompt', 'granted' or 'denied'. */
async function persistenceState() {
  try {
    return (await navigator.permissions.query({ name: 'persistent-storage' })).state;
  } catch {
    return 'unknown'; // Safari doesn't expose this permission name
  }
}

/** How to allow it once refused, for the browser in use. */
function persistenceHelp() {
  const steps = isFirefoxAndroid()
    ? ['Apri l’app in Firefox e tocca il lucchetto accanto all’indirizzo', 'Consenti “Archivio persistente”']
    : isFirefox()
      ? ['Clicca il lucchetto accanto all’indirizzo → Permessi', 'Consenti “Archiviare dati in modo persistente”']
      : ['Installa l’app e aprila dall’icona', 'Tocca di nuovo “Proteggi”'];
  return h(
    'div',
    {},
    h('ol.persistence-steps', {}, ...steps.map((s) => h('li', {}, s))),
    h('p.muted', {}, 'Intanto la coda funziona: rischia solo se il telefono resta senza spazio.'),
  );
}

async function storageCheck(rerender) {
  if (!navigator.storage?.persisted) return null;
  if (await navigator.storage.persisted()) {
    return { state: 'ok', title: 'Archivio protetto', detail: 'Il browser non cancella gli scontrini in coda' };
  }
  const denied = (await persistenceState()) === 'denied';
  return {
    state: denied ? 'warn' : 'info',
    title: 'Archivio non protetto',
    detail: 'Con poco spazio il browser potrebbe cancellare gli scontrini in coda',
    action: {
      // Once refused, asking again fails silently: say where to allow it
      label: denied ? 'Come fare' : 'Proteggi',
      run: async () => {
        if (!denied && (await requestPersistence())) {
          toast('Archivio protetto', { type: 'success' });
        } else {
          await openDialog({ title: 'Proteggi l’archivio', body: persistenceHelp(), ok: 'Ok', cancel: null });
        }
        rerender();
      },
    },
  };
}

async function uploadsCheck() {
  const all = await jobs.all();
  const waiting = all.filter((j) => j.status !== 'done');
  const lastDone = Math.max(0, ...all.filter((j) => j.uploadedAt).map((j) => j.uploadedAt));
  const last = lastDone ? `Ultimo caricamento: ${formatDateTimeIT(lastDone)}` : 'Nessun caricamento ancora';
  const stale = waiting.filter((j) => Date.now() - j.createdAt > STALE_MS).length;
  if (stale) {
    return {
      state: 'warn',
      title: `${stale} scontrin${stale === 1 ? 'o' : 'i'} in attesa da più di 2 giorni`,
      detail: `${last}. Apri il Registro per vedere il motivo.`,
    };
  }
  return { state: waiting.length ? 'info' : 'ok', title: 'Caricamenti', detail: last };
}

const STATE_ICON = { ok: 'check', warn: 'alert', todo: 'alert', info: 'alert' };

function renderItem({ state, title, detail, action }) {
  return h(
    `li.check.${state}`,
    {},
    h('span.check-icon', {}, state === 'busy' ? h('span.spinner.tiny') : icon(STATE_ICON[state])),
    h('div.check-text', {}, h('b', {}, title), detail ? h('small', {}, detail) : null),
    action ? h('button.btn.small', { type: 'button', onclick: action.run }, action.label) : null,
  );
}

/**
 * Renders the checklist into `container` and returns the number of items that
 * need attention. The folder is verified automatically once per session
 * (and again after it changes).
 */
export async function renderDeviceCheck(container, summaryEl) {
  const rerender = () => renderDeviceCheck(container, summaryEl);
  const dest = destination.get();
  const shouldVerify =
    dest && getAccount() && navigator.onLine && !uploadQueue.authBlocked && folderCheck.key !== destKey(dest);
  if (shouldVerify) runFolderCheck(dest).then(rerender); // sets the "checking" state synchronously
  const items = [
    accountCheck(),
    folderItem(dest, rerender),
    installCheck(rerender),
    browserCheck(),
    await storageCheck(rerender),
    await uploadsCheck(),
  ].filter(Boolean);
  container.replaceChildren(...items.map(renderItem));
  const issues = items.filter((i) => i.state === 'warn' || i.state === 'todo').length;
  if (summaryEl) {
    summaryEl.textContent = issues ? `${issues} da sistemare` : 'Tutto pronto';
    summaryEl.className = `check-summary ${issues ? 'warn' : 'ok'}`;
  }
  return issues;
}

let wired = false;
/** Re-render when install availability or the queue changes. */
export function watchDeviceCheck(container, summaryEl) {
  if (wired) return;
  wired = true;
  const rerender = () =>
    container.isConnected && !container.closest('[hidden]') && renderDeviceCheck(container, summaryEl);
  installEvents.addEventListener('change', rerender);
  uploadQueue.addEventListener('authrequired', rerender);
}
