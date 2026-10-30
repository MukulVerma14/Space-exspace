/**
 * Sync manager: sends pending outbox events to the server.
 *
 *   - One sync at a time (module-level guard).
 *   - Batches of 50 events.
 *   - A failed batch retries with exponential backoff and jitter (2s, 4s, 8s ... max 60s),
 *     up to 5 attempts, then stops until the next 'online' event or manual retry.
 *   - 401: stop completely and ask the person to sign in again. Events are kept.
 *   - Offline: no requests at all.
 *   - No polling. Runs on app start (if online), on the browser 'online' event, and on manual retry.
 *
 * Accepted events are removed from the outbox. Rejected events are kept and marked
 * with the server's reason, for the person to review.
 */

import { ApiRequestError } from '../api/client';
import { listEvents, markRejected, removeEvents } from '../offline/outbox';
import { sendBatch } from './syncClient';

export interface SyncStatus {
  running: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  authExpired: boolean;
}

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;
const OFFLINE_MSG = 'Offline. Changes will send when you are connected.';

let status: SyncStatus = { running: false, lastSyncAt: null, lastError: null, authExpired: false };
let inFlight = false;
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Exponential backoff with jitter: 0.5x to 1.5x of 2s, 4s, 8s ... capped at 60s. */
export function backoffDelay(attempt: number): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.round(exp * (0.5 + Math.random()));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Call after the person has signed in again, so syncing can resume. */
export function resetSyncAuth(): void {
  setStatus({ authExpired: false, lastError: null });
}

export async function runSync(userId: number): Promise<void> {
  if (inFlight) return;
  if (!navigator.onLine) {
    setStatus({ lastError: OFFLINE_MSG });
    return;
  }
  if (status.authExpired) return;

  inFlight = true;
  setStatus({ running: true, lastError: null });

  try {
    for (;;) {
      if (!navigator.onLine) {
        setStatus({ lastError: OFFLINE_MSG });
        return;
      }

      const pending = (await listEvents(userId)).filter((e) => e.status === 'pending');
      if (pending.length === 0) break;

      const batch = pending.slice(0, BATCH_SIZE);
      const batchIds = batch.map((e) => e.id);
      let attempt = 0;

      // Retry this batch until it succeeds or we give up.
      for (;;) {
        try {
          const res = await sendBatch(batch);

          // Every event in the batch must be answered, or the batch is treated as failed.
          const answered = new Set([...res.accepted, ...res.rejected.map((r) => r.id)]);
          if (!batchIds.every((id) => answered.has(id))) {
            throw new Error('Incomplete response from server');
          }

          await removeEvents(res.accepted);
          for (const r of res.rejected) {
            await markRejected(r.id, r.reason);
          }
          break;
        } catch (err) {
          if (err instanceof ApiRequestError && err.status === 401) {
            setStatus({
              authExpired: true,
              lastError: 'Your session expired. Sign in again to send your changes.',
            });
            return;
          }

          attempt += 1;
          if (attempt >= MAX_ATTEMPTS) {
            setStatus({ lastError: 'Could not reach the server. Will retry when the connection returns.' });
            return;
          }

          await sleep(backoffDelay(attempt));
          if (!navigator.onLine) {
            setStatus({ lastError: OFFLINE_MSG });
            return;
          }
        }
      }
    }

    setStatus({ lastSyncAt: new Date().toISOString(), lastError: null });
  } finally {
    inFlight = false;
    setStatus({ running: false });
  }
}

/**
 * Wires the sync triggers for the signed-in user.
 * Returns a cleanup function for useEffect.
 */
export function startOnlineSync(userId: number): () => void {
  const onOnline = () => {
    void runSync(userId);
  };
  window.addEventListener('online', onOnline);
  if (navigator.onLine) void runSync(userId); // one attempt at app start, no polling
  return () => window.removeEventListener('online', onOnline);
}
