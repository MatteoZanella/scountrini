// Microsoft sign-in with MSAL (authorization code + PKCE, redirect flow).
// Tokens are cached in localStorage so users stay signed in across launches.
// Redirect (not popup) is used because popups are unreliable in installed PWAs.

import { PublicClientApplication, InteractionRequiredAuthError, BrowserAuthError } from '@azure/msal-browser';
import { CONFIG } from '../config.js';
import { AuthRequiredError, OfflineError } from './errors.js';

let pca = null;

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
      authority: CONFIG.msal.authority,
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
  }
  if (!pca.getActiveAccount()) {
    const [first] = pca.getAllAccounts();
    if (first) pca.setActiveAccount(first);
  }
  return getAccount();
}

export function getAccount() {
  const a = pca?.getActiveAccount();
  return a ? { name: a.name || a.username, username: a.username } : null;
}

export function login() {
  return pca.loginRedirect({ scopes: CONFIG.scopes, prompt: 'select_account' });
}

export function reauthenticate() {
  const account = pca.getActiveAccount();
  return pca.acquireTokenRedirect({ scopes: CONFIG.scopes, account, loginHint: account?.username });
}

export function logout() {
  return pca.logoutRedirect({ account: pca.getActiveAccount(), postLogoutRedirectUri: appBaseUrl() });
}

/** Silent token acquisition; never triggers navigation. */
export async function getAccessToken() {
  const account = pca?.getActiveAccount();
  if (!account) throw new AuthRequiredError('Non hai effettuato l’accesso');
  try {
    return (await pca.acquireTokenSilent({ scopes: CONFIG.scopes, account })).accessToken;
  } catch (e) {
    if (!navigator.onLine) throw new OfflineError();
    if (e instanceof InteractionRequiredAuthError || e instanceof BrowserAuthError) throw new AuthRequiredError();
    throw e;
  }
}
