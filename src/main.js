// Application bootstrap and view routing.

import './styles/main.css';
import { CONFIG } from './config.js';
import { settings } from './core/settings.js';
import { guessDeviceName } from './core/device.js';
import { requestPersistence } from './storage/db.js';
import { initAuth } from './cloud/auth.js';
import { captureInviteFromUrl } from './cloud/destination.js';
import { uploadQueue } from './cloud/upload-queue.js';
import { loadOpenCV } from './imaging/opencv.js';
import { warmUp as warmUpOcr } from './ocr/tesseract.js';
import { registerServiceWorker } from './pwa.js';
import { applyTheme } from './ui/theme.js';
import { $, $$, show, toast } from './ui/dom.js';
import { initStatus, refreshStatus } from './ui/status.js';
import { initSetup, renderSetup, isSetupComplete, autoLinkPendingInvite } from './ui/views/setup-view.js';
import { initComposer, refreshComposer } from './ui/views/composer-view.js';
import { initLog, render as renderLog } from './ui/views/log-view.js';
import { initSettings, renderSettings } from './ui/views/settings-view.js';

const VIEWS = ['setup', 'new', 'log', 'settings'];
const onEnter = { setup: renderSetup, new: refreshComposer, log: renderLog, settings: renderSettings };

function showView(name) {
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

  initSetup({ onDone: () => showView('new') });
  initComposer();
  initLog();
  initSettings({ onChangeFolder: () => showView('setup') });
  initStatus({ onOpenLog: () => showView('log') });

  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) showView(b.dataset.view);
  });

  await autoLinkPendingInvite();
  showView(isSetupComplete() ? 'new' : 'setup');

  uploadQueue.addEventListener('change', () => document.body.dataset.view === 'log' && renderLog());
  await uploadQueue.init();
  refreshStatus();
  registerServiceWorker();
  requestPersistence();
  preloadHeavyAssets();
}

main();
