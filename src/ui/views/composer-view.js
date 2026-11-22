// "Nuovo" view: collects the photos of one document, shows the composed
// result, proposes fields via OCR and queues the archived file for upload.
// The whole draft is persisted, so nothing is lost if the OS kills the page
// while the camera app is open.

import { LIMITS } from '../../config.js';
import { isAndroid, isFirefoxAndroid } from '../../core/device.js';
import { associativeYear, formatDateIT, toISODate, yearOptions, parseISODate } from '../../core/dates.js';
import { debounce, normalizeAmount } from '../../core/format.js';
import { settings } from '../../core/settings.js';
import { brancaOptions } from '../../core/branche.js';
import { draft } from '../../storage/db.js';
import { getAccount } from '../../cloud/auth.js';
import { destination } from '../../cloud/destination.js';
import { uploadQueue } from '../../cloud/upload-queue.js';
import { importPhoto, getProcessedCanvas, forgetPage, clearPageCache } from '../../document/pages.js';
import { archiveDocument, describeComposition } from '../../document/archive.js';
import { composeDocument } from '../../imaging/stitch.js';
import { canvasToBlob, scaleCanvas } from '../../imaging/canvas.js';
import { loadOpenCV } from '../../imaging/opencv.js';
import { recognize } from '../../ocr/tesseract.js';
import { extractDateTime, extractMerchant, extractTotal, extractVat } from '../../ocr/receipt-parser.js';
import { openScanner } from '../scanner.js';
import { canReadClipboardImages, initPhotoIntake, readClipboardImages } from '../photo-intake.js';
import { canUseWebcam, captureFromWebcam, hasSystemCamera } from '../webcam.js';
import { openViewer } from '../viewer.js';
import { withBusy } from '../busy.js';
import { $, h, icon, show, toast, confirmDialog, openDialog, segmented, objectUrlSlot } from '../dom.js';

const els = {
  empty: $('#empty-state'),
  editor: $('#doc-editor'),
  pages: $('#pages'),
  pageCount: $('#page-count'),
  previewImg: $('#preview-img'),
  previewBusy: $('#preview-busy'),
  previewBusyText: $('#preview-busy-text'),
  composeInfo: $('#compose-info'),
  date: $('#f-date'),
  time: $('#f-time'),
  dateHint: $('#date-hint'),
  merchant: $('#f-merchant'),
  merchantHint: $('#merchant-hint'),
  merchantList: $('#merchant-list'),
  year: $('#f-year'),
  destPath: $('#dest-path'),
  amount: $('#f-amount'),
  amountHint: $('#amount-hint'),
  notes: $('#f-notes'),
  save: $('#btn-save'),
  camera: $('#in-camera'),
  gallery: $('#in-gallery'),
  files: $('#in-files'),
};

const freshForm = () => ({
  date: toISODate(),
  time: '', // printed on the receipt: filled by OCR, never guessed
  merchant: '',
  branca: settings.get('branca') || '',
  year: 'auto',
  amount: '',
  notes: '',
  touched: {},
});

const state = {
  pages: [],
  form: freshForm(),
  gps: null,
  suggestions: {},
  composite: null, // { canvas, groups, version }
  composing: null, // Promise of the running composition
  version: 0,
};

const previewUrl = objectUrlSlot();
const thumbUrls = new Map(); // page id → object URL

// --------------------------------------------------------------------------
// Persistence
// --------------------------------------------------------------------------
const persist = debounce(() => {
  if (!state.pages.length) return draft.clear().catch(() => {});
  const pages = state.pages.map(
    ({ id, source, rotation, corners, intensity, mode, processed, thumb, origin, exif, ocrText, ocrHeights }) => ({
      id,
      source,
      rotation,
      corners,
      intensity,
      mode,
      processed,
      thumb,
      origin,
      exif,
      ocrText,
      ocrHeights,
    }),
  );
  draft
    .save({ pages, form: state.form, gps: state.gps, savedAt: Date.now() })
    .catch((e) => console.warn('Draft not saved', e));
}, 400);

async function restoreDraft() {
  const d = await draft.load().catch(() => null);
  if (!d?.pages?.length) return;
  state.pages = d.pages;
  state.form = { ...freshForm(), ...d.form };
  state.gps = d.gps || null;
  renderAll();
  recompose();
  toast('Ho ripristinato il documento che stavi preparando');
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------
const brancaControl = segmented($('#f-branca'), brancaOptions(), {
  onChange: (v) => {
    state.form.branca = v;
    settings.set('branca', v); // remembered until the user changes it
    onFormChange();
  },
});

function thumbUrl(page) {
  if (!thumbUrls.has(page.id)) thumbUrls.set(page.id, URL.createObjectURL(page.thumb));
  return thumbUrls.get(page.id);
}

function dropThumb(id) {
  const u = thumbUrls.get(id);
  if (u) URL.revokeObjectURL(u);
  thumbUrls.delete(id);
}

function renderPages() {
  const n = state.pages.length;
  els.pageCount.textContent = n ? `(${n})` : '';
  const tiles = state.pages.map((p, i) =>
    h(
      'div.page',
      {},
      h(
        'button.page-thumb',
        { type: 'button', 'aria-label': `Modifica foto ${i + 1}`, onclick: () => editPage(i) },
        h('img', { src: thumbUrl(p), alt: '' }),
        h('span.page-num', {}, String(i + 1)),
      ),
      h(
        'div.page-tools',
        {},
        h(
          'button',
          { type: 'button', 'aria-label': 'Sposta a sinistra', disabled: i === 0, onclick: () => movePage(i, -1) },
          icon('left'),
        ),
        h('button', { type: 'button', 'aria-label': 'Modifica', onclick: () => editPage(i) }, icon('edit')),
        h('button', { type: 'button', 'aria-label': 'Elimina', onclick: () => removePage(i) }, icon('trash')),
      ),
    ),
  );
  const canAdd = n < LIMITS.maxPagesPerDocument;
  const adders = canAdd
    ? [
        h(
          'button.page-add',
          { type: 'button', onclick: chooseSource },
          h('span.add-circle', {}, icon('plus')),
          h('span', {}, 'Aggiungi foto'),
        ),
      ]
    : [];
  els.pages.replaceChildren(...tiles, ...adders);
}

function currentYear() {
  return state.form.year === 'auto' ? associativeYear(state.form.date) : state.form.year;
}

function renderYearOptions() {
  const auto = associativeYear(state.form.date);
  els.year.replaceChildren(
    h('option', { value: 'auto' }, `Automatico (${auto})`),
    ...yearOptions(state.form.date).map((y) => h('option', { value: y }, y)),
  );
  els.year.value = state.form.year;
}

function renderDerived() {
  const f = state.form;
  const year = currentYear();
  const dest = destination.get();
  const path = [dest?.name || 'scontrini', year, f.branca || '…'].join(' › ');
  els.destPath.replaceChildren(icon('folder'), h('span', {}, path));
  setHint(els.dateHint, '', state.suggestions.date && state.suggestions.date === f.date);
  setHint(els.merchantHint, '', state.suggestions.merchant && state.suggestions.merchant === f.merchant);
  setHint(els.amountHint, '', state.suggestions.total && state.suggestions.total === f.amount);
}

function setHint(el, text, fromOcr) {
  el.replaceChildren(
    ...(text ? [h('span', {}, text)] : []),
    ...(fromOcr ? [h('span.ocr-tag', {}, icon('sparkle'), 'letto dallo scontrino')] : []),
  );
}

function renderForm() {
  const f = state.form;
  els.date.value = f.date;
  els.time.value = f.time || '';
  els.merchant.value = f.merchant;
  els.amount.value = f.amount;
  els.notes.value = f.notes;
  brancaControl.set(f.branca);
  renderYearOptions();
  els.merchantList.replaceChildren(...settings.get('merchants').map((m) => h('option', { value: m })));
  renderDerived();
}

function renderAll() {
  const has = state.pages.length > 0;
  show(els.empty, !has);
  show(els.editor, has);
  renderPages();
  renderForm();
}

// --------------------------------------------------------------------------
// Composition (stitching) and preview
// --------------------------------------------------------------------------
const recompose = debounce(() => {
  state.composing = runComposition();
}, 250);

async function runComposition() {
  const version = ++state.version;
  if (!state.pages.length) return;
  show(els.previewBusy, true);
  els.previewBusyText.textContent = state.pages.length > 1 ? 'Unione delle foto…' : 'Anteprima…';
  try {
    const canvases = [];
    for (const p of state.pages) canvases.push(await getProcessedCanvas(p));
    const result = await composeDocument(canvases, (msg) => (els.previewBusyText.textContent = msg));
    if (version !== state.version) return;
    state.composite = { ...result, version };
    const preview = await canvasToBlob(scaleCanvas(result.canvas, 1600), 'image/jpeg', 0.85);
    els.previewImg.src = previewUrl.set(preview);
    els.composeInfo.textContent = composeMessage(result);
  } catch (e) {
    console.error(e);
    if (version === state.version) els.composeInfo.textContent = 'Anteprima non disponibile';
  } finally {
    if (version === state.version) show(els.previewBusy, false);
  }
}

function composeMessage({ groups }) {
  const n = state.pages.length;
  if (n === 1) return 'Tocca l’anteprima per ingrandirla.';
  const text = describeComposition(n, groups);
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

async function ensureComposite() {
  recompose.cancel();
  if (!state.composite || state.composite.version !== state.version) {
    state.composing = runComposition();
  }
  await state.composing;
  return state.composite;
}

// --------------------------------------------------------------------------
// OCR suggestions
// --------------------------------------------------------------------------
async function runOcr(page) {
  if (!settings.get('autoOcr') || page.ocrText != null) return;
  try {
    const { text, heights } = await recognize(await getProcessedCanvas(page));
    const target = state.pages.find((p) => p.id === page.id);
    if (!target) return;
    target.ocrText = text;
    target.ocrHeights = heights;
    persist();
    applySuggestions();
  } catch (e) {
    console.warn('OCR failed', e);
  }
}

function applySuggestions() {
  const read = state.pages.filter((p) => p.ocrText);
  const texts = read.map((p) => p.ocrText);
  if (!texts.length) return;
  const dt = texts.map((t) => extractDateTime(t)).find(Boolean);
  const s = {
    date: dt?.date ?? null,
    time: dt?.time ?? null,
    merchant: extractMerchant(texts[0], settings.get('merchants'), settings.get('merchantByVat'), read[0].ocrHeights),
    total: [...texts].reverse().map(extractTotal).find(Boolean) || null,
    vat: texts.map(extractVat).find(Boolean) || null,
  };
  state.suggestions = s;
  const f = state.form;
  if (s.date && !f.touched.date) f.date = s.date;
  if (s.time && !f.touched.time && !f.time) f.time = s.time;
  if (s.merchant && !f.touched.merchant && !f.merchant) f.merchant = s.merchant;
  if (s.total && !f.touched.amount && !f.amount) f.amount = s.total;
  persist();
  renderForm();
}

// --------------------------------------------------------------------------
// Photos
// --------------------------------------------------------------------------
async function pick(kind) {
  if (state.pages.length >= LIMITS.maxPagesPerDocument) {
    toast(`Massimo ${LIMITS.maxPagesPerDocument} foto per documento`, { type: 'warn' });
    return;
  }
  // Camera: the system camera app where <input capture> is honoured, the
  // in-app camera elsewhere (desktop, Firefox for Android)
  if (kind === 'camera' && !hasSystemCamera() && canUseWebcam()) {
    const file = await captureFromWebcam();
    if (file) addPhotos([file], 'camera');
    return;
  }
  const input = kind === 'files' ? els.files : kind === 'camera' ? els.camera : els.gallery;
  input.value = '';
  input.click();
}

/**
 * Labels of the picker buttons this browser needs (null: not shown).
 * - Android (Chrome, Samsung…): the image input opens the photo picker, which
 *   lists the gallery apps (Google Foto…), so files get their own button.
 * - Firefox for Android has no photo picker: one input opens the file manager.
 * - iOS: the image input's menu already offers Photos, Camera and Files.
 * - Desktop: both would open the same file dialog.
 */
function photoSources() {
  if (isFirefoxAndroid()) return { gallery: 'Galleria o file', files: null };
  if (isAndroid()) return { gallery: 'Galleria', files: 'File' };
  if (hasSystemCamera()) return { gallery: 'Galleria', files: null };
  return { gallery: 'Scegli file', files: null };
}

/** One "+" for further photos; the source is picked in a small sheet. */
async function chooseSource() {
  const row = (value, iconName, label) =>
    label && h('button.action-row', { value }, icon(iconName), h('span', {}, h('b', {}, label)));
  const { gallery, files } = photoSources();
  const body = h(
    'div.action-list',
    {},
    row('camera', 'camera', 'Scatta foto'),
    row('gallery', 'image', gallery),
    row('files', 'folder', files),
    canReadClipboardImages() && row('paste', 'paste', 'Incolla'),
  );
  const choice = await openDialog({ title: 'Aggiungi una foto', body, ok: null });
  if (choice === 'paste') pasteFromClipboard();
  else if (choice === 'camera' || choice === 'gallery' || choice === 'files') pick(choice);
}

async function pasteFromClipboard() {
  if (state.pages.length >= LIMITS.maxPagesPerDocument) {
    toast(`Massimo ${LIMITS.maxPagesPerDocument} foto per documento`, { type: 'warn' });
    return;
  }
  let files;
  try {
    files = await readClipboardImages();
  } catch (e) {
    console.warn('Clipboard read failed', e);
    toast(
      e.name === 'NotAllowedError'
        ? 'Il browser non ha permesso di leggere gli appunti'
        : 'Non riesco a leggere gli appunti: prova con Ctrl+V',
      { type: 'warn' },
    );
    return;
  }
  if (!files.length) {
    toast('Negli appunti non c’è una foto: copiane una e riprova', { type: 'warn' });
    return;
  }
  addPhotos(files, 'clipboard');
}

/** Photos are accepted from paste/drop only on this view, with nothing else open. */
const acceptsPhotos = () =>
  document.body.dataset.view === 'new' &&
  !importing &&
  $('#scanner').hidden &&
  $('#busy').hidden &&
  !document.querySelector('dialog[open]');

function requestPosition() {
  if (!settings.get('saveLocation') || !navigator.geolocation || state.gps) return;
  navigator.geolocation.getCurrentPosition(
    (p) => {
      state.gps = { lat: p.coords.latitude, lon: p.coords.longitude };
      persist();
    },
    () => {},
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60_000 },
  );
}

function defaultDateFromPhoto(page) {
  const d = page.exif?.date;
  if (!d || state.form.touched.date || state.pages.length > 1) return;
  const age = Date.now() - d.getTime();
  if (age >= 0 && age < 6 * 365 * 864e5) {
    state.form.date = toISODate(d);
  }
}

let importing = false;

async function addPhotos(files, origin) {
  const picked = [...files];
  // The "File" input has no accept (so the file manager lists everything)
  const images = picked.filter(
    (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(f.name || ''),
  );
  if (picked.length && !images.length) {
    toast('Scegli un’immagine: JPG, PNG, WebP o HEIC', { type: 'warn' });
    return;
  }
  const list = images.slice(0, LIMITS.maxPagesPerDocument - state.pages.length);
  if (!list.length || importing) return;
  importing = true;
  try {
    await importPhotos(list, origin);
  } finally {
    importing = false;
  }
}

async function importPhotos(list, origin) {
  if (origin === 'camera') requestPosition();
  for (const [i, file] of list.entries()) {
    let imported;
    try {
      imported = await withBusy(i === 0 ? 'Preparo lo scanner…' : 'Carico la foto…', async (msg) => {
        await loadOpenCV();
        msg('Cerco lo scontrino nella foto…');
        return importPhoto(file, origin);
      });
    } catch (e) {
      console.error(e);
      toast(e.message || 'Foto non leggibile', { type: 'error' });
      continue;
    }
    // Same look as the previous photo: different settings would show at the stitching seam
    const prev = state.pages.at(-1);
    if (prev) Object.assign(imported.page, { mode: prev.mode, intensity: prev.intensity });
    const subtitle = list.length > 1 ? `Foto ${i + 1} di ${list.length}` : `Foto ${state.pages.length + 1}`;
    const page = await openScanner(imported.page, { subtitle, detected: imported.detected });
    if (!page) {
      forgetPage(imported.page.id);
      continue;
    }
    state.pages.push(page);
    defaultDateFromPhoto(page);
    persist();
    renderAll();
    recompose();
    runOcr(page);
  }
}

async function editPage(i) {
  const old = state.pages[i];
  const page = await openScanner(old, { subtitle: `Foto ${i + 1}` });
  if (!page) return;
  dropThumb(old.id);
  state.pages[i] = { ...page, ocrText: null, ocrHeights: null };
  persist();
  renderPages();
  recompose();
  runOcr(state.pages[i]);
}

function movePage(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= state.pages.length) return;
  [state.pages[i], state.pages[j]] = [state.pages[j], state.pages[i]];
  persist();
  renderPages();
  recompose();
}

async function removePage(i) {
  const ok = await confirmDialog({ title: 'Eliminare questa foto?', ok: 'Elimina', danger: true });
  if (!ok) return;
  const [p] = state.pages.splice(i, 1);
  dropThumb(p.id);
  forgetPage(p.id);
  persist();
  renderAll();
  if (state.pages.length) recompose();
  else resetDocument();
}

function resetDocument() {
  for (const id of thumbUrls.keys()) dropThumb(id);
  clearPageCache();
  state.pages = [];
  state.form = freshForm();
  state.gps = null;
  state.suggestions = {};
  state.composite = null;
  state.version++;
  els.previewImg.removeAttribute('src');
  previewUrl.set(null);
  els.composeInfo.textContent = '';
  draft.clear().catch(() => {});
  renderAll();
}

// --------------------------------------------------------------------------
// Form + save
// --------------------------------------------------------------------------
function onFormChange() {
  persist();
  renderDerived();
}

function validate() {
  const f = state.form;
  const errors = [];
  if (!parseISODate(f.date)) errors.push([els.date, 'Inserisci la data dell’operazione']);
  if (!f.merchant.trim()) errors.push([els.merchant, 'Scrivi l’esercente (es. Lidl): serve per riconoscere il file']);
  if (!f.branca) errors.push([$('#f-branca'), 'Scegli la branca']);
  if (f.amount && !normalizeAmount(f.amount)) errors.push([els.amount, 'Importo non valido (es. 12,50)']);
  if (!destination.get()) errors.push([null, 'Configura prima la cartella OneDrive nelle impostazioni']);
  return errors;
}

async function save() {
  const errors = validate();
  if (errors.length) {
    const [el, msg] = errors[0];
    toast(msg, { type: 'error' });
    el?.focus?.();
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    return;
  }
  const f = state.form;
  try {
    await withBusy('Creo il file…', async (msg) => {
      const composite = await ensureComposite();
      if (!composite) throw new Error('Anteprima non disponibile');
      msg('Salvo sul telefono…');
      const account = getAccount();
      return archiveDocument({
        canvas: composite.canvas,
        groups: composite.groups,
        pageCount: state.pages.length,
        form: { ...f, year: currentYear(), amount: f.amount ? normalizeAmount(f.amount) : '' },
        author: {
          userName: settings.get('userName') || account?.name || 'Sconosciuto',
          account: account?.username,
          device: settings.get('deviceName') || 'Dispositivo',
        },
        gps: settings.get('saveLocation') ? state.gps || state.pages.find((p) => p.exif?.gps)?.exif.gps || null : null,
      });
    });
    settings.rememberMerchant(f.merchant, state.suggestions.vat);
    resetDocument();
    toast(
      navigator.onLine ? 'Salvato. Caricamento in corso…' : `Salvato sul telefono: verrà caricato appena torna la rete`,
      {
        type: 'success',
        timeout: 4500,
      },
    );
    uploadQueue.notifyChanged();
    uploadQueue.kick();
  } catch (e) {
    console.error(e);
    toast(`Salvataggio non riuscito: ${e.message}`, { type: 'error', timeout: 6000 });
  }
}

// --------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------
export function initComposer() {
  const { gallery, files } = photoSources();
  $('[data-act="gallery"] span').textContent = gallery;
  show($('[data-act="files"]'), Boolean(files));
  show($('#firefox-gallery-hint'), isFirefoxAndroid());
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'camera' || act === 'gallery' || act === 'files') pick(act);
    if (act === 'paste') pasteFromClipboard();
  });
  // Pasting a copied image is a desktop path: on phones it crowded the actions
  // and the clipboard rarely holds an image (the sheet still offers it).
  show($('[data-act="paste"]'), canReadClipboardImages() && !matchMedia('(pointer: coarse)').matches);
  initPhotoIntake({ isActive: acceptsPhotos, onFiles: addPhotos });
  els.camera.addEventListener('change', () => addPhotos(els.camera.files, 'camera'));
  els.gallery.addEventListener('change', () => addPhotos(els.gallery.files, 'gallery'));
  els.files.addEventListener('change', () => addPhotos(els.files.files, 'files'));

  els.time.addEventListener('change', () => {
    state.form.time = els.time.value;
    state.form.touched.time = true;
    onFormChange();
  });
  els.date.addEventListener('change', () => {
    state.form.date = els.date.value;
    state.form.touched.date = true;
    renderYearOptions();
    onFormChange();
  });
  els.merchant.addEventListener('input', () => {
    state.form.merchant = els.merchant.value;
    state.form.touched.merchant = true;
    onFormChange();
  });
  els.amount.addEventListener('input', () => {
    state.form.amount = els.amount.value;
    state.form.touched.amount = true;
    onFormChange();
  });
  els.amount.addEventListener('blur', () => {
    const n = normalizeAmount(els.amount.value);
    if (n) els.amount.value = state.form.amount = n;
    onFormChange();
  });
  els.notes.addEventListener('input', () => {
    state.form.notes = els.notes.value;
    onFormChange();
  });
  els.year.addEventListener('change', () => {
    state.form.year = els.year.value;
    onFormChange();
  });
  $('#doc-form').addEventListener('submit', (e) => e.preventDefault());
  els.save.addEventListener('click', save);
  $('#btn-discard').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Annullare il documento?',
      body: 'Le foto di questo documento verranno scartate.',
      ok: 'Annulla documento',
      cancel: 'Continua',
      danger: true,
    });
    if (ok) resetDocument();
  });
  $('#preview').addEventListener('click', async () => {
    const c = state.composite;
    if (!c) return;
    const blob = await canvasToBlob(scaleCanvas(c.canvas, 4000, 12e6), 'image/jpeg', 0.9);
    openViewer(blob, `${formatDateIT(state.form.date)} · ${state.form.merchant || 'Anteprima'}`);
  });

  renderAll();
  restoreDraft();
}

/** Refreshes things that depend on settings/destination (called on view enter). */
export function refreshComposer() {
  if (!state.pages.length && !state.form.touched.branca) {
    state.form.branca = settings.get('branca') || state.form.branca;
  }
  renderForm();
}
