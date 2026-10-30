/**
 * Sends a batch of outbox events to the server.
 *
 * Connects to the real backend endpoint POST /api/sync.
 * - Maps client event schema and action types to backend expectations.
 * - Extracts per-event results (accepted, duplicate, rejected).
 * - Preserves 401 propagation so the sync manager halts and prompts re-login.
 */

import { api, ApiRequestError } from '../api/client';
import type { OutboxEvent } from '../offline/db';

export interface BatchResult {
  accepted: string[];
  rejected: { id: string; reason: string }[];
}

export interface ServerSyncEvent {
  client_event_id: string;
  user_id: number;
  type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface ServerSyncResultItem {
  client_event_id: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  result?: Record<string, unknown> | null;
  error?: string;
  message?: string;
}

export interface ServerSyncResponse {
  processed: number;
  results: ServerSyncResultItem[];
}

let mockNext401 = false;

/** Dev helper: make the next batch fail with 401, to test the re-login prompt. */
export function simulateNext401(): void {
  mockNext401 = true;
}

/**
 * Maps frontend shorthand event types to the backend dotted domain types.
 */
export function mapEventType(type: string): string {
  switch (type) {
    case 'move':
      return 'equipment.move';
    case 'return':
      return 'equipment.return';
    case 'send_to_repair':
    case 'repair':
      return 'equipment.repair';
    case 'goods_received':
    case 'receipt':
      return 'material.goods_received';
    case 'issue':
      return 'material.issue';
    default:
      return type;
  }
}

/**
 * Transforms client OutboxEvents into the server payload format for POST /api/sync.
 */
export function formatEventsForServer(events: OutboxEvent[]): ServerSyncEvent[] {
  return events.map((e) => ({
    client_event_id: e.id,
    user_id: e.userId,
    type: mapEventType(e.type),
    payload: {
      asset_code: e.assetCode,
      ...e.payload,
    },
    occurred_at: e.occurredAt,
  }));
}

/**
 * Sends a batch of events to the backend POST /api/sync endpoint.
 */
export async function sendBatch(events: OutboxEvent[]): Promise<BatchResult> {
  if (events.length === 0) {
    return { accepted: [], rejected: [] };
  }

  // Dev-only 401 simulation trigger
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && mockNext401) {
    mockNext401 = false;
    throw new ApiRequestError(401, 'Unauthorized', null);
  }

  const serverEvents = formatEventsForServer(events);
  const response = await api.post<ServerSyncResponse>('/api/sync', { events: serverEvents });

  const accepted: string[] = [];
  const rejected: { id: string; reason: string }[] = [];

  for (const item of response.results || []) {
    if (item.status === 'accepted' || item.status === 'duplicate') {
      accepted.push(item.client_event_id);
    } else {
      rejected.push({
        id: item.client_event_id,
        reason: item.message || item.error || 'Event rejected by server',
      });
    }
  }

  return { accepted, rejected };
}
