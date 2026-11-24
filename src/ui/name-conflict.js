// "Nome già usato": a receipt with the same date, time and merchant is already
// on OneDrive but its image differs. Shows both and lets the user decide:
// same receipt (skip), correct the data (new name), or upload as a copy (-2).

import { parseISODate } from '../core/dates.js';
import { resolveNameConflict } from '../document/archive.js';
import { pdfToImage } from '../pdf/read.js';
import { $, h, icon, openDialog, toast } from './dom.js';

function figure(blob, caption, link) {
  const img = h('img', { alt: caption });
  const showBlob = (b) => {
    const url = URL.createObjectURL(b);
    img.onload = () => URL.revokeObjectURL(url);
    img.src = url;
  };
  if (blob.type === 'application/pdf') pdfToImage(blob, 720).then(showBlob, (e) => console.warn(e));
  else showBlob(blob);
  return h('figure.conflict-image', {}, img, h('figcaption', {}, caption, link ? [' · ', link] : null));
}

async function editData(job) {
  const field = (label, input) => h('label.field', {}, h('span.label', {}, label), input);
  const date = h('input', { type: 'date', value: job.meta.date, required: true });
  const time = h('input', { type: 'time', value: job.meta.time || '' });
  const merchant = h('input', { value: job.meta.merchant, maxlength: 60, autocapitalize: 'words' });
  const body = h(
    'div',
    {},
    h('p', {}, 'Il nome del file cambia di conseguenza.'),
    h('div.field-row', {}, field('Data', date), field('Ora', time)),
    field('Esercente', merchant),
  );
  if ((await openDialog({ title: 'Correggi i dati', body, ok: 'Salva e carica' })) !== 'ok') return false;
  if (!parseISODate(date.value) || !merchant.value.trim()) {
    toast('Servono almeno data ed esercente', { type: 'error' });
    return false;
  }
  await resolveNameConflict(job, 'edit', { date: date.value, time: time.value, merchant: merchant.value });
  return true;
}

/** Resolves to true when the job was changed (and the queue should run). */
export async function showNameConflict(job) {
  const { conflict } = job;
  const body = h(
    'div.name-conflict',
    {},
    h(
      'p',
      {},
      'Su OneDrive c’è già un file con lo stesso nome (stessa data, ora ed esercente), ma il contenuto è diverso. È lo stesso scontrino?',
    ),
    h(
      'div.conflict-images',
      {},
      figure(
        conflict.blob,
        'Già su OneDrive',
        conflict.webUrl && h('a.link', { href: conflict.webUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Apri'),
      ),
      figure(job.blob, 'Da caricare'),
    ),
    h(
      'div.conflict-choices',
      {},
      h('button.btn.block', { value: 'same' }, icon('check'), 'Sì, è lo stesso: non caricarlo'),
      job.meta ? h('button.btn.block', { value: 'edit' }, icon('edit'), 'No, correggi i dati') : null,
      h('button.btn.block', { value: 'copy' }, icon('upload'), 'No, caricalo come copia'),
    ),
    h('p.note', {}, `Il file già presente su OneDrive non viene mai sostituito né modificato.`),
  );
  const pending = openDialog({ title: 'Nome già usato', body, ok: null, cancel: 'Decido dopo' });
  $('#dialog-cancel').focus(); // a stray Enter must not skip the upload
  const choice = await pending;
  if (choice === 'edit') return editData(job);
  if (choice !== 'same' && choice !== 'copy') return false;
  await resolveNameConflict(job, choice);
  return true;
}
