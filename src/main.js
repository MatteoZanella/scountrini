// Application bootstrap and view routing.

import './styles/main.css';
import { CONFIG } from './config.js';
import { settings } from './core/settings.js';
import { guessDeviceName, isFirefox } from './core/device.js';
import { requestPersistence } from './storage/db.js';
import { offerStorageProtection } from './ui/storage-protection.js';
import { initAuth } from './cloud/auth.js';
import { captureInviteFromUrl } from './cloud/destination.js';
import { uploadQueue } from './cloud/upload-queue.js';
import { loadOpenCV } from './imaging/opencv.js';
import { warmUp as warmUpOcr } from './ocr/tesseract.js';
import { registerServiceWorker } from './pwa.js';
import { applyTheme } from './ui/theme.js';
import { $, $$, show, toast } from './ui/dom.js';
import { initStatus, refreshStatus } from './ui/status.js';
import { initSetup, renderSetup, isSetupComplete, resumeSetup } from './ui/views/setup-view.js';
import { initComposer, refreshComposer } from './ui/views/composer-view.js';
import { initLog, render as renderLog } from './ui/views/log-view.js';
import { initSettings, renderSettings } from './ui/views/settings-view.js';

const VIEWS = ['setup', 'new', 'log', 'settings'];
const onEnter = {
  setup: renderSetup,
  // First visit (Firefox): ask to protect the stored receipts
  new: () => (refreshComposer(), offerStorageProtection()),
  log: renderLog,
  settings: renderSettings,
};

let currentView = null;

const viewFromUrl = () => {
  const name = location.hash.slice(1);
  return VIEWS.includes(name) ? name : null;
};

/** Shows a view without touching the history. */
function renderView(name) {
  currentView = name;
  for (const v of VIEWS) show($(`#view-${v}`), v === name);
  show($('#tabbar'), name !== 'setup');
  for (const b of $$('#tabbar [data-view]')) {
    const on = b.dataset.view === name;
    b.classList.toggle('on', on);
    b.toggleAttribute('aria-current', false);
    if (on) b.setAttribute('aria-current', 'page');
  }
  document.body.dataset.view = name;
  window.scrollTo(0, 0);
  onEnter[name]?.();
}

const HOME = 'new';

/**
 * Switches section following Android's tab pattern: the back gesture from any
 * section returns to "Nuovo", and from "Nuovo" leaves the app. So at most one
 * history entry (flagged `aboveHome`) sits on top of the home one, however
 * many tabs are visited. The hash keeps the section across a reload.
 *
 * @param {'setup'|'new'|'log'|'settings'} name
 */
function showView(name) {
  if (name === currentView) return;
  const aboveHome = Boolean(history.state?.aboveHome);
  if (name === HOME && aboveHome) return history.back(); // popstate renders it
  const state = { view: name, aboveHome: name !== HOME && (aboveHome || currentView === HOME) };
  if (currentView === HOME && name !== HOME) history.pushState(state, '', `#${name}`);
  else history.replaceState(state, '', `#${name}`);
  renderView(name);
}

// Back/forward between sections. Overlays (scanner, viewer, camera) add their
// own entries on top of the current section's: popping those lands here on the
// section already shown, so nothing changes.
addEventListener('popstate', (e) => {
  const name = e.state?.view || viewFromUrl();
  if (name && name !== currentView) renderView(name);
});

function preloadHeavyAssets() {
  // Warm OpenCV (and OCR) in the background so the scanner opens instantly
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => {
    loadOpenCV().catch(() => {});
    if (settings.get('autoOcr')) setTimeout(warmUpOcr, 4000);
  });
}

async function main() {
  document.title = CONFIG.appName;
  applyTheme(settings.get('theme'));
  captureInviteFromUrl();
  if (!settings.get('deviceName')) settings.set('deviceName', await guessDeviceName());

  try {
    await initAuth();
  } catch (e) {
    console.error('Auth init failed', e);
    toast('Accesso Microsoft non disponibile', { type: 'error' });
  }

  initSetup({ onDone: () => showView(HOME) });
  initComposer();
  initLog();
  initSettings({ onChangeFolder: () => showView('setup') });
  initStatus({ onOpenLog: () => showView('log') });

  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) showView(b.dataset.view);
  });

  await resumeSetup();
  // First paint: the section in the URL (reload), keeping its history entry
  const first = isSetupComplete() ? viewFromUrl() || HOME : 'setup';
  history.replaceState(
    { view: first, aboveHome: first !== HOME && Boolean(history.state?.aboveHome) },
    '',
    `#${first}`,
  );
  renderView(first);

  uploadQueue.addEventListener('change', () => document.body.dataset.view === 'log' && renderLog());
  await uploadQueue.init();
  refreshStatus();
  registerServiceWorker();
  // Chromium and Safari grant storage persistence silently (installed app,
  // engagement), so ask on launch. Firefox shows a prompt instead: there the
  // app explains first, on the first visit to "Nuovo" (storage-protection.js).
  if (!isFirefox()) requestPersistence();
  preloadHeavyAssets();
}

main();
