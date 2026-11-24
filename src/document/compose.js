// Turns the pages of a document into what gets archived:
// - photos only → one image (the photos joined where they overlap);
// - any PDF     → one PDF: the PDFs' own pages, in order, and a page for each
//                 photo (photos taken one after the other and overlapping
//                 are still joined into a single page).

import { composeDocument } from '../imaging/stitch.js';
import { buildPdf } from '../pdf/write.js';
import { renderStack } from '../pdf/read.js';
import { getProcessedCanvas, isPdfPage } from './pages.js';

/**
 * @typedef {object} ImageComposite
 * @property {'image'} kind
 * @property {HTMLCanvasElement} canvas   the archived image
 * @property {number[][]} groups          stitching groups (page indices)
 *
 * @typedef {object} PdfComposite
 * @property {'pdf'} kind
 * @property {Uint8Array} bytes           the archived PDF (no metadata yet)
 * @property {number} pdfPages
 * @property {HTMLCanvasElement} canvas   preview: all pages one under the other
 * @property {HTMLCanvasElement} cover    first page, for thumbnails
 *
 * @typedef {ImageComposite | PdfComposite} Composite
 */

/** @returns {Promise<Composite>} */
export async function composePages(pages, onProgress = () => {}) {
  if (!pages.length) throw new Error('Nessuna pagina');
  if (!pages.some(isPdfPage)) {
    const canvases = [];
    for (const p of pages) canvases.push(await getProcessedCanvas(p));
    const { canvas, groups } = await composeDocument(canvases, onProgress);
    return { kind: 'image', canvas, groups };
  }

  const parts = [];
  let photos = [];
  const flushPhotos = async () => {
    if (!photos.length) return;
    const { parts: joined } = await composeDocument(photos, onProgress);
    parts.push(...joined.map((canvas) => ({ kind: 'image', canvas })));
    photos = [];
  };
  for (const p of pages) {
    if (isPdfPage(p)) {
      await flushPhotos();
      parts.push({ kind: 'pdf', bytes: new Uint8Array(await p.source.arrayBuffer()) });
    } else {
      photos.push(await getProcessedCanvas(p));
    }
  }
  await flushPhotos();
  onProgress('Creo il PDF…');
  const { bytes, pageCount } = await buildPdf(parts);
  const { canvas, cover } = await renderStack(bytes);
  return { kind: 'pdf', bytes, pdfPages: pageCount, canvas, cover };
}

/** Human readable, e.g. "3 foto unite automaticamente" or "PDF di 4 pagine (2 PDF e 1 foto)". */
export function describeComposition(pages, composite) {
  const n = pages.length;
  if (composite.kind === 'pdf') {
    const pdfs = pages.filter(isPdfPage).length;
    const photos = n - pdfs;
    const pagesText = composite.pdfPages === 1 ? '1 pagina' : `${composite.pdfPages} pagine`;
    if (!photos && pdfs === 1) return `PDF di ${pagesText}`;
    const from = [pdfs === 1 ? '1 PDF' : `${pdfs} PDF`, photos && `${photos} foto`].filter(Boolean).join(' e ');
    return `PDF di ${pagesText} (${from})`;
  }
  const { groups } = composite;
  if (n <= 1) return 'foto singola';
  const merged = groups.filter((g) => g.length > 1);
  if (groups.length === 1) return `${n} foto unite automaticamente`;
  if (!merged.length) return `${n} foto affiancate (nessuna parte in comune)`;
  const mergedCount = merged.reduce((s, g) => s + g.length, 0);
  return `${mergedCount} foto unite, ${groups.length} parti affiancate`;
}
