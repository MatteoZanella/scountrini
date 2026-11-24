// The configured OneDrive destination folder (persisted per device), the
// invite links that carry it, and the folder waiting for a sign-in.

import { appBaseUrl, login } from './auth.js';
import { clearFolderCache } from './graph.js';
import { tenantForLink } from './tenant.js';

const KEY = 'scontrini.destination.v1';
const PENDING_LINK_KEY = 'scontrini.pendingInvite.v1';
const PENDING_OWN_KEY = 'scontrini.pendingOwnFolder.v1';
const INVITE_PARAM = 'cartella';

export const destination = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {
      return null;
    }
  },
  set(value) {
    localStorage.setItem(KEY, JSON.stringify(value));
    clearFolderCache();
  },
  clear() {
    localStorage.removeItem(KEY);
    clearFolderCache();
  },
};

/** Only OneDrive / SharePoint links are accepted from invites or input. */
export function isValidShareUrl(s) {
  try {
    const u = new URL(String(s).trim());
    return (
      u.protocol === 'https:' &&
      /(^|\.)(1drv\.ms|onedrive\.live\.com|onedrive\.com|sharepoint\.com|sharepoint-df\.com)$/i.test(u.hostname)
    );
  } catch {
    return false;
  }
}

/** Accepts a plain sharing link or a whole invite link; returns the sharing link. */
export function extractShareUrl(text) {
  const t = String(text || '').trim();
  try {
    return new URL(t).searchParams.get(INVITE_PARAM)?.trim() || t;
  } catch {
    return t;
  }
}

export function buildInviteUrl(shareUrl) {
  const u = new URL(appBaseUrl());
  u.searchParams.set(INVITE_PARAM, shareUrl);
  return u.href;
}

/**
 * Reads an invite from the current URL, stashes it (it must survive the login
 * redirect) and removes it from the address bar.
 */
export function captureInviteFromUrl() {
  const url = new URL(location.href);
  const link = url.searchParams.get(INVITE_PARAM);
  if (!link) return;
  if (isValidShareUrl(link)) pendingLink.set(link);
  url.searchParams.delete(INVITE_PARAM);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/** Folder link to connect once signed in (it must survive the login redirect). */
export const pendingLink = {
  get: () => localStorage.getItem(PENDING_LINK_KEY),
  set: (link) => localStorage.setItem(PENDING_LINK_KEY, link),
  clear: () => localStorage.removeItem(PENDING_LINK_KEY),
};

/** Path in the user's own OneDrive to use once signed in. */
export const pendingOwnFolder = {
  get: () => localStorage.getItem(PENDING_OWN_KEY),
  set: (path) => localStorage.setItem(PENDING_OWN_KEY, path),
  clear: () => localStorage.removeItem(PENDING_OWN_KEY),
};

/**
 * Signs in through the organization that owns the folder at `link` (the
 * default sign-in if it is not a valid link); the folder connects on return.
 */
export async function signInForFolder(link) {
  const tenantId = isValidShareUrl(link) ? await tenantForLink(link).catch(() => undefined) : undefined;
  pendingOwnFolder.clear();
  if (tenantId) pendingLink.set(link);
  return login({ tenantId });
}
