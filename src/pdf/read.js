// Reading PDFs with pdf.js: page renders (thumbnails, previews, OCR of
// scanned PDFs) and the text layer of digital ones. Loaded on first use; the
// worker, fonts and decoders are served from vendor/pdfjs (see vite.config.js).

import { CONFIG } from '../config.js';
import { canvasToBlob, createCanvas, ctx2d } from '../imaging/canvas.js';

const BASE = `${import.meta.env.BASE_URL}vendor/pdfjs/`;

let lib = null;
function pdfjs() {
  lib ||= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.mjs`;
    return m;
  });
  return lib;
}

export const isPdfFile = (f) => f?.type === 'application/pdf' || /\.pdf$/i.test(f?.name || '');

/**
 * Opens a PDF (Blob or bytes), passes it to `use` and closes it afterwards.
 * Throws a user-facing error for password-protected or broken files.
 */
export async function withPdf(data, use) {
  const doc = await openPdf(data);
  try {
    return await use(doc);
  } finally {
    doc.loadingTask.destroy();
  }
}

async function openPdf(data) {
  const { getDocument } = await pdfjs();
  // pdf.js hands the buffer over to its worker: always give it a copy
  const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data.slice();
  const task = getDocument({
    data: bytes,
    standardFontDataUrl: `${BASE}standard_fonts/`,
    wasmUrl: `${BASE}wasm/`,
    iccUrl: `${BASE}iccs/`,
    isEvalSupported: false,
  });
  try {
    return await task.promise;
  } catch (e) {
    if (e?.name === 'PasswordException')
      throw new Error('Il PDF è protetto da password: toglila e riprova', { cause: e });
    throw new Error('PDF non leggibile', { cause: e });
  }
}

/** Page `n` (1-based) rendered `width` px wide on white. */
export async function renderPage(doc, n, width) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = createCanvas(viewport.width, viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return canvas;
}

/**
 * All pages one under the other (at most `maxPages`), as a single canvas:
 * the preview of a PDF document, like the composed image of the photos.
 */
export function renderStack(data, { width = 1200, maxPages = 20 } = {}) {
  return withPdf(data, async (doc) => {
    const pages = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) pages.push(await renderPage(doc, n, width));
    const gap = CONFIG.montageGap;
    const out = createCanvas(width, pages.reduce((s, c) => s + c.height, 0) + gap * (pages.length - 1));
    const ctx = ctx2d(out);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, out.width, out.height);
    let y = 0;
    for (const c of pages) {
      ctx.drawImage(c, 0, y);
      y += c.height + gap;
    }
    return { canvas: out, cover: pages[0], pageCount: doc.numPages };
  });
}

/** A JPEG of the whole PDF, for the image viewer and side-by-side comparisons. */
export async function pdfToImage(blob, width = 1400) {
  const { canvas } = await renderStack(blob, { width });
  return canvasToBlob(canvas, 'image/jpeg', 0.9);
}

/**
 * Text of the first pages, line by line, with each line's font height: the
 * same shape OCR returns, so the receipt parser reads both. Empty text means
 * a scanned PDF (pictures only).
 * @returns {Promise<{text: string, heights: Record<string, number>}>}
 */
export async function readText(doc, maxPages = 3) {
  const lines = [];
  const heights = {};
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    let line = '';
    let height = 0;
    const end = () => {
      const l = line.replace(/\s+/g, ' ').trim();
      if (l) {
        lines.push(l);
        heights[l] = Math.max(heights[l] || 0, height);
      }
      line = '';
      height = 0;
    };
    for (const item of items) {
      if (typeof item.str !== 'string') continue; // marked content
      line += item.str;
      height = Math.max(height, Math.abs(item.transform[3]));
      if (item.hasEOL) end();
    }
    end();
    page.cleanup();
  }
  return { text: lines.join('\n'), heights };
}
