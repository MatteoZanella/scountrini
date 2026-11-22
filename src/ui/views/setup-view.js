// First-run setup: sign in → link the shared folder → name and branca.

import { CONFIG } from '../../config.js';
import { settings } from '../../core/settings.js';
import { brancaOptions } from '../../core/branche.js';
import { isIOS, isStandalone } from '../../core/device.js';
import { getAccount, isAuthConfigured, login } from '../../cloud/auth.js';
import { resolveOwnFolder, resolveShareLink } from '../../cloud/graph.js';
import { destination, extractShareUrl, isValidShareUrl, pendingInvite } from '../../cloud/destination.js';
import { describeError, isAccessDenied } from '../../cloud/errors.js';
import { showAccessRequest } from '../access-request.js';
import { withBusy } from '../busy.js';
import { $, h, icon, show, toast, copyText, segmented } from '../dom.js';

const els = {
  stepLogin: $('#step-login'),
  stepFolder: $('#step-folder'),
  stepProfile: $('#step-profile'),
  loginDone: $('#login-done'),
  folderDone: $('#folder-done'),
  configError: $('#setup-config-error'),
  btnLogin: $('#btn-login'),
  share: $('#setup-share'),
  ownPath: $('#setup-own-path'),
  name: $('#setup-name'),
  iosInstall: $('#setup-ios-install'),
  iosCopyRow: $('#setup-ios-copy-row'),
  iosPasteNote: $('#setup-ios-paste-note'),
  btnSwitch: $('#btn-setup-switch'),
  btnPaste: $('#btn-paste-share'),
  accountHint: $('#setup-account-hint'),
};

let onComplete = () => {};

const brancaControl = segmented($('#setup-branca'), brancaOptions(), {
  onChange: (v) => settings.set('branca', v),
});

export function isSetupComplete() {
  return Boolean(getAccount() && destination.get() && settings.get('userName') && settings.get('branca'));
}

function setStep(el, stateName) {
  el.classList.remove('done', 'active', 'locked');
  el.classList.add(stateName);
}

function doneLine(container, text) {
  container.replaceChildren(h('span.done-check', {}, icon('check')), h('span', {}, text));
}

/** Link the user must paste into the installed app (iOS loses it on install). */
const inviteLink = () => pendingInvite.get() || els.share.value.trim();

export function renderSetup() {
  const account = getAccount();
  const dest = destination.get();
  show(els.configError, !isAuthConfigured());
  els.btnLogin.disabled = !isAuthConfigured();

  // iOS: a home-screen app has its own storage, separate from Safari. Signing
  // in here first would be wasted, so suggest installing before anything else.
  const iosBrowser = isIOS() && !isStandalone();
  show(els.iosInstall, iosBrowser && !dest);
  show(els.iosCopyRow, iosBrowser && isValidShareUrl(inviteLink()));
  show(els.iosPasteNote, iosBrowser && isValidShareUrl(inviteLink()));

  setStep(els.stepLogin, account ? 'done' : 'active');
  if (account) doneLine(els.loginDone, `Connesso come ${account.name} (${account.username})`);
  show(els.btnSwitch, Boolean(account) && !dest);

  setStep(els.stepFolder, !account ? 'locked' : dest ? 'done' : 'active');
  if (dest) doneLine(els.folderDone, `Cartella “${dest.name}”${dest.owner ? ` di ${dest.owner}` : ''}`);
  if (!els.share.value) els.share.value = pendingInvite.get() || CONFIG.defaultShareUrl || '';
  show(els.btnPaste, Boolean(navigator.clipboard?.readText));
  show(els.accountHint, Boolean(account) && !dest);
  if (account && !dest) {
    els.accountHint.replaceChildren(
      h('span', {}, 'Non hai il link? Chiedi a chi gestisce la cartella di condividerla con '),
      h('b', {}, account.username),
      h('span', {}, ' (permesso “Può modificare”) e di mandarti il link. '),
      h(
        'button.link',
        {
          type: 'button',
          onclick: () => copyText(account.username, { title: 'Il tuo indirizzo', success: 'Indirizzo copiato' }),
        },
        'Copia indirizzo',
      ),
    );
  }

  setStep(els.stepProfile, account && dest ? 'active' : 'locked');
  if (!els.name.value) els.name.value = settings.get('userName') || account?.name || '';
  brancaControl.set(settings.get('branca'));
}

async function linkDestination(resolver, label, { shareUrl } = {}) {
  try {
    const dest = await withBusy(label, resolver);
    destination.set(dest);
    pendingInvite.clear();
    toast(`Cartella “${dest.name}” collegata`, { type: 'success' });
  } catch (e) {
    console.error(e);
    if (shareUrl && isAccessDenied(e)) {
      renderSetup();
      return showAccessRequest({ shareUrl });
    }
    toast(`Impossibile collegare la cartella: ${describeError(e, { account: getAccount()?.username })}`, {
      type: 'error',
      timeout: 9000,
    });
  }
  renderSetup();
}

export function initSetup({ onDone }) {
  onComplete = onDone;
  els.btnLogin.addEventListener('click', () => login());
  els.btnSwitch.addEventListener('click', () => login());
  $('#btn-copy-invite').addEventListener('click', () =>
    copyText(inviteLink(), { title: 'Link della cartella', success: 'Link copiato: incollalo nell’app installata' }),
  );
  els.btnPaste.addEventListener('click', async () => {
    try {
      const link = extractShareUrl(await navigator.clipboard.readText());
      els.share.value = link;
      if (!isValidShareUrl(link)) toast('Negli appunti non c’è un link OneDrive', { type: 'error' });
    } catch {
      toast('Non riesco a leggere gli appunti: tieni premuto nel campo e scegli Incolla');
    }
  });

  $('#btn-link-share').addEventListener('click', () => {
    const url = extractShareUrl(els.share.value);
    els.share.value = url;
    if (!isValidShareUrl(url)) {
      toast('Incolla un link di condivisione OneDrive valido (https://1drv.ms/… o onedrive.live.com/…)', {
        type: 'error',
        timeout: 6000,
      });
      els.share.focus();
      return;
    }
    linkDestination(() => resolveShareLink(url), 'Collego la cartella condivisa…', { shareUrl: url });
  });

  $('#btn-link-own').addEventListener('click', () =>
    linkDestination(() => resolveOwnFolder(els.ownPath.value), 'Preparo la cartella…'),
  );

  $('#btn-setup-done').addEventListener('click', () => {
    const name = els.name.value.trim();
    if (!name) {
      toast('Scrivi il tuo nome', { type: 'error' });
      els.name.focus();
      return;
    }
    if (!settings.get('branca')) {
      toast('Scegli la tua branca', { type: 'error' });
      return;
    }
    settings.set('userName', name);
    onComplete();
  });
}

/** After login, an invite link (if any) is resolved automatically. */
export async function autoLinkPendingInvite() {
  const link = pendingInvite.get();
  if (!link || !getAccount()) return;
  if (destination.get()?.shareUrl === link) {
    pendingInvite.clear();
    return;
  }
  await linkDestination(() => resolveShareLink(link), 'Collego la cartella dell’invito…', { shareUrl: link });
}
