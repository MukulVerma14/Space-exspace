/**
 * Sends a batch of outbox events to the server.
 *
 * MOCK until the backend endpoint exists. The mock accepts everything except
 * "send_to_repair" events, which it rejects, so the review list can be tested.
 *
 * TODO(backend): replace with the real call once POST /api/sync/events exists.
 * Contract the backend must implement:
 *   request:  { events: [{ id, type, assetCode, payload, occurredAt }] }
 *   response: { accepted: ["<id>", ...], rejected: [{ id, reason }] }
 *   - an id already saved must be ignored, not saved twice (idempotent)
 *   - 401 when the token is invalid
 *   - 5xx or network failure means "try again later"
 */

import { ApiRequestError } from '../api/client';
import type { OutboxEvent } from '../offline/db';

export interface BatchResult {
  accepted: string[];
  rejected: { id: string; reason: string }[];
}

let mockNext401 = false;

/** Dev helper: make the next batch fail with 401, to test the re-login prompt. */
export function simulateNext401(): void {
  mockNext401 = true;
}

export async function sendBatch(events: OutboxEvent[]): Promise<BatchResult> {
  await new Promise((resolve) => setTimeout(resolve, 300));

  if (mockNext401) {
    mockNext401 = false;
    throw new ApiRequestError(401, 'Unauthorized', null);
  }

  const accepted: string[] = [];
  const rejected: { id: string; reason: string }[] = [];
  for (const e of events) {
    if (e.type === 'send_to_repair') {
      rejected.push({ id: e.id, reason: 'Asset is already under repair (mock)' });
    } else {
      accepted.push(e.id);
    }
  }
  return { accepted, rejected };
}
