// "Registro": what has been saved on this device and whether it reached OneDrive.

import { formatDateIT, formatDateTimeIT } from '../../core/dates.js';
import { brancaLabel } from '../../core/branche.js';
import { jobs } from '../../storage/db.js';
import { uploadQueue } from '../../cloud/upload-queue.js';
import { destination } from '../../cloud/destination.js';
import { showAccessRequest } from '../access-request.js';
import { showNameConflict } from '../name-conflict.js';
import { openViewer } from '../viewer.js';
import { $, h, icon, show, toast, confirmDialog } from '../dom.js';

const els = {
  list: $('#log-list'),
  retryAll: $('#btn-retry-all'),
  filter: $('#log-filter'),
  clearDone: $('#btn-clear-done'),
  note: $('#log-note'),
};

let filter = 'all';
const thumbUrls = [];

const STATUS = {
  pending: { label: 'In coda', icon: 'upload', cls: 'pending' },
  uploading: { label: 'Caricamento…', icon: 'upload', cls: 'uploading' },
  done: { label: 'Caricato', icon: 'cloud-check', cls: 'done' },
  error: { label: 'Errore', icon: 'alert', cls: 'error' },
  conflict: { label: 'Da controllare', icon: 'alert', cls: 'error' },
};

export function summarize(list) {
  const s = { pending: 0, uploading: 0, done: 0, error: 0, conflict: 0 };
  for (const j of list) s[j.status] = (s[j.status] || 0) + 1;
  return s;
}

function download(job) {
  const a = h('a', { href: URL.createObjectURL(job.blob), download: job.fileName });
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

async function remove(job) {
  const notUploaded = job.status !== 'done';
  const ok = await confirmDialog({
    title: notUploaded ? 'Eliminare uno scontrino non caricato?' : 'Rimuovere dal registro?',
    body: notUploaded
      ? 'Il file non è ancora su OneDrive: eliminandolo andrà perso.'
      : 'Il file resta su OneDrive: viene tolto solo da questo elenco.',
    ok: notUploaded ? 'Elimina' : 'Rimuovi',
    danger: notUploaded,
  });
  if (!ok) return;
  await jobs.delete(job.id);
  uploadQueue.notifyChanged();
  render();
}

/** The one action that matters for this status, if any. */
function primaryAction(job) {
  if (job.status === 'conflict') {
    const review = async () => {
      if (!(await showNameConflict(job))) return;
      uploadQueue.notifyChanged();
      uploadQueue.kick(true);
      render();
    };
    return h('button.btn.small.primary', { type: 'button', onclick: review }, icon('eye'), 'Controlla');
  }
  if (job.status === 'error' && job.accessDenied && destination.get()?.kind === 'share') {
    const ask = () => showAccessRequest({ shareUrl: destination.get().shareUrl });
    return h('button.btn.small', { type: 'button', onclick: ask }, icon('user'), 'Chiedi accesso');
  }
  if (job.webUrl) {
    return h(
      'a.link',
      { href: job.webUrl, target: '_blank', rel: 'noopener noreferrer' },
      icon('external'),
      'Apri su OneDrive',
    );
  }
  return null;
}

function statusText(job) {
  if (job.status === 'done') return `Caricato il ${formatDateTimeIT(job.uploadedAt)}`;
  if (job.status === 'uploading') return 'Caricamento in corso…';
  if (job.status === 'pending') return 'In coda: parte appena c’è connessione';
  return job.lastError || STATUS[job.status]?.label || '';
}

function item(job) {
  const st = STATUS[job.status] || STATUS.pending;
  const thumb = job.thumb ? URL.createObjectURL(job.thumb) : null;
  if (thumb) thumbUrls.push(thumb);
  const title = job.merchant || 'Documento';
  const meta = [formatDateIT(job.date), brancaLabel(job.branca), job.amount && `€ ${job.amount}`].filter(Boolean);
  const action = primaryAction(job);

  return h(
    'li.log-item',
    { dataset: { status: job.status } },
    h(
      'button.log-thumb',
      {
        type: 'button',
        'aria-label': `Anteprima di ${title}`,
        onclick: () =>
          (job.blob || job.thumb) && openViewer(job.blob || job.thumb, `${title} · ${formatDateIT(job.date)}`),
      },
      thumb ? h('img', { src: thumb, alt: '' }) : icon('receipt'),
    ),
    h(
      'div.log-main',
      {},
      h('strong.log-title', {}, title),
      h('div.log-meta', {}, meta.join(' · ')),
      h(`p.log-status.${st.cls}`, {}, icon(st.icon), h('span', {}, statusText(job))),
      action ? h('div.log-action', {}, action) : null,
    ),
    h(
      'div.log-side',
      {},
      job.blob
        ? h(
            'button.icon-btn',
            { type: 'button', 'aria-label': `Scarica ${title}`, title: 'Scarica', onclick: () => download(job) },
            icon('download'),
          )
        : null,
      job.status === 'done'
        ? h(
            'button.icon-btn',
            {
              type: 'button',
              'aria-label': `Togli ${title} dal registro (resta su OneDrive)`,
              title: 'Togli dal registro',
              onclick: () => remove(job),
            },
            icon('archive'),
          )
        : h(
            'button.icon-btn',
            { type: 'button', 'aria-label': `Elimina ${title}`, title: 'Elimina', onclick: () => remove(job) },
            icon('trash'),
          ),
    ),
  );
}

export async function render() {
  const all = await jobs.all();
  thumbUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  const s = summarize(all);
  const counts = { all: all.length, todo: all.length - s.done, done: s.done };
  for (const b of els.filter.children) b.querySelector('.count').textContent = String(counts[b.dataset.filter]);
  show(els.retryAll, s.pending + s.error > 0);
  const shown = all.filter((j) => filter === 'all' || (filter === 'done' ? j.status === 'done' : j.status !== 'done'));
  els.list.replaceChildren(
    ...(shown.length
      ? shown.map(item)
      : [
          h(
            'li.log-empty',
            {},
            filter === 'todo' ? 'Tutto caricato' : 'Nessuno scontrino salvato su questo dispositivo',
          ),
        ]),
  );
  show(els.clearDone, s.done > 0);
  show(els.note, s.done > 0);
}

export function initLog() {
  els.filter.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    for (const x of els.filter.children) {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    }
    render();
  });
  $('#btn-retry-all').addEventListener('click', () => {
    if (!navigator.onLine) return toast('Sei offline: riproverò appena torna la rete', { type: 'warn' });
    uploadQueue.kick(true);
    toast('Caricamento avviato');
  });
  els.clearDone.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Rimuovere i caricati dal registro?',
      body: 'I file restano su OneDrive.',
      ok: 'Rimuovi',
    });
    if (!ok) return;
    for (const j of await jobs.all()) if (j.status === 'done') await jobs.delete(j.id);
    uploadQueue.notifyChanged();
    render();
  });
}
