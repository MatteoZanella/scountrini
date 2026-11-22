// Global status: queue chip in the top bar, tab badge and the info notice
// (offline / sign-in expired / install hint).

import { settings } from '../core/settings.js';
import { isAndroid, isIOS, isStandalone } from '../core/device.js';
import { jobs } from '../storage/db.js';
import { reauthenticate } from '../cloud/auth.js';
import { uploadQueue } from '../cloud/upload-queue.js';
import { canPromptInstall, installEvents, installHint, promptInstall } from '../pwa.js';
import { summarize } from './views/log-view.js';
import { $, h, icon, show } from './dom.js';

const chip = $('#queue-chip');
const badge = $('#tab-badge');
const notice = $('#notice');

const dismissInstallHint = () =>
  h(
    'button.notice-btn',
    {
      type: 'button',
      'aria-label': 'Chiudi',
      onclick: () => (settings.set('installHintDismissed', true), renderNotice()),
    },
    icon('x'),
  );

function renderNotice() {
  let content = null;
  const offerInstall = !isStandalone() && !settings.get('installHintDismissed');
  if (uploadQueue.authBlocked) {
    content = h(
      'div.notice-inner.warn',
      {},
      icon('alert'),
      h('span', {}, 'Accesso Microsoft scaduto: gli scontrini restano in coda.'),
      h('button.notice-btn', { type: 'button', onclick: () => reauthenticate() }, 'Accedi'),
    );
  } else if (!navigator.onLine) {
    content = h(
      'div.notice-inner',
      {},
      icon('cloud-off'),
      h('span', {}, 'Sei offline: salvo sul telefono e carico appena torna la rete.'),
    );
  } else if (offerInstall && isIOS()) {
    content = h(
      'div.notice-inner.info',
      {},
      icon('share'),
      h('span', {}, `Installa l’app, così Safari non cancella la coda. ${installHint()}.`),
      dismissInstallHint(),
    );
  } else if (offerInstall && canPromptInstall()) {
    content = h(
      'div.notice-inner.info',
      {},
      icon('download'),
      h('span', {}, 'Installa l’app: si apre dalla schermata Home e protegge gli scontrini in coda.'),
      h('button.notice-btn', { type: 'button', onclick: () => promptInstall() }, 'Installa'),
      dismissInstallHint(),
    );
  } else if (offerInstall && isAndroid()) {
    // No install event (e.g. Firefox): installing is a menu item, say where
    content = h(
      'div.notice-inner.info',
      {},
      icon('download'),
      h('span', {}, `Installa l’app. ${installHint()}.`),
      dismissInstallHint(),
    );
  }
  notice.replaceChildren(...(content ? [content] : []));
  show(notice, Boolean(content));
}

export async function refreshStatus() {
  const s = summarize(await jobs.all());
  const attention = s.error + s.conflict;
  const todo = s.pending + s.uploading + attention;
  badge.textContent = String(todo);
  show(badge, todo > 0);
  badge.classList.toggle('err', attention > 0);

  let content = null;
  let cls = '';
  if (s.uploading) {
    content = [h('span.spinner.tiny'), `Carico ${s.uploading + s.pending}…`];
    cls = 'busy';
  } else if (attention) {
    content = [icon('alert'), `${attention} da controllare`];
    cls = 'err';
  } else if (s.pending) {
    content = [icon('upload'), `${s.pending} in coda`];
    cls = 'pending';
  } else if (s.done) {
    content = [icon('cloud-check'), 'Tutto caricato'];
    cls = 'ok';
  }
  chip.className = `queue-chip ${cls}`;
  chip.replaceChildren(...(content || []));
  show(chip, Boolean(content));
  renderNotice();
}

export function initStatus({ onOpenLog }) {
  chip.addEventListener('click', onOpenLog);
  uploadQueue.addEventListener('change', refreshStatus);
  uploadQueue.addEventListener('authrequired', refreshStatus);
  addEventListener('online', refreshStatus);
  addEventListener('offline', refreshStatus);
  installEvents.addEventListener('change', renderNotice);
  refreshStatus();
}
