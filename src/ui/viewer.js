// Full-screen image viewer. Opens fitted to the screen width (a long receipt
// reads straight away, one finger scrolls it natively). Pinch, double tap,
// double click or Ctrl+wheel zoom the image only: the page itself never zooms
// (touch-action on the body), so the header stays put.

import { $, show, objectUrlSlot, closeOnBack, toast } from './dom.js';
import { pdfToImage } from '../pdf/read.js';

const root = $('#viewer');
const img = $('#viewer-img');
const body = $('#viewer-body');
const url = objectUrlSlot();
let releaseBack = null; // set while open

// Mouse and trackpad have their own gestures
if (!matchMedia('(pointer: coarse)').matches) {
  $('#viewer-hint').textContent = 'Doppio clic o Ctrl+rotellina per ingrandire';
}

// Image width limits in CSS px: whole image visible ↔ well past 1:1
const range = { fit: 0, min: 0, max: 0 };

function measure() {
  const ratio = img.naturalHeight / img.naturalWidth || 1;
  range.fit = body.clientWidth;
  range.min = Math.min(range.fit, body.clientHeight / ratio);
  range.max = Math.max(range.fit * 4, img.naturalWidth / (devicePixelRatio || 1));
}

/** Sets the image width, keeping the point under (cx, cy) where it is. */
function zoomTo(width, cx, cy) {
  const before = img.getBoundingClientRect();
  const w = Math.max(range.min, Math.min(range.max, width));
  const k = w / before.width;
  img.style.width = `${w}px`;
  const after = img.getBoundingClientRect();
  body.scrollLeft += after.left + (cx - before.left) * k - cx;
  body.scrollTop += after.top + (cy - before.top) * k - cy;
}

function fitWidth() {
  measure();
  img.style.width = `${range.fit}px`;
  body.scrollTo(0, 0);
}

// ---- Pinch (two fingers); one finger is left to native scrolling ----
let pinch = null;
const span = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
body.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length === 2) pinch = { span: span(e.touches), width: img.getBoundingClientRect().width };
  },
  { passive: true },
);
body.addEventListener(
  'touchmove',
  (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault(); // no scrolling while pinching
    const [a, b] = e.touches;
    zoomTo((pinch.width * span(e.touches)) / pinch.span, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
  },
  { passive: false },
);
body.addEventListener('touchend', (e) => e.touches.length < 2 && (pinch = null));

// ---- Double tap / double click: zoom into the point, again to fit ----
let lastTap = 0;
body.addEventListener('click', (e) => {
  const now = performance.now();
  if (now - lastTap > 300) {
    lastTap = now;
    return;
  }
  lastTap = 0;
  const zoomed = img.getBoundingClientRect().width > range.fit * 1.05;
  zoomTo(zoomed ? range.fit : range.fit * 2.5, e.clientX, e.clientY);
});

// ---- Trackpad pinch and Ctrl+wheel (desktop) ----
body.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return; // plain wheel scrolls
    e.preventDefault();
    zoomTo(img.getBoundingClientRect().width * Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
  },
  { passive: false },
);

img.addEventListener('load', fitWidth);
addEventListener('resize', () => !root.hidden && img.naturalWidth && fitWidth());

function close() {
  if (!releaseBack) return;
  releaseBack();
  releaseBack = null;
  show(root, false);
  document.body.classList.remove('modal-open');
  img.removeAttribute('src');
  img.style.width = '';
  url.set(null);
}

$('#viewer-close').addEventListener('click', close);
addEventListener('keydown', (e) => e.key === 'Escape' && close());

/** Shows an image, or a PDF with its pages one under the other. */
export async function openViewer(blob, title = 'Anteprima') {
  $('#viewer-title').textContent = title;
  show(root, true);
  document.body.classList.add('modal-open');
  releaseBack ||= closeOnBack(close);
  const opened = releaseBack;
  if (blob.type === 'application/pdf') {
    try {
      blob = await pdfToImage(blob);
    } catch (e) {
      toast(e.message, { type: 'error' });
      return close();
    }
    if (releaseBack !== opened) return; // closed while rendering
  }
  img.src = url.set(blob); // sized on load, now that the body has its size
}
