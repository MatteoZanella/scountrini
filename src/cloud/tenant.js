// Which Microsoft sign-in a folder needs. A OneDrive for Business / SharePoint
// folder can only be reached with a token from its own organization (as a
// member or a guest); a personal OneDrive folder needs a personal account.

import { OfflineError } from './errors.js';

const LOGIN = 'https://login.microsoftonline.com';
/** Tenant id Microsoft uses for all personal accounts. */
const PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/**
 * Sign-in address for a tenant id: personal accounts go through "consumers";
 * with no tenant yet (own folder), "common" accepts personal and work accounts.
 */
export const authorityFor = (tenantId) =>
  `${LOGIN}/${!tenantId ? 'common' : tenantId === PERSONAL_TENANT ? 'consumers' : tenantId}`;

/** contoso-my.sharepoint.com → contoso.onmicrosoft.com; null if not SharePoint. */
function tenantDomain(url) {
  try {
    const host = new URL(String(url).trim()).hostname.toLowerCase();
    const m = host.match(/^([a-z0-9-]+?)(?:-my)?\.sharepoint(?:-df)?\.com$/);
    return m ? `${m[1]}.onmicrosoft.com` : null;
  } catch {
    return null;
  }
}

const cache = new Map();

/** Tenant id of a domain, from its public OpenID configuration. */
function lookupTenant(domain) {
  if (!cache.has(domain)) {
    const p = fetch(`${LOGIN}/${domain}/v2.0/.well-known/openid-configuration`)
      .catch(() => {
        throw new OfflineError();
      })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Organizzazione Microsoft “${domain}” non trovata`);
        return new URL((await res.json()).issuer).pathname.split('/')[1];
      });
    p.catch(() => cache.delete(domain));
    cache.set(domain, p);
  }
  return cache.get(domain);
}

/** Tenant id whose accounts can open the folder at `url`. */
export async function tenantForLink(url) {
  const domain = tenantDomain(url);
  return domain ? lookupTenant(domain) : PERSONAL_TENANT;
}
