import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendBatch, mapEventType, formatEventsForServer } from '../sync/syncClient';
import { api, ApiRequestError } from '../api/client';
import type { OutboxEvent } from '../offline/db';

describe('syncClient — POST /api/sync contract & payload translation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly maps shorthand event types to domain dotted types', () => {
    expect(mapEventType('move')).toBe('equipment.move');
    expect(mapEventType('return')).toBe('equipment.return');
    expect(mapEventType('send_to_repair')).toBe('equipment.repair');
    expect(mapEventType('goods_received')).toBe('material.goods_received');
    expect(mapEventType('issue')).toBe('material.issue');
    expect(mapEventType('custom.event')).toBe('custom.event');
  });

  it('formats outbox events into server sync schema with asset_code merged into payload', () => {
    const events: OutboxEvent[] = [
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        userId: 2,
        type: 'move',
        assetCode: 'CRN-50-001',
        payload: { to_location_id: 3, note: 'Relocated for engine overhaul' },
        occurredAt: '2026-10-30T10:00:00.000Z',
        status: 'pending',
        rejectReason: null,
        attempts: 0,
      },
    ];

    const formatted = formatEventsForServer(events);
    expect(formatted).toEqual([
      {
        client_event_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: 2,
        type: 'equipment.move',
        payload: {
          asset_code: 'CRN-50-001',
          to_location_id: 3,
          note: 'Relocated for engine overhaul',
        },
        occurred_at: '2026-10-30T10:00:00.000Z',
      },
    ]);
  });

  it('returns empty results if batch is empty', async () => {
    const res = await sendBatch([]);
    expect(res).toEqual({ accepted: [], rejected: [] });
  });

  it('submits batch payload to POST /api/sync and parses accepted/rejected results', async () => {
    const events: OutboxEvent[] = [
      {
        id: 'ev-1',
        userId: 2,
        type: 'move',
        assetCode: 'CRN-50-001',
        payload: { to_location_id: 2 },
        occurredAt: '2026-10-30T10:00:00.000Z',
        status: 'pending',
        rejectReason: null,
        attempts: 0,
      },
      {
        id: 'ev-2',
        userId: 2,
        type: 'send_to_repair',
        assetCode: 'GEN-60-001',
        payload: { note: 'Alternator fault' },
        occurredAt: '2026-10-30T10:05:00.000Z',
        status: 'pending',
        rejectReason: null,
        attempts: 0,
      },
      {
        id: 'ev-3',
        userId: 2,
        type: 'return',
        assetCode: 'FLT-05-001',
        payload: {},
        occurredAt: '2026-10-30T10:10:00.000Z',
        status: 'pending',
        rejectReason: null,
        attempts: 0,
      },
    ];

    vi.spyOn(api, 'post').mockResolvedValueOnce({
      processed: 3,
      results: [
        { client_event_id: 'ev-1', status: 'accepted' },
        { client_event_id: 'ev-2', status: 'duplicate' },
        {
          client_event_id: 'ev-3',
          status: 'rejected',
          message: 'Equipment is not currently marked as rented',
        },
      ],
    });

    const result = await sendBatch(events);

    expect(result.accepted).toEqual(['ev-1', 'ev-2']);
    expect(result.rejected).toEqual([
      {
        id: 'ev-3',
        reason: 'Equipment is not currently marked as rented',
      },
    ]);
  });

  it('propagates 401 ApiRequestError to caller without masking', async () => {
    const events: OutboxEvent[] = [
      {
        id: 'ev-1',
        userId: 2,
        type: 'move',
        assetCode: 'CRN-50-001',
        payload: {},
        occurredAt: '2026-10-30T12:00:00.000Z',
        status: 'pending',
        rejectReason: null,
        attempts: 0,
      },
    ];

    vi.spyOn(api, 'post').mockRejectedValueOnce(
      new ApiRequestError(401, 'Invalid or expired token', null)
    );

    await expect(sendBatch(events)).rejects.toThrow(ApiRequestError);
  });
});
