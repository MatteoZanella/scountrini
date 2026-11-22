// A "page" is one photo of a document, with the user's crop/enhance choices.
// Persisted fields are plain data + Blobs (IndexedDB friendly); decoded
// canvases are kept in an in-memory cache keyed by page id.

import { CONFIG } from '../config.js';
import { uuid } from '../core/naming.js';
import { settings } from '../core/settings.js';
import { canvasToBlob, blobToCanvas, decodeImageFile, rotateCanvas } from '../imaging/canvas.js';
import { detectCorners } from '../imaging/corners.js';
import { warpDocument } from '../imaging/perspective.js';
import { enhance } from '../imaging/enhance.js';
import { encodeIntermediate, makeThumbnail } from '../imaging/encode.js';
import { readJpegExif } from '../metadata/exif.js';

/**
 * @typedef {object} Page
 * @property {string} id
 * @property {Blob} source        decoded, orientation-normalized photo (JPEG)
 * @property {number} rotation    quarter turns applied to `source`
 * @property {{x:number,y:number}[]} corners  in rotated-source coordinates
 * @property {number} intensity
 * @property {'color'|'gray'} mode
 * @property {Blob} processed     cropped + enhanced result
 * @property {Blob} thumb
 * @property {'camera'|'gallery'|'clipboard'} origin
 * @property {{date: Date|null, gps: {lat:number,lon:number}|null}} exif
 * @property {string|null} ocrText
 * @property {Record<string, number>|null} [ocrHeights]  line text → height (px)
 */

const canvasCache = new Map(); // id → { source?: canvas, processed?: canvas }

function cacheEntry(id) {
  if (!canvasCache.has(id)) canvasCache.set(id, {});
  return canvasCache.get(id);
}

export function forgetPage(id) {
  canvasCache.delete(id);
}

export function clearPageCache() {
  canvasCache.clear();
}

async function readExif(file) {
  if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name || '')) return { date: null, gps: null };
  const head = await file.slice(0, 256 * 1024).arrayBuffer();
  return readJpegExif(head) || { date: null, gps: null };
}

/** Decodes a picked/captured file and proposes the document corners. */
export async function importPhoto(file, origin) {
  const [exif, canvas] = await Promise.all([readExif(file), decodeImageFile(file)]);
  const { corners, detected } = await detectCorners(canvas);
  const source = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  const draft = {
    id: uuid(),
    source,
    rotation: 0,
    corners,
    intensity: settings.get('defaultIntensity') ?? CONFIG.defaultIntensity,
    mode: 'gray', // black and white reads best for receipts; colour stays one tap away
    origin,
    exif,
    ocrText: null,
  };
  cacheEntry(draft.id).source = canvas;
  return { page: draft, detected };
}

/** Source canvas with the page rotation applied (cached). */
export async function getRotatedSource(page) {
  const entry = cacheEntry(page.id);
  if (!entry.source) entry.source = await blobToCanvas(page.source);
  return rotateCanvas(entry.source, page.rotation);
}

export async function getProcessedCanvas(page) {
  const entry = cacheEntry(page.id);
  if (!entry.processed) entry.processed = await blobToCanvas(page.processed);
  return entry.processed;
}

/** Full-resolution crop + enhancement; stores result blobs on the page. */
export async function renderPage(page, warped = null) {
  const src = warped || (await warpDocument(await getRotatedSource(page), page.corners));
  const processed = await enhance(src, { intensity: page.intensity, mode: page.mode });
  cacheEntry(page.id).processed = processed;
  const [blob, thumb] = await Promise.all([encodeIntermediate(processed), makeThumbnail(processed, 720)]);
  return { ...page, processed: blob, thumb };
}
