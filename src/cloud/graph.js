// Minimal Microsoft Graph client for OneDrive: share-link resolution, folder
// creation and file upload (simple PUT or resumable session for large files).

import { CONFIG } from '../config.js';
import { sleep } from '../core/format.js';
import { withCounter } from '../core/naming.js';
import { getAccessToken } from './auth.js';
import { AuthRequiredError, GraphError, NameTakenError, OfflineError } from './errors.js';
import { sameImage } from '../metadata/containers.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

const isBinary = (b) => b instanceof Blob || b instanceof ArrayBuffer || ArrayBuffer.isView(b);

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  if (!navigator.onLine) throw new OfflineError();
  const token = await getAccessToken();
  const json = body !== undefined && !isBinary(body);
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(GRAPH + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(json ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: json ? JSON.stringify(body) : body,
      });
    } catch {
      throw new OfflineError();
    }
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 2 ** attempt * 2;
      await sleep(Math.min(30, retryAfter) * 1000);
      continue;
    }
    if (res.status === 401) throw new AuthRequiredError();
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new GraphError(res.status, err.error?.code, err.error?.message);
    }
    return res.status === 204 ? null : res.json();
  }
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

/** Sharing URL → Graph share id ("u!" + unpadded base64url). */
function encodeShareUrl(url) {
  const bytes = new TextEncoder().encode(url.trim());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'u!' + btoa(bin).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

/**
 * Resolves a OneDrive sharing link (to a folder) into a destination.
 * `Prefer: redeemSharingLink` grants the signed-in user lasting access.
 */
export async function resolveShareLink(shareUrl) {
  const item = await request(
    `/shares/${encodeShareUrl(shareUrl)}/driveItem?$select=id,name,webUrl,folder,parentReference,shared,remoteItem`,
    {
      headers: { Prefer: 'redeemSharingLink' },
    },
  );
  const real = item.remoteItem || item;
  if (!item.folder && !real.folder) throw new Error('Il link non punta a una cartella');
  return {
    kind: 'share',
    shareUrl: shareUrl.trim(),
    driveId: real.parentReference?.driveId || item.parentReference?.driveId,
    itemId: real.id || item.id,
    name: item.name,
    webUrl: item.webUrl,
    owner: item.shared?.owner?.user?.displayName || '',
  };
}

/** Uses (and creates if missing) a folder in the signed-in user's own drive. */
export async function resolveOwnFolder(path) {
  const clean = path.replace(/^\/+|\/+$/g, '').trim() || 'scontrini';
  let item;
  try {
    item = await request(`/me/drive/root:/${encodePath(clean)}`);
  } catch (e) {
    if (e.status !== 404) throw e;
    const root = await request('/me/drive/root?$select=id,parentReference');
    const driveId = root.parentReference.driveId;
    let parentId = root.id;
    for (const part of clean.split('/')) parentId = await ensureFolder(driveId, parentId, part);
    item = await request(`/drives/${driveId}/items/${parentId}`);
  }
  return {
    kind: 'own',
    path: clean,
    driveId: item.parentReference.driveId,
    itemId: item.id,
    name: item.name,
    webUrl: item.webUrl,
    owner: '',
  };
}

/**
 * Checks that the destination is reachable *and writable* without leaving
 * anything behind: creating an upload session requires write permission but
 * creates no file until bytes are sent, and the session is then cancelled.
 */
export async function verifyDestination(dest) {
  const base = `/drives/${dest.driveId}/items/${dest.itemId}`;
  const item = await request(`${base}?$select=id,name,webUrl`);
  // Write check: open an upload session and cancel it, so no file is created.
  // 'rename': a leftover file with this name must not fail the check (409).
  const session = await request(`${base}:/${encodeURIComponent('.scountrini-verifica.tmp')}:/createUploadSession`, {
    method: 'POST',
    body: { item: { '@microsoft.graph.conflictBehavior': 'rename' } },
  });
  fetch(session.uploadUrl, { method: 'DELETE' }).catch(() => {});
  return { name: item.name, webUrl: item.webUrl };
}

const folderCache = new Map();
export const clearFolderCache = () => folderCache.clear();

async function ensureFolder(driveId, parentId, name) {
  const key = `${driveId}/${parentId}/${name}`;
  if (folderCache.has(key)) return folderCache.get(key);
  const lookup = () => request(`/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}?$select=id`);
  let id;
  try {
    id = (await lookup()).id;
  } catch (e) {
    if (e.status !== 404) throw e;
    try {
      id = (
        await request(`/drives/${driveId}/items/${parentId}/children`, {
          method: 'POST',
          body: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
        })
      ).id;
    } catch (e2) {
      if (e2.status !== 409) throw e2; // created concurrently: look it up again
      id = (await lookup()).id;
    }
  }
  folderCache.set(key, id);
  return id;
}

/**
 * Uploads into <destination>/<folders...>/<fileName>, never overwriting.
 * A file already there with the same image data (metadata aside) is our own
 * earlier upload whose confirmation got lost, so it is returned as is. A
 * different image under the same name throws NameTakenError, unless
 * `allowCopy` is set: then the first free `-2`, `-3`, … name is used.
 * Resolves to the drive item (its `name` is the final file name).
 */
export async function uploadFile(destination, { folders, fileName, blob, mime }, { allowCopy = false } = {}) {
  let parent = destination.itemId;
  for (const f of folders) parent = await ensureFolder(destination.driveId, parent, f);
  const local = new Uint8Array(await blob.arrayBuffer());
  for (let n = 1, tries = 0; n <= 50 && tries < 100; n++, tries++) {
    const itemPath = `/drives/${destination.driveId}/items/${parent}:/${encodeURIComponent(withCounter(fileName, n))}`;
    const existing = await request(itemPath).catch((e) => {
      if (e.status === 404) return null;
      throw e;
    });
    if (existing) {
      const remote = await download(existing);
      if (sameImage(remote, local, mime)) return existing;
      if (n === 1 && !allowCopy) {
        const { id, name, webUrl } = existing;
        throw new NameTakenError({ id, name, webUrl, blob: new Blob([remote], { type: mime }) });
      }
      continue;
    }
    try {
      return await putFile(itemPath, blob, mime);
    } catch (e) {
      if (e.status !== 409) throw e;
      n--; // someone created this name in the meantime: look at it again
    }
  }
  throw new Error('Troppi file con lo stesso nome in questa cartella');
}

/** File content through the item's pre-authenticated, CORS-enabled download URL. */
async function download(item) {
  try {
    const res = await fetch(item['@microsoft.graph.downloadUrl']);
    if (!res.ok) throw new GraphError(res.status, '', `Download non riuscito (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    throw e instanceof GraphError ? e : new OfflineError();
  }
}

async function putFile(itemPath, blob, mime) {
  if (blob.size <= CONFIG.simpleUploadLimit) {
    return request(`${itemPath}:/content?@microsoft.graph.conflictBehavior=fail`, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': mime },
    });
  }

  const session = await request(`${itemPath}:/createUploadSession`, {
    method: 'POST',
    body: { item: { '@microsoft.graph.conflictBehavior': 'fail' } },
  });
  const size = blob.size;
  for (let start = 0; start < size; start += CONFIG.uploadChunkSize) {
    const end = Math.min(size, start + CONFIG.uploadChunkSize) - 1;
    let res;
    try {
      // The upload URL is pre-authenticated: no Authorization header allowed.
      res = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${start}-${end}/${size}` },
        body: blob.slice(start, end + 1),
      });
    } catch {
      throw new OfflineError();
    }
    if (!res.ok) throw new GraphError(res.status, '', `Upload interrotto (${res.status})`);
    if (res.status === 200 || res.status === 201) return res.json();
  }
  throw new Error('Upload incompleto');
}
