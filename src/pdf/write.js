// Writing PDFs with pdf-lib: merges PDF files and photos into one document
// and stores the archive metadata in it. Loaded on first use.

import { canvasToBlob } from '../imaging/canvas.js';

const lib = () => import('@cantoo/pdf-lib');

const A4_WIDTH = 595.28; // pt: photos become pages as wide as an A4 sheet
const MAX_SIDE = 14400; // pt: the largest page PDF readers accept

/** Loads a source PDF; encrypted ones only open when the password is empty (owner-locked). */
async function loadSource(PDFDocument, bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (!doc.isEncrypted) return doc;
  try {
    return await PDFDocument.load(bytes, { password: '', updateMetadata: false });
  } catch (e) {
    throw new Error('Il PDF è protetto da password: toglila e riprova', { cause: e });
  }
}

/**
 * One PDF from the parts, in order: every page of each PDF, then one page
 * per photo (or per group of photos already joined into one image).
 * @param {({kind: 'pdf', bytes: Uint8Array} | {kind: 'image', canvas: HTMLCanvasElement})[]} parts
 * @returns {Promise<{bytes: Uint8Array, pageCount: number}>}
 */
export async function buildPdf(parts) {
  const { PDFDocument } = await lib();
  const out = await PDFDocument.create();
  for (const part of parts) {
    if (part.kind === 'pdf') {
      const src = await loadSource(PDFDocument, part.bytes);
      for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
    } else {
      const { width, height } = part.canvas;
      const jpeg = await canvasToBlob(part.canvas, 'image/jpeg', 0.85);
      const image = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
      const k = Math.min(A4_WIDTH / width, MAX_SIDE / height); // long receipts: one tall page
      const [w, h] = [width * k, height * k];
      out.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
    }
  }
  return { bytes: await out.save(), pageCount: out.getPageCount() };
}

/**
 * Replaces the document properties (Info dictionary) and the XMP packet.
 * @param {Uint8Array} bytes  a PDF made by buildPdf
 * @param {{title: string, subject: string, author: string, keywords: string[], software: string,
 *   createdAt: Date, xmp: string}} m
 */
export async function writePdfMetadata(bytes, m) {
  const { PDFDocument, PDFName } = await lib();
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.setTitle(m.title, { showInWindowTitleBar: true });
  doc.setSubject(m.subject);
  doc.setAuthor(m.author);
  doc.setKeywords(m.keywords);
  doc.setCreator(m.software);
  doc.setProducer(m.software);
  doc.setCreationDate(m.createdAt);
  doc.setModificationDate(new Date());
  doc.setLanguage('it-IT');
  const xmp = doc.context.stream(new TextEncoder().encode(m.xmp), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
  return doc.save();
}
