// Offline-first upload queue. Documents are stored in IndexedDB first and
// uploaded whenever the app is open and online. Each job keeps its status so
// the user can see what reached OneDrive and what did not.
//
// Job status lifecycle: pending → uploading → done | error (auto-retried with
// exponential backoff, or manually from the log).

import { jobs } from '../storage/db.js';
import { settings } from '../core/settings.js';
import { getAccount } from './auth.js';
import { destination } from './destination.js';
import { uploadFile } from './graph.js';
import { AuthRequiredError, NameTakenError, OfflineError, describeError, isAccessDenied } from './errors.js';

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;
const POLL_MS = 45_000;

export function wifiDetectionSupported() {
  return Boolean(navigator.connection?.type);
}

function connectionAllowed() {
  if (!navigator.onLine) return false;
  const type = navigator.connection?.type;
  if (settings.get('wifiOnly') && type && !['wifi', 'ethernet', 'unknown'].includes(type)) return false;
  return true;
}

class UploadQueue extends EventTarget {
  #running = false;
  #again = false;
  authBlocked = false;

  async init() {
    // Jobs interrupted mid-upload (app closed) go back to the queue
    for (const j of await jobs.all()) {
      if (j.status === 'uploading') await jobs.update(j.id, { status: 'pending' });
    }
    addEventListener('online', () => this.kick());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.kick());
    navigator.connection?.addEventListener?.('change', () => this.kick());
    setInterval(() => this.kick(), POLL_MS);
    this.kick();
  }

  /** Lets the UI refresh after jobs are added or removed outside the queue. */
  notifyChanged() {
    this.#emit();
  }

  #emit(type = 'change') {
    this.dispatchEvent(new Event(type));
  }

  /** Starts processing; `force` also retries errored jobs immediately. */
  async kick(force = false) {
    if (force) this.authBlocked = false;
    if (this.#running) {
      this.#again = true;
      return;
    }
    this.#running = true;
    try {
      // Web Locks keep two open tabs from uploading the same job twice
      if (navigator.locks?.request) {
        await navigator.locks.request(
          'scontrini-upload',
          { ifAvailable: true },
          (lock) => lock && this.#process(force),
        );
      } else {
        await this.#process(force);
      }
    } catch (e) {
      console.error('Upload queue failure', e);
    } finally {
      this.#running = false;
      if (this.#again) {
        this.#again = false;
        setTimeout(() => this.kick(), 500);
      }
    }
  }

  async #process(force) {
    const dest = destination.get();
    if (this.authBlocked || !dest || !getAccount()) return;
    const now = Date.now();
    const due = (await jobs.all())
      .filter((j) => j.status === 'pending' || (j.status === 'error' && (force || (j.nextAttemptAt || 0) <= now)))
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const job of due) {
      if (!connectionAllowed()) break;
      await jobs.update(job.id, { status: 'uploading', lastError: '' });
      this.#emit();
      try {
        const item = await uploadFile(dest, job, { allowCopy: job.allowCopy });
        await jobs.update(job.id, {
          status: 'done',
          uploadedAt: Date.now(),
          fileName: item.name, // final name, e.g. with a -2 suffix
          webUrl: item.webUrl,
          remoteId: item.id,
          blob: null, // safely on OneDrive: free local space, keep the thumbnail
          conflict: null,
        });
        this.#emit();
      } catch (e) {
        if (e instanceof NameTakenError) {
          // Not retried: waits for the user to compare the two images (log view)
          await jobs.update(job.id, { status: 'conflict', conflict: e.existing, lastError: e.message });
          this.#emit();
          continue;
        }
        if (e instanceof OfflineError || e instanceof AuthRequiredError) {
          await jobs.update(job.id, { status: 'pending' });
          if (e instanceof AuthRequiredError) {
            this.authBlocked = true;
            this.#emit('authrequired');
          }
          this.#emit();
          break;
        }
        const attempts = (job.attempts || 0) + 1;
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempts, 7));
        await jobs.update(job.id, {
          status: 'error',
          attempts,
          lastError: describeError(e, { account: getAccount()?.username }),
          accessDenied: isAccessDenied(e),
          nextAttemptAt: Date.now() + delay,
        });
        console.error('Upload failed', e);
        this.#emit();
      }
    }
  }
}

export const uploadQueue = new UploadQueue();
