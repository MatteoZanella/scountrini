// Microsoft sign-in with MSAL (authorization code + PKCE, redirect flow).
// Tokens are cached in localStorage so users stay signed in across launches.
// Redirect (not popup) is used because popups are unreliable in installed PWAs.

import { PublicClientApplication, InteractionRequiredAuthError, BrowserAuthError } from '@azure/msal-browser';
import { CONFIG } from '../config.js';
import { AuthRequiredError, OfflineError } from './errors.js';
import { authorityFor } from './tenant.js';

let pca = null;
let loginError = null;

/** Absolute URL of the app root: must be registered as SPA redirect URI. */
export function appBaseUrl() {
  const u = new URL(import.meta.env.BASE_URL, location.href);
  u.search = '';
  u.hash = '';
  return u.href;
}

export function isAuthConfigured() {
  return Boolean(CONFIG.msal.clientId) && !CONFIG.msal.clientId.startsWith('INSERISCI');
}

export async function initAuth() {
  if (!isAuthConfigured()) return null;
  pca = new PublicClientApplication({
    auth: {
      clientId: CONFIG.msal.clientId,
      authority: authorityFor(),
      redirectUri: appBaseUrl(),
      postLogoutRedirectUri: appBaseUrl(),
      navigateToLoginRequestUrl: false,
    },
    cache: { cacheLocation: 'localStorage' },
  });
  await pca.initialize();
  try {
    const res = await pca.handleRedirectPromise();
    if (res?.account) pca.setActiveAccount(res.account);
  } catch (e) {
    console.warn('Login redirect failed', e);
    loginError = e;
  }
  if (!pca.getActiveAccount()) {
    const [first] = pca.getAllAccounts();
    if (first) pca.setActiveAccount(first);
  }
  return getAccount();
}

export function getAccount() {
  const a = pca?.getActiveAccount();
  return a ? { name: a.name || a.username, username: a.username, tenantId: a.tenantId } : null;
}

/** The error of the sign-in just returned from, if it failed (read once). */
export function takeLoginError() {
  const e = loginError;
  loginError = null;
  return e;
}

/** Signs in through the organization `tenantId` (the one that owns the folder). */
export function login({ tenantId } = {}) {
  return pca.loginRedirect({ scopes: CONFIG.scopes, prompt: 'select_account', authority: authorityFor(tenantId) });
}

export function reauthenticate() {
  const account = pca.getActiveAccount();
  return pca.acquireTokenRedirect({
    scopes: CONFIG.scopes,
    account,
    loginHint: account?.username,
    // Tokens come from the account's organization: only it reaches its folders
    authority: authorityFor(account?.tenantId),
  });
}

export function logout() {
  return pca.logoutRedirect({ account: pca.getActiveAccount(), postLogoutRedirectUri: appBaseUrl() });
}

/** Silent token acquisition; never triggers navigation. */
export async function getAccessToken() {
  const account = pca?.getActiveAccount();
  if (!account) throw new AuthRequiredError('Non hai effettuato l’accesso');
  try {
    return (await pca.acquireTokenSilent({ scopes: CONFIG.scopes, account, authority: authorityFor(account.tenantId) }))
      .accessToken;
  } catch (e) {
    if (!navigator.onLine) throw new OfflineError();
    if (e instanceof InteractionRequiredAuthError || e instanceof BrowserAuthError) throw new AuthRequiredError();
    throw e;
  }
}
