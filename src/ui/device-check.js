// "Il tuo dispositivo": a checklist of everything this phone needs for
// uploads to work, each item with a one-tap fix or plain instructions.

import { formatDateTimeIT } from '../core/dates.js';
import { isFirefoxAndroid, isIOS, isStandalone } from '../core/device.js';
import { jobs } from '../storage/db.js';
import { getAccount, reauthenticate } from '../cloud/auth.js';
import { verifyDestination } from '../cloud/graph.js';
import { destination } from '../cloud/destination.js';
import { describeError, isAccessDenied } from '../cloud/errors.js';
import { showAccessRequest } from './access-request.js';
import { uploadQueue } from '../cloud/upload-queue.js';
import { canPromptInstall, installEvents, installHint, promptInstall } from '../pwa.js';
import { h, icon } from './dom.js';
import {
  canPersist,
  isPersisted,
  persistenceState,
  protectStorage,
  showPersistenceHelp,
} from './storage-protection.js';

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
      detail: `${installHint()}. Senza, Safari può cancellare la coda dopo 7 giorni.`,
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
  const hint = installHint();
  return hint && { state: 'info', title: 'Installa l’app', detail: hint };
}

/** Firefox for Android works, but Chrome adds the photo picker and one-tap install. */
function browserCheck() {
  if (!isFirefoxAndroid()) return null; // also when installed: the app runs on Firefox anyway
  const url = location.host + location.pathname;
  return {
    state: 'info',
    title: 'Installa con Chrome',
    detail: 'L’app è meglio supportata su Google Chrome',
    action: {
      label: 'Apri in Chrome',
      run: () => (location.href = `intent://${url}#Intent;scheme=https;package=com.android.chrome;end`),
    },
  };
}

async function storageCheck(rerender) {
  if (!canPersist()) return null;
  if (await isPersisted()) {
    return { state: 'ok', title: 'Archivio protetto', detail: 'Il browser non cancella gli scontrini in coda' };
  }
  const denied = (await persistenceState()) === 'denied';
  return {
    state: 'warn',
    title: 'Archivio non protetto',
    detail: denied
      ? 'Permesso negato: abilitare dalle impostazioni del sito'
      : 'Il browser potrebbe cancellare gli scontrini in coda',
    action: {
      label: denied ? 'Come fare' : 'Proteggi',
      run: async () => {
        await (denied ? showPersistenceHelp() : protectStorage());
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
