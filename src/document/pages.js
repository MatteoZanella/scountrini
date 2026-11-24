// A "page" is one piece of a document: a photo with the user's crop/enhance
// choices (kind 'image'), or a whole PDF file kept as it is (kind 'pdf').
// Persisted fields are plain data + Blobs (IndexedDB friendly); decoded
// canvases are kept in an in-memory cache keyed by page id.

import { uuid } from '../core/naming.js';
import { canvasToBlob, blobToCanvas, decodeImageFile, rotateCanvas } from '../imaging/canvas.js';
import { detectCorners } from '../imaging/corners.js';
import { warpDocument } from '../imaging/perspective.js';
import { enhance } from '../imaging/enhance.js';
import { encodeIntermediate, makeThumbnail } from '../imaging/encode.js';
import { readJpegExif } from '../metadata/exif.js';
import { readText, renderPage as renderPdfPage, withPdf } from '../pdf/read.js';

/**
 * @typedef {object} Page
 * @property {string} id
 * @property {'image'|'pdf'} [kind]  missing in drafts saved before PDFs: 'image'
 * @property {Blob} source        image: decoded, orientation-normalized photo (JPEG); pdf: the file
 * @property {number} [rotation]  quarter turns applied to `source` (image)
 * @property {{x:number,y:number}[]} [corners]  in rotated-source coordinates (image)
 * @property {number} [intensity] (image)
 * @property {'color'|'gray'} [mode] (image)
 * @property {Blob} [processed]   cropped + enhanced result (image)
 * @property {number} [pdfPages]  number of pages (pdf)
 * @property {string} [name]      file name (pdf)
 * @property {Blob} thumb
 * @property {'camera'|'gallery'|'clipboard'|'files'} origin
 * @property {{date: Date|null, gps: {lat:number,lon:number}|null}} exif
 * @property {string|null} ocrText
 * @property {Record<string, number>|null} [ocrHeights]  line text → height (px)
 */

export const isPdfPage = (page) => page.kind === 'pdf';

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
    kind: 'image',
    source,
    rotation: 0,
    corners,
    intensity: null, // auto: set by the scanner from the photo itself
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

/**
 * A PDF goes in as it is: no crop or enhancement. Its text layer stands in
 * for OCR (`ocrText` stays null for scanned PDFs, which are OCR'd instead).
 */
export function importPdf(file, origin) {
  return withPdf(file, async (doc) => {
    const [cover, { text, heights }] = await Promise.all([renderPdfPage(doc, 1, 720), readText(doc)]);
    return {
      id: uuid(),
      kind: 'pdf',
      source: new Blob([file], { type: 'application/pdf' }),
      name: file.name || 'documento.pdf',
      pdfPages: doc.numPages,
      thumb: await makeThumbnail(cover, 720),
      origin,
      exif: { date: null, gps: null },
      ocrText: text.trim() ? text : null,
      ocrHeights: text.trim() ? heights : null,
    };
  });
}

/** What OCR reads: the processed photo, or the first page of a scanned PDF. */
export async function getOcrCanvas(page) {
  if (!isPdfPage(page)) return getProcessedCanvas(page);
  return withPdf(page.source, (doc) => renderPdfPage(doc, 1, 1600));
}
