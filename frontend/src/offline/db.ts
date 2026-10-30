/**
 * Offline storage (IndexedDB via `idb`).
 *
 * Stores:
 *   - snapshots: cached data, key = `${userId}:${name}`, so each user has their own
 *   - session:   the signed-in user's profile (used to boot the shell offline)
 *   - outbox:    staff actions not yet confirmed by the server (v2). NOT wiped on
 *                sign-out or user switch. Only the user's explicit "sign out and
 *                discard" removes them, so unsynced work is never lost silently.
 *
 * Snapshots and session are wiped on logout, and wiped when a different user
 * signs in. Nothing in snapshots is a source of truth. The server is.
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface OfflineSnapshot<T> {
  data: T;
  savedAt: string; // ISO timestamp, shown to the user
}

export interface OutboxEvent {
  id: string;                 // client-generated UUID, the server uses it to ignore duplicates
  userId: number;
  type: 'move' | 'return' | 'send_to_repair';
  assetCode: string;
  payload: Record<string, unknown>;
  occurredAt: string;         // when the person did it on the phone, ISO
  status: 'pending' | 'rejected';
  rejectReason: string | null;
  attempts: number;
}

interface SxOfflineDB extends DBSchema {
  snapshots: { key: string; value: OfflineSnapshot<unknown> };
  session: { key: string; value: unknown };
  outbox: { key: string; value: OutboxEvent; indexes: { byUser: number } };
}

const DB_NAME = 'sx-offline';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<SxOfflineDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<SxOfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SxOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('snapshots');
          db.createObjectStore('session');
        }
        if (oldVersion < 2) {
          const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
          outbox.createIndex('byUser', 'userId');
        }
      },
    });
  }
  return dbPromise;
}

// ── Snapshots (per user) ──────────────────────────────────────────────────────

export async function saveSnapshot<T>(userId: number, name: string, data: T): Promise<void> {
  try {
    const db = await getDb();
    await db.put(
      'snapshots',
      { data, savedAt: new Date().toISOString() },
      `${userId}:${name}`,
    );
  } catch (err) {
    // Storage full or blocked: the live view still works, we just can't cache it.
    console.warn('[offline] could not save snapshot', err);
  }
}

export async function loadSnapshot<T>(userId: number, name: string): Promise<OfflineSnapshot<T> | null> {
  try {
    const db = await getDb();
    const row = await db.get('snapshots', `${userId}:${name}`);
    return row ? (row as OfflineSnapshot<T>) : null;
  } catch (err) {
    console.warn('[offline] could not read snapshot', err);
    return null;
  }
}

// ── Profile (for booting the shell offline) ───────────────────────────────────

export async function saveProfile<T>(user: T): Promise<void> {
  try {
    const db = await getDb();
    await db.put('session', user, 'profile');
  } catch (err) {
    console.warn('[offline] could not save profile', err);
  }
}

export async function loadProfile<T>(): Promise<T | null> {
  try {
    const db = await getDb();
    const row = await db.get('session', 'profile');
    return row ? (row as T) : null;
  } catch (err) {
    console.warn('[offline] could not read profile', err);
    return null;
  }
}

// ── Wipe ──────────────────────────────────────────────────────────────────────

/**
 * Wipes snapshots and session. Called on sign-out, token expiry and user switch.
 * Deliberately does NOT touch the outbox (see clearOutboxForUser).
 */
export async function clearAllOfflineData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['snapshots', 'session'], 'readwrite');
  await Promise.all([
    tx.objectStore('snapshots').clear(),
    tx.objectStore('session').clear(),
    tx.done,
  ]);
}
