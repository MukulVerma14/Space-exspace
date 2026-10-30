import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendBatch, mapEventType, formatEventsForServer, simulateNext401 } from '../sync/syncClient';
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
        payload: { location_id: 3, note: 'Moved to terminal site' },
        occurredAt: '2026-10-30T12:00:00.000Z',
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
          location_id: 3,
          note: 'Moved to terminal site',
        },
        occurred_at: '2026-10-30T12:00:00.000Z',
      },
    ]);
  });

  it('sends batch to POST /api/sync and categorizes accepted, duplicate, and rejected items', async () => {
    const events: OutboxEvent[] = [
      {
        id: 'ev-1',
        userId: 2,
        type: 'move',
        assetCode: 'CRN-50-001',
        payload: { location_id: 2 },
        occurredAt: '2026-10-30T12:00:00.000Z',
        status: 'pending',
        rejectReason: null,
        attempts: 0,
      },
      {
        id: 'ev-2',
        userId: 2,
        type: 'move',
        assetCode: 'CRN-50-001',
        payload: { location_id: 2 },
        occurredAt: '2026-10-30T12:01:00.000Z',
        status: 'pending',
        rejectReason: null,
        attempts: 0,
      },
      {
        id: 'ev-3',
        userId: 2,
        type: 'send_to_repair',
        assetCode: 'CRN-25-001',
        payload: {},
        occurredAt: '2026-10-30T12:02:00.000Z',
        status: 'pending',
        rejectReason: null,
        attempts: 0,
      },
    ];

    const postSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      processed: 3,
      results: [
        {
          client_event_id: 'ev-1',
          status: 'accepted',
          result: { ok: true },
        },
        {
          client_event_id: 'ev-2',
          status: 'duplicate',
          result: { duplicate: true },
        },
        {
          client_event_id: 'ev-3',
          status: 'rejected',
          error: 'ALREADY_UNDER_REPAIR',
          message: 'Asset is already under repair',
        },
      ],
    });

    const res = await sendBatch(events);

    expect(postSpy).toHaveBeenCalledWith('/api/sync', {
      events: expect.arrayContaining([
        expect.objectContaining({ client_event_id: 'ev-1', type: 'equipment.move' }),
        expect.objectContaining({ client_event_id: 'ev-2', type: 'equipment.move' }),
        expect.objectContaining({ client_event_id: 'ev-3', type: 'equipment.repair' }),
      ]),
    });

    expect(res.accepted).toEqual(['ev-1', 'ev-2']);
    expect(res.rejected).toEqual([
      { id: 'ev-3', reason: 'Asset is already under repair' },
    ]);
  });

  it('propagates 401 Unauthorized so sync manager halts and prompts sign in', async () => {
    const events: OutboxEvent[] = [
      {
        id: 'ev-auth-fail',
        userId: 2,
        type: 'move',
        assetCode: 'CRN-50-001',
        payload: { location_id: 1 },
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

  it('triggers 401 error when simulateNext401 dev helper is called', async () => {
    const events: OutboxEvent[] = [
      {
        id: 'ev-sim',
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

    simulateNext401();
    await expect(sendBatch(events)).rejects.toThrow(ApiRequestError);
  });
});
