/**
 * Outbox: staff actions are written to IndexedDB first, then sent later (F-O4).
 *
 * Every event gets a client UUID (the server uses it to ignore duplicates when a
 * request is retried) and occurredAt (when it happened on the phone, not when it
 * reached the server).
 *
 * F-O3 only stores and lists events. Sending is F-O4.
 */

import { getDb, OutboxEvent } from './db';

export const OUTBOX_CHANGED_EVENT = 'sx-outbox-changed';

function notify(): void {
  window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
}

/**
 * UUID v4. crypto.randomUUID only exists in secure contexts (https or localhost).
 * The app opened over plain http on a LAN IP would crash without this fallback.
 */
export function newEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface NewEventInput {
  userId: number;
  type: OutboxEvent['type'];
  assetCode: string;
  payload: Record<string, unknown>;
}

export async function enqueueEvent(input: NewEventInput): Promise<OutboxEvent> {
  const event: OutboxEvent = {
    id: newEventId(),
    userId: input.userId,
    type: input.type,
    assetCode: input.assetCode,
    payload: input.payload,
    occurredAt: new Date().toISOString(),
    status: 'pending',
    rejectReason: null,
    attempts: 0,
  };
  const db = await getDb();
  await db.put('outbox', event);
  notify();
  return event;
}

/** Events for one user, oldest first. Other users' events on a shared phone are never returned. */
export async function listEvents(userId: number): Promise<OutboxEvent[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex('outbox', 'byUser', userId);
  return rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export async function markRejected(id: string, reason: string): Promise<void> {
  const db = await getDb();
  const ev = await db.get('outbox', id);
  if (!ev) return;
  await db.put('outbox', { ...ev, status: 'rejected', rejectReason: reason });
  notify();
}

/** The user has reviewed a rejected event and chose to drop it. */
export async function discardEvent(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('outbox', id);
  notify();
}

/** Only called when the user explicitly signs out and confirms the loss. */
export async function clearOutboxForUser(userId: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('outbox', 'readwrite');
  let cursor = await tx.store.index('byUser').openCursor(userId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  notify();
}

/** Called by the sync manager once the server has accepted these events. */
export async function removeEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('outbox', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  notify();
}
