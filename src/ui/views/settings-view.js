// "Impostazioni": device checklist, profile, destination folder + invites,
// capture options, account, help and local storage info.

import { CONFIG } from '../../config.js';
import { formatBytes } from '../../core/format.js';
import { settings } from '../../core/settings.js';
import { brancaOptions } from '../../core/branche.js';
import { jobs, storageEstimate } from '../../storage/db.js';
import { getAccount, login, logout } from '../../cloud/auth.js';
import { buildInviteUrl, destination, isValidShareUrl } from '../../cloud/destination.js';
import { wifiDetectionSupported } from '../../cloud/upload-queue.js';
import { renderDeviceCheck, watchDeviceCheck } from '../device-check.js';
import { applyTheme } from '../theme.js';
import { $, h, show, toast, confirmDialog, copyText, segmented } from '../dom.js';

const els = {
  name: $('#s-name'),
  device: $('#s-device'),
  target: $('#s-target'),
  account: $('#s-account'),
  storage: $('#s-storage'),
  location: $('#s-location'),
  ocr: $('#s-ocr'),
  wifi: $('#s-wifi'),
  wifiNote: $('#wifi-note'),
  intensity: $('#s-intensity'),
  openFolder: $('#s-open-folder'),
  about: $('#about'),
  checks: $('#s-checks'),
  checkSummary: $('#s-check-summary'),
};

const brancaControl = segmented($('#s-branca'), brancaOptions(), {
  onChange: (v) => settings.set('branca', v),
});

const themeControl = segmented(
  $('#s-theme'),
  [
    { value: 'auto', label: 'Automatico' },
    { value: 'light', label: 'Chiaro' },
    { value: 'dark', label: 'Scuro' },
  ],
  {
    onChange: (v) => {
      settings.set('theme', v);
      applyTheme(v);
    },
  },
);

const syncSlider = () => els.intensity.style.setProperty('--fill', `${els.intensity.value}%`);

const kv = (rows) => rows.filter(Boolean).map(([k, v]) => h('div.kv-row', {}, h('span', {}, k), h('b', {}, v || '—')));

async function shareInvite(shareUrl) {
  const url = buildInviteUrl(shareUrl);
  const data = {
    title: CONFIG.appName,
    text: 'Apri questo link e accedi con il tuo account Microsoft per caricare gli scontrini:',
    url,
  };
  try {
    if (navigator.share) return await navigator.share(data);
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  await copyText(url, { title: 'Link di invito', success: 'Link di invito copiato' });
}

async function invite() {
  const dest = destination.get();
  if (!dest) return;
  if (dest.kind === 'share' && dest.shareUrl) return shareInvite(dest.shareUrl);
  // Own folder: a sharing link is needed for others
  const input = h('input', { type: 'url', placeholder: 'https://1drv.ms/f/…', value: dest.shareUrl || '' });
  const body = h(
    'div',
    {},
    h(
      'p',
      {},
      'In OneDrive, condividi la cartella con le persone da invitare (Condividi → Può modificare), copia il link e incollalo qui:',
    ),
    input,
  );
  const ok = await confirmDialog({ title: 'Invita qualcuno', body, ok: 'Crea invito' });
  if (!ok) return;
  if (!isValidShareUrl(input.value)) return toast('Link di condivisione non valido', { type: 'error' });
  destination.set({ ...dest, shareUrl: input.value.trim() });
  shareInvite(input.value.trim());
}

export async function renderSettings() {
  renderDeviceCheck(els.checks, els.checkSummary);
  els.name.value = settings.get('userName');
  els.device.value = settings.get('deviceName');
  brancaControl.set(settings.get('branca'));
  els.location.checked = settings.get('saveLocation');
  els.ocr.checked = settings.get('autoOcr');
  els.wifi.checked = settings.get('wifiOnly');
  els.wifi.disabled = !wifiDetectionSupported();
  els.wifiNote.textContent = wifiDetectionSupported()
    ? 'Altrimenti usa anche la rete dati'
    : 'Non supportato da questo browser: si carica con qualsiasi rete';
  els.intensity.value = settings.get('defaultIntensity');
  syncSlider();
  themeControl.set(settings.get('theme'));

  const dest = destination.get();
  els.target.replaceChildren(
    ...kv([
      ['Cartella', dest?.name],
      dest?.owner ? ['Proprietario', dest.owner] : null,
      ['Tipo', dest ? (dest.kind === 'share' ? 'Condivisa con me' : 'Nel mio OneDrive') : ''],
    ]),
  );
  show(els.openFolder, Boolean(dest?.webUrl));
  if (dest?.webUrl) els.openFolder.href = dest.webUrl;

  const account = getAccount();
  els.account.replaceChildren(
    ...kv([
      ['Nome', account?.name],
      ['Account', account?.username],
    ]),
  );

  const [est, all] = await Promise.all([storageEstimate(), jobs.all()]);
  const local = all.reduce((s, j) => s + (j.blob?.size || 0), 0);
  els.storage.replaceChildren(
    ...kv([
      ['Scontrini nel registro', String(all.length)],
      ['File in attesa sul telefono', formatBytes(local)],
      est.usage != null ? ['Spazio usato dall’app', formatBytes(est.usage)] : null,
    ]),
  );
  els.about.textContent = `${CONFIG.appName} ${CONFIG.version} · cartelle: ${dest?.name || 'scontrini'}/ANNO/BRANCA`;
}

export function initSettings({ onChangeFolder }) {
  const bindText = (el, key) => el.addEventListener('change', () => settings.set(key, el.value.trim()));
  bindText(els.name, 'userName');
  bindText(els.device, 'deviceName');
  els.location.addEventListener('change', () => settings.set('saveLocation', els.location.checked));
  els.ocr.addEventListener('change', () => settings.set('autoOcr', els.ocr.checked));
  els.wifi.addEventListener('change', () => settings.set('wifiOnly', els.wifi.checked));
  els.intensity.addEventListener('input', () => {
    settings.set('defaultIntensity', +els.intensity.value);
    syncSlider();
  });

  watchDeviceCheck(els.checks, els.checkSummary);
  $('#btn-invite').addEventListener('click', invite);
  $('#btn-copy-account').addEventListener('click', () => {
    const address = getAccount()?.username;
    if (address) copyText(address, { title: 'Il tuo indirizzo', success: 'Indirizzo copiato' });
  });
  // Pending uploads stay in the queue and go out with the new account
  $('#btn-switch-account').addEventListener('click', () => login());
  $('#btn-change-folder').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Cambiare cartella?',
      body: 'Gli scontrini ancora in coda verranno caricati nella nuova cartella.',
      ok: 'Cambia',
    });
    if (!ok) return;
    destination.clear();
    onChangeFolder();
  });
  $('#btn-logout').addEventListener('click', async () => {
    const pending = (await jobs.all()).filter((j) => j.status !== 'done').length;
    const ok = await confirmDialog({
      title: 'Uscire dall’account?',
      body: pending
        ? `Hai ${pending} scontrini non ancora caricati: restano sul telefono e verranno caricati al prossimo accesso.`
        : 'Dovrai accedere di nuovo per caricare scontrini.',
      ok: 'Esci',
      danger: true,
    });
    if (ok) logout();
  });
}
