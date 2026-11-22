// Full-screen scanner sheet: step 1 crop (corner editor), step 2 enhance
// (live preview + intensity slider + color mode; press and hold the image to compare).

import { scaleCanvas } from '../imaging/canvas.js';
import { detectCorners, insetCorners, rotateCornersCW } from '../imaging/corners.js';
import { warpDocument } from '../imaging/perspective.js';
import { prepareEnhance, renderEnhanced } from '../imaging/enhance.js';
import { getRotatedSource, renderPage } from '../document/pages.js';
import { CornerEditor } from './corner-editor.js';
import { $, $$, closeOnBack, show, segmented, toast } from './dom.js';

const root = $('#scanner');
const els = {
  title: $('#sc-title'),
  sub: $('#sc-sub'),
  stage: $('#sc-stage'),
  canvas: $('#sc-canvas'),
  preview: $('#sc-preview'),
  busy: $('#sc-busy'),
  busyText: $('#sc-busy-text'),
  hint: $('#sc-crop-hint'),
  intensity: $('#sc-intensity'),
  autoIntensity: $('[data-sc="auto-int"]'),
  compareHint: $('#sc-compare-hint'),
};

let editor = null;
let session = null; // state of the currently open scan

function setBusy(text) {
  show(els.busy, Boolean(text));
  if (text) els.busyText.textContent = text;
}

function setStep(step) {
  session.step = step;
  for (const s of $$('.sc-step', root)) show(s, s.dataset.step === step);
  for (const d of $$('[data-dot]', root)) d.classList.toggle('on', d.dataset.dot === step);
  show(els.canvas, step === 'crop');
  show(els.preview, step === 'enhance');
  show(els.compareHint, step === 'enhance');
  els.title.textContent = step === 'crop' ? 'Ritaglio' : 'Miglioramento';
}

const modeControl = segmented(
  $('#sc-mode'),
  [
    { value: 'gray', label: 'Bianco e nero', icon: 'contrast' },
    { value: 'color', label: 'Colori', icon: 'palette' },
  ],
  {
    onChange: (v) => {
      session.page.mode = v;
      schedulePreview();
    },
  },
);

const previewCtx = els.preview.getContext('2d');

/** Shows the enhanced preview, or the original crop while comparing. */
function drawPreview(original = false) {
  if (original) previewCtx.drawImage(session.previewSrc, 0, 0);
  else previewCtx.putImageData(session.previewOut, 0, 0);
}

// The slider fires faster than the screen refreshes: one render per frame
let previewRaf = 0;
function schedulePreview() {
  cancelAnimationFrame(previewRaf);
  previewRaf = requestAnimationFrame(() => {
    if (!session?.prep) return;
    const { intensity, mode } = session.page;
    renderEnhanced(session.prep, { intensity, mode }, session.previewOut);
    drawPreview();
  });
}

function syncIntensity() {
  const v = session.page.intensity;
  els.intensity.value = v;
  els.intensity.style.setProperty('--fill', `${v}%`); // filled part of the track
  els.autoIntensity.disabled = v === session.prep.auto;
}

async function showCrop() {
  setStep('crop');
  session.rotated = await getRotatedSource(session.page);
  editor.setImage(session.rotated, session.page.corners);
}

async function goEnhance() {
  session.page.corners = editor.corners;
  setBusy('Raddrizzo il documento…');
  try {
    session.warped = await warpDocument(session.rotated, session.page.corners);
    // Screen resolution is enough to judge the look, and keeps the slider fluid
    const side = Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio || 1, 2);
    session.previewSrc = scaleCanvas(session.warped, side, 1_500_000);
    session.prep = await prepareEnhance(session.previewSrc);
    session.page.intensity ??= session.prep.auto;
    els.preview.width = session.previewSrc.width;
    els.preview.height = session.previewSrc.height;
    session.previewOut = new ImageData(els.preview.width, els.preview.height);
    setStep('enhance');
    syncIntensity();
    modeControl.set(session.page.mode);
    schedulePreview();
  } catch (e) {
    console.error(e);
    toast('Impossibile elaborare la foto', { type: 'error' });
  } finally {
    setBusy(null);
  }
}

const actions = {
  async rotate() {
    const h = session.rotated.height;
    session.page.corners = rotateCornersCW(editor.corners, h);
    session.page.rotation = (session.page.rotation + 1) % 4;
    session.rotated = await getRotatedSource(session.page);
    editor.setImage(session.rotated, session.page.corners);
  },
  async auto() {
    setBusy('Cerco i bordi…');
    try {
      const { corners, detected } = await detectCorners(session.rotated);
      editor.corners = corners;
      if (!detected) toast('Bordi non trovati: sistemali a mano', { type: 'warn' });
    } finally {
      setBusy(null);
    }
  },
  full() {
    editor.corners = insetCorners(session.rotated.width, session.rotated.height, 0);
  },
  next: goEnhance,
  back: showCrop,
  'auto-int'() {
    session.page.intensity = session.prep.auto;
    syncIntensity();
    schedulePreview();
  },
  async done() {
    setBusy('Elaborazione in alta risoluzione…');
    try {
      const result = await renderPage(session.page, session.warped);
      close(result);
    } catch (e) {
      console.error(e);
      toast('Elaborazione non riuscita', { type: 'error' });
    } finally {
      setBusy(null);
    }
  },
};

root.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sc]');
  if (b && session && !b.disabled) actions[b.dataset.sc]?.();
});

els.intensity.addEventListener('input', () => {
  session.page.intensity = +els.intensity.value;
  syncIntensity();
  schedulePreview();
});

// Press and hold the image (or Space when it has focus) to see the original crop
const showOriginal = (on) => {
  if (!session?.prep) return;
  drawPreview(on);
  els.compareHint.textContent = on ? 'Originale' : 'Tieni premuto per l’originale';
  els.compareHint.classList.toggle('on', on);
};
els.preview.addEventListener('pointerdown', (e) => (e.preventDefault(), showOriginal(true)));
for (const ev of ['pointerup', 'pointerleave', 'pointercancel'])
  els.preview.addEventListener(ev, () => showOriginal(false));
els.preview.addEventListener('contextmenu', (e) => e.preventDefault());
els.preview.addEventListener('keydown', (e) => e.key === ' ' && (e.preventDefault(), showOriginal(true)));
els.preview.addEventListener('keyup', (e) => e.key === ' ' && showOriginal(false));

$('#sc-cancel').addEventListener('click', () => close(null));

// Back gesture: from "Miglioramento" back to "Ritaglio", from there it discards
function onBack() {
  if (session?.step !== 'enhance') return close(null);
  session.releaseBack = closeOnBack(onBack);
  showCrop();
}

function close(result) {
  if (!session) return;
  const { resolve, releaseBack } = session;
  session = null;
  show(root, false);
  document.body.classList.remove('modal-open');
  releaseBack();
  resolve(result);
}

/**
 * Opens the scanner for a page.
 * @returns {Promise<import('../document/pages.js').Page|null>} null if discarded
 */
export function openScanner(page, { subtitle = '', detected = true, startAt = 'crop' } = {}) {
  editor ||= new CornerEditor(els.canvas, $('#sc-loupe'), els.stage);
  return new Promise((resolve) => {
    session = { page: { ...page }, resolve, step: 'crop', releaseBack: closeOnBack(onBack) };
    els.sub.textContent = subtitle;
    els.hint.textContent = detected
      ? 'Bordi rilevati: controlla gli angoli e prosegui'
      : 'Bordi non trovati: trascina gli angoli sullo scontrino';
    show(root, true);
    document.body.classList.add('modal-open');
    showCrop().then(() => startAt === 'enhance' && goEnhance());
  });
}
