// First-run setup: folder link → sign in through the folder's organization →
// name and branca. The link decides which Microsoft sign-in is needed.

import { CONFIG } from '../../config.js';
import { settings } from '../../core/settings.js';
import { brancaOptions } from '../../core/branche.js';
import { isIOS, isStandalone } from '../../core/device.js';
import { getAccount, isAuthConfigured, login, takeLoginError } from '../../cloud/auth.js';
import { resolveOwnFolder, resolveShareLink } from '../../cloud/graph.js';
import { tenantForLink } from '../../cloud/tenant.js';
import {
  destination,
  extractShareUrl,
  isValidShareUrl,
  pendingLink,
  pendingOwnFolder,
  signInForFolder,
} from '../../cloud/destination.js';
import { describeError, describeLoginError, isAccessDenied } from '../../cloud/errors.js';
import { showAccessRequest } from '../access-request.js';
import { withBusy } from '../busy.js';
import { $, h, icon, show, toast, copyText, segmented } from '../dom.js';

const els = {
  stepFolder: $('#step-folder'),
  stepProfile: $('#step-profile'),
  folderDone: $('#folder-done'),
  configError: $('#setup-config-error'),
  btnLinkShare: $('#btn-link-share'),
  btnLinkOwn: $('#btn-link-own'),
  accountRow: $('#setup-account'),
  accountName: $('#setup-account-name'),
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
const inviteLink = () => pendingLink.get() || els.share.value.trim();

export function renderSetup() {
  const account = getAccount();
  const dest = destination.get();
  show(els.configError, !isAuthConfigured());
  els.btnLinkShare.disabled = els.btnLinkOwn.disabled = !isAuthConfigured();

  // iOS: a home-screen app has its own storage, separate from Safari. Signing
  // in here first would be wasted, so suggest installing before anything else.
  const iosBrowser = isIOS() && !isStandalone();
  show(els.iosInstall, iosBrowser && !dest);
  show(els.iosCopyRow, iosBrowser && isValidShareUrl(inviteLink()));
  show(els.iosPasteNote, iosBrowser && isValidShareUrl(inviteLink()));

  setStep(els.stepFolder, account && dest ? 'done' : 'active');
  if (dest) doneLine(els.folderDone, `Cartella “${dest.name}”${dest.owner ? ` di ${dest.owner}` : ''}`);
  show(els.accountRow, Boolean(account));
  if (account) els.accountName.textContent = `Connesso come ${account.name} (${account.username}).`;
  if (!els.share.value) els.share.value = pendingLink.get() || dest?.shareUrl || CONFIG.defaultShareUrl || '';
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

const failToLink = (e) =>
  toast(`Impossibile collegare la cartella: ${describeError(e, { account: getAccount()?.username })}`, {
    type: 'error',
    timeout: 9000,
  });

async function linkDestination(resolver, label, { shareUrl } = {}) {
  try {
    const dest = await withBusy(label, resolver);
    destination.set({ ...dest, tenantId: getAccount()?.tenantId });
    pendingLink.clear();
    pendingOwnFolder.clear();
    toast(`Cartella “${dest.name}” collegata`, { type: 'success' });
  } catch (e) {
    console.error(e);
    if (shareUrl && isAccessDenied(e)) {
      renderSetup();
      return showAccessRequest({ shareUrl });
    }
    failToLink(e);
  }
  renderSetup();
}

/**
 * Links the shared folder at `url` with an account of the organization that
 * owns it. If the signed-in account is from another one (or there is none),
 * `interactive` signs in there first and the folder connects on return;
 * otherwise the link just stays in the field.
 */
async function connectShare(url, { interactive }) {
  let tenantId;
  try {
    tenantId = await withBusy('Cerco la cartella…', () => tenantForLink(url));
  } catch (e) {
    return failToLink(e);
  }
  if (getAccount()?.tenantId !== tenantId) return interactive ? signInForFolder(url) : renderSetup();
  await linkDestination(() => resolveShareLink(url), 'Collego la cartella condivisa…', { shareUrl: url });
}

export function initSetup({ onDone }) {
  onComplete = onDone;
  els.btnSwitch.addEventListener('click', () => signInForFolder(extractShareUrl(els.share.value)));
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
    connectShare(url, { interactive: true });
  });

  els.btnLinkOwn.addEventListener('click', () => {
    const path = els.ownPath.value;
    if (!getAccount()) {
      pendingOwnFolder.set(path);
      return login();
    }
    linkDestination(() => resolveOwnFolder(path), 'Preparo la cartella…');
  });

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

/**
 * On launch (and back from sign-in): reports a failed sign-in, then connects
 * the folder that was waiting for it, if the account can reach it.
 */
export async function resumeSetup() {
  const loginError = takeLoginError();
  if (loginError) {
    pendingOwnFolder.clear();
    toast(`Accesso non riuscito: ${describeLoginError(loginError)}`, { type: 'error', timeout: 12000 });
  }
  if (!getAccount()) return;
  const own = pendingOwnFolder.get();
  if (own != null) return linkDestination(() => resolveOwnFolder(own), 'Preparo la cartella…');
  const link = pendingLink.get();
  if (!link) return;
  if (destination.get()?.shareUrl === link) return pendingLink.clear();
  await connectShare(link, { interactive: false });
}
