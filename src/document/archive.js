// Turns the composed document + form data into a queued upload job.

import { CONFIG } from '../config.js';
import { associativeYear } from '../core/dates.js';
import { buildFileName, uuid } from '../core/naming.js';
import { jobs } from '../storage/db.js';
import { encodeFinal, makeThumbnail } from '../imaging/encode.js';
import { embedMetadata } from '../metadata/document-metadata.js';
import { stripJpegMetadata } from '../metadata/containers.js';

/** The archived file's bytes: the image encoded now, or the PDF already built. */
async function encode(composite) {
  if (composite.kind === 'pdf') return { bytes: composite.bytes, mime: 'application/pdf', ext: 'pdf' };
  return encodeFinal(composite.canvas, CONFIG.webpQuality);
}

/**
 * @param {object} p
 * @param {import('./compose.js').Composite} p.composite
 * @param {number} p.pageCount           photos and PDF files it was made from
 * @param {string} p.composition         see describeComposition
 * @param {{date:string, time?:string, merchant:string, branca:string, year?:string, amount?:string, notes?:string}} p.form
 * @param {{userName:string, account?:string, device:string}} p.author
 * @param {{lat:number, lon:number}|null} p.gps
 */
export async function archiveDocument({ composite, pageCount, composition, form, author, gps }) {
  const id = uuid();
  const year = form.year || associativeYear(form.date);
  const createdAt = new Date();
  const { canvas } = composite;
  const encoded = await encode(composite);
  const fileName = buildFileName({
    date: form.date,
    time: form.time,
    branca: form.branca,
    merchant: form.merchant,
    ext: encoded.ext,
  });

  const info = {
    id,
    date: form.date,
    time: form.time || '',
    merchant: form.merchant.trim(),
    branca: form.branca,
    year,
    amount: form.amount || '',
    notes: form.notes?.trim() || '',
    userName: author.userName,
    account: author.account,
    device: author.device,
    gps,
    pageCount,
    pdfPages: composite.pdfPages,
    composition,
    createdAt,
  };
  const blob = await embedMetadata(encoded, { width: canvas.width, height: canvas.height }, info);

  const job = {
    id,
    createdAt: createdAt.getTime(),
    status: 'pending',
    attempts: 0,
    folders: [year, form.branca],
    fileName, // may become name-2.webp (or .pdf) on upload if the name is taken
    mime: encoded.mime,
    blob,
    size: blob.size,
    thumb: await makeThumbnail(composite.cover || canvas, 240),
    date: form.date,
    merchant: form.merchant.trim(),
    branca: form.branca,
    year,
    amount: form.amount || '',
    width: canvas.width,
    height: canvas.height,
    meta: info, // kept to rewrite the metadata if the user corrects the data later
  };
  await jobs.put(job);
  return job;
}

/**
 * Applies the user's decision on a name clash (see NameTakenError):
 * - 'same': it is the receipt already on OneDrive, so nothing is uploaded;
 * - 'copy': upload under the first free -2, -3, … name;
 * - 'edit': new date/time/merchant, so new metadata and a new file name.
 */
export async function resolveNameConflict(job, choice, changes = {}) {
  const { conflict } = job;
  if (choice === 'same') {
    return jobs.update(job.id, {
      status: 'done',
      uploadedAt: Date.now(),
      fileName: conflict.name,
      webUrl: conflict.webUrl,
      remoteId: conflict.id,
      blob: null,
      conflict: null,
      lastError: '',
    });
  }
  if (choice === 'copy')
    return jobs.update(job.id, { status: 'pending', allowCopy: true, conflict: null, lastError: '' });

  const meta = { ...job.meta, ...changes, merchant: changes.merchant.trim() };
  // Follow the new date into its associative year, unless the year was picked by hand
  const year = job.year === associativeYear(job.date) ? associativeYear(meta.date) : job.year;
  meta.year = year;
  let bytes = new Uint8Array(await job.blob.arrayBuffer());
  if (job.mime === 'image/jpeg') bytes = stripJpegMetadata(bytes); // the WebP muxer replaces metadata by itself
  const blob = await embedMetadata({ bytes, mime: job.mime }, { width: job.width, height: job.height }, meta);
  return jobs.update(job.id, {
    status: 'pending',
    blob,
    size: blob.size,
    meta,
    date: meta.date,
    merchant: meta.merchant,
    year,
    folders: [year, job.branca],
    fileName: buildFileName({
      date: meta.date,
      time: meta.time,
      branca: job.branca,
      merchant: meta.merchant,
      ext: job.fileName.split('.').pop(),
    }),
    allowCopy: false,
    conflict: null,
    lastError: '',
  });
}
