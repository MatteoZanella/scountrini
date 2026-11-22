// Local OCR with Tesseract.js (Italian model). All files are served by the app
// itself, so OCR also works offline once cached. Results are only suggestions.

import { createCanvas, ctx2d } from '../imaging/canvas.js';
import { rowsFromLines } from './layout.js';

const BASE = new URL(import.meta.env.BASE_URL, location.href).href;
let workerPromise = null;
let queue = Promise.resolve();

function getWorker() {
  if (!workerPromise) {
    // Loaded on demand: keeps tesseract.js out of the startup bundle
    workerPromise = import('tesseract.js')
      .then(({ createWorker }) =>
        createWorker(
          'ita',
          1,
          {
            workerPath: `${BASE}vendor/tesseract/worker.min.js`,
            corePath: `${BASE}vendor/tesseract/core`,
            langPath: `${BASE}vendor/tesseract/lang`,
            gzip: true,
            workerBlobURL: false,
            cacheMethod: 'none', // files are already cached by the service worker
          },
          {
            // The Italian model asks for an optional "ita.special-words" list we do not ship
            user_words_suffix: '',
          },
        ),
      )
      .catch((e) => {
        workerPromise = null;
        throw e;
      });
  }
  return workerPromise;
}

/**
 * Recognizes the text of a canvas (downscaled for speed). Calls are serialized.
 * @returns {Promise<{text: string, heights: Record<string, number>}>} heights:
 *   row text → row height in pixels (the shop sign is usually printed larger).
 *   The text is rebuilt from the line positions: one printed row per line.
 */
export function recognize(canvas) {
  const job = queue.then(async () => {
    const s = Math.min(1, 1600 / canvas.width, Math.sqrt(5e6 / (canvas.width * canvas.height)));
    const c = createCanvas(canvas.width * s, canvas.height * s);
    const ctx = ctx2d(c);
    ctx.filter = 'grayscale(1)';
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    const worker = await getWorker();
    const { data } = await worker.recognize(c, {}, { text: true, blocks: true });
    const lines = (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    if (!lines.length) return { text: data.text || '', heights: {} };
    const rows = rowsFromLines(lines);
    return {
      text: rows.map((r) => r.text).join('\n'),
      heights: Object.fromEntries(rows.map((r) => [r.text, r.height])),
    };
  });
  queue = job.catch(() => {});
  return job;
}

export function warmUp() {
  getWorker().catch(() => {});
}
