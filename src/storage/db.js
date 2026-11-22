// Archivio locale (IndexedDB): coda di upload, registro e bozza corrente.

const DB_NAME = 'scontrini';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('jobs')) {
          const s = db.createObjectStore('jobs', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('draft')) db.createObjectStore('draft');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => (result = r));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transazione annullata'));
  });
}

const req2p = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

// ---- Jobs (coda + registro) ----
export const jobs = {
  put: (job) => tx('jobs', 'readwrite', (s) => s.put(job)),
  get: (id) => tx('jobs', 'readonly', (s) => req2p(s.get(id))),
  delete: (id) => tx('jobs', 'readwrite', (s) => s.delete(id)),
  async all() {
    const list = await tx('jobs', 'readonly', (s) => req2p(s.getAll()));
    return list.sort((a, b) => b.createdAt - a.createdAt);
  },
  async update(id, patch) {
    return tx('jobs', 'readwrite', async (s) => {
      const cur = await req2p(s.get(id));
      if (!cur) return null;
      const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
      s.put(next);
      return next;
    });
  },
};

// ---- Bozza del documento in corso (sopravvive alla chiusura dell'app) ----
export const draft = {
  load: () => tx('draft', 'readonly', (s) => req2p(s.get('current'))),
  save: (d) => tx('draft', 'readwrite', (s) => s.put(d, 'current')),
  clear: () => tx('draft', 'readwrite', (s) => s.delete('current')),
};

export async function storageEstimate() {
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    return { ...est, persisted };
  } catch {
    return {};
  }
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return true;
  } catch {
    return false;
  }
}
