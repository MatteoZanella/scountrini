// Builds the (Italian) metadata embedded in every archived document and
// writes it into the file: EXIF + XMP for images, Info + XMP for PDFs.

import { CONFIG } from '../config.js';
import { formatDateIT, toExifDate, toExifOffset, toLocalISOString, parseISODate } from '../core/dates.js';
import { brancaLabel } from '../core/branche.js';
import { buildExif } from './exif.js';
import { buildXmp } from './xmp.js';
import { muxJpeg, muxWebp } from './containers.js';
import { writePdfMetadata } from '../pdf/write.js';

/**
 * @typedef {object} DocumentInfo
 * @property {string} id            unique document id
 * @property {string} date          YYYY-MM-DD, date of the purchase
 * @property {string} [time]        HH:MM printed on the receipt, if known
 * @property {string} merchant
 * @property {string} branca
 * @property {string} year          associative year folder, e.g. "2026-2027"
 * @property {string} userName
 * @property {string} [account]     Microsoft account (username/email)
 * @property {string} device
 * @property {{lat:number, lon:number}|null} [gps]
 * @property {string} [amount]      "12,34"
 * @property {string} [notes]
 * @property {number} pageCount     photos and PDF files it was made from
 * @property {number} [pdfPages]    pages of the archived PDF (PDF documents only)
 * @property {string} composition   human readable, e.g. "3 foto unite automaticamente"
 * @property {Date}   createdAt
 */

/** @param {DocumentInfo} d */
function describeDocument(d) {
  const title = `Scontrino ${d.merchant} del ${formatDateIT(d.date)}${d.time ? ` alle ${d.time}` : ''}`;
  const description = [
    title,
    `Branca: ${brancaLabel(d.branca)}`,
    `Anno associativo: ${d.year}`,
    d.amount ? `Importo: € ${d.amount}` : null,
    `Caricato da: ${d.userName}`,
    d.notes ? `Note: ${d.notes}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return { title, description };
}

/** @param {DocumentInfo} d */
function buildMetadata(d) {
  const { title, description } = describeDocument(d);
  const purchase = parseISODate(d.date) || d.createdAt;
  // Without a printed time use noon: it keeps the date right in any time zone
  const [hh, mm] = d.time ? d.time.split(':').map(Number) : [12, 0];
  const purchaseAt = new Date(purchase.getFullYear(), purchase.getMonth(), purchase.getDate(), hh, mm, 0);
  const keywords = ['scontrino', brancaLabel(d.branca), d.year, d.merchant].filter(Boolean);
  const software = `${CONFIG.appName} ${CONFIG.version}`;

  const exif = buildExif({
    description,
    title,
    subject: `Scontrino ${brancaLabel(d.branca)} ${d.year}`,
    comment: description,
    keywords: keywords.join('; '),
    artist: d.userName,
    model: d.device,
    software,
    modifyDate: toExifDate(d.createdAt),
    dateTimeOriginal: toExifDate(purchaseAt),
    dateTimeDigitized: toExifDate(d.createdAt),
    offsetTime: toExifOffset(d.createdAt),
    userComment: description,
    gps: d.gps,
  });

  const xmp = buildXmp({
    title,
    description,
    creator: d.userName,
    keywords,
    createDate: toLocalISOString(d.createdAt),
    creatorTool: software,
    dateCreated: d.time ? `${d.date}T${d.time}` : d.date,
    gps: d.gps,
    custom: {
      TipoDocumento: 'Scontrino / documento fiscale',
      DataOperazione: d.time ? `${d.date} ${d.time}` : d.date,
      Esercente: d.merchant,
      Importo: d.amount ? `€ ${d.amount}` : '',
      Branca: brancaLabel(d.branca),
      AnnoAssociativo: d.year,
      Compilatore: d.userName,
      AccountMicrosoft: d.account || '',
      Dispositivo: d.device,
      DataAcquisizione: toLocalISOString(d.createdAt),
      Posizione: d.gps ? `${d.gps.lat.toFixed(6)}, ${d.gps.lon.toFixed(6)}` : 'non disponibile',
      NumeroFoto: d.pdfPages ? '' : String(d.pageCount), // empty values are left out
      NumeroPagine: d.pdfPages ? String(d.pdfPages) : '',
      Composizione: d.composition,
      Note: d.notes || '',
      IdDocumento: d.id,
      Applicazione: software,
    },
  });
  return { exif, xmp, title, description, keywords, software };
}

/**
 * @param {{bytes: Uint8Array, mime: string}} encoded
 * @param {{width:number, height:number}} size  pixels (images only)
 * @param {DocumentInfo} info
 * @returns {Promise<Blob>}
 */
export async function embedMetadata(encoded, size, info) {
  const m = buildMetadata(info);
  let bytes;
  if (encoded.mime === 'application/pdf') {
    bytes = await writePdfMetadata(encoded.bytes, {
      title: m.title,
      subject: m.description,
      author: info.userName,
      keywords: [m.keywords.join('; ')], // pdf-lib joins with spaces: names have spaces too
      software: m.software,
      createdAt: info.createdAt,
      xmp: m.xmp,
    });
  } else if (encoded.mime === 'image/webp') {
    bytes = muxWebp(encoded.bytes, { width: size.width, height: size.height, exif: m.exif, xmp: m.xmp });
  } else {
    bytes = muxJpeg(encoded.bytes, { exif: m.exif, xmp: m.xmp });
  }
  return new Blob([bytes], { type: encoded.mime });
}
