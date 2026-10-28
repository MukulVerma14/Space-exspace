import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../db/pool.js';
import { findSyncEventById, persistSyncEvent } from '../services/syncEventService.js';

describe('Step O1: Offline Idempotent Events & Occurred-Time Ordering', () => {
  let testUserId: number;
  let testLocation1Id: number;
  let testLocation2Id: number;
  let testLocation3Id: number;
  let testEquipmentId: number;

  const testUserEmail = 'sync_tester_o1@spaceexspace.com';
  const testAssetCode = 'TEST-SYNC-CRN-01';

  beforeAll(async () => {
    // 1. Clean up any existing test entities
    await pool.query(`DELETE FROM sync_events WHERE user_id IN (SELECT id FROM users WHERE email = $1)`, [testUserEmail]);
    await pool.query(`DELETE FROM location_log WHERE equipment_id IN (SELECT id FROM equipment WHERE asset_code = $1)`, [testAssetCode]);
    await pool.query(`DELETE FROM equipment WHERE asset_code = $1`, [testAssetCode]);
    await pool.query(`DELETE FROM locations WHERE name LIKE 'Sync Test Location %'`);
    await pool.query(`DELETE FROM users WHERE email = $1`, [testUserEmail]);

    // 2. Insert test user
    const userRes = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Sync Tester O1', $1, 'hash123', 'staff')
       RETURNING id`,
      [testUserEmail]
    );
    testUserId = userRes.rows[0].id;

    // 3. Insert test locations
    const loc1 = await pool.query(
      `INSERT INTO locations (name, kind) VALUES ('Sync Test Location 1', 'yard') RETURNING id`
    );
    testLocation1Id = loc1.rows[0].id;

    const loc2 = await pool.query(
      `INSERT INTO locations (name, kind) VALUES ('Sync Test Location 2', 'client_site') RETURNING id`
    );
    testLocation2Id = loc2.rows[0].id;

    const loc3 = await pool.query(
      `INSERT INTO locations (name, kind) VALUES ('Sync Test Location 3', 'workshop') RETURNING id`
    );
    testLocation3Id = loc3.rows[0].id;

    // 4. Insert test equipment
    const modelRes = await pool.query(`SELECT id FROM equipment_models LIMIT 1`);
    const modelId = modelRes.rows[0].id;

    const equipRes = await pool.query(
      `INSERT INTO equipment (asset_code, model_id, condition)
       VALUES ($1, $2, 'good')
       RETURNING id`,
      [testAssetCode, modelId]
    );
    testEquipmentId = equipRes.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM sync_events WHERE user_id = $1`, [testUserId]);
    await pool.query(`DELETE FROM location_log WHERE equipment_id = $1`, [testEquipmentId]);
    await pool.query(`DELETE FROM equipment WHERE id = $1`, [testEquipmentId]);
    await pool.query(`DELETE FROM locations WHERE id IN ($1, $2, $3)`, [testLocation1Id, testLocation2Id, testLocation3Id]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  });

  it('verifies sync_events table schema, UUID primary key and constraints', async () => {
    const tableInfo = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'sync_events'
       ORDER BY ordinal_position`
    );

    const cols = tableInfo.rows.map(r => r.column_name);
    expect(cols).toContain('client_event_id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('type');
    expect(cols).toContain('payload');
    expect(cols).toContain('status');
    expect(cols).toContain('result');
    expect(cols).toContain('occurred_at');
    expect(cols).toContain('recorded_at');

    // Status check constraint
    const client = await pool.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO sync_events (client_event_id, user_id, type, payload, status, occurred_at)
           VALUES ('00000000-0000-0000-0000-000000000001', $1, 'test', '{}', 'invalid_status', NOW())`,
          [testUserId]
        )
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });

  it('verifies recorded_at column exists in location_log and stock_movements', async () => {
    const locCols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'location_log'`
    );
    const locColNames = locCols.rows.map(r => r.column_name);
    expect(locColNames).toContain('recorded_at');

    const stockCols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_movements'`
    );
    const stockColNames = stockCols.rows.map(r => r.column_name);
    expect(stockColNames).toContain('recorded_at');
  });

  it('guarantees event idempotency: the same event sent twice returns the SAME stored result and causes zero duplicate writes', async () => {
    const clientEventId = '11111111-2222-3333-4444-555555555555';
    const occurredAt = new Date('2026-10-28T10:00:00.000Z');
    const payload = { equipment_id: testEquipmentId, new_location_id: testLocation1Id };
    const initialResult = { success: true, action: 'moved', target_location: testLocation1Id };

    const client = await pool.connect();
    try {
      // 1. Initial event processing
      const firstCheck = await findSyncEventById(client, clientEventId);
      expect(firstCheck).toBeNull();

      const stored = await persistSyncEvent(client, {
        client_event_id: clientEventId,
        user_id: testUserId,
        type: 'equipment.move',
        payload,
        status: 'accepted',
        result: initialResult,
        occurred_at: occurredAt,
      });

      expect(stored.client_event_id).toBe(clientEventId);
      expect(stored.status).toBe('accepted');
      expect(stored.result).toEqual(initialResult);

      // 2. Replay the exact same event
      const secondCheck = await findSyncEventById(client, clientEventId);
      expect(secondCheck).not.toBeNull();
      expect(secondCheck?.status).toBe('accepted');
      expect(secondCheck?.result).toEqual(initialResult);

      // Attempting to insert duplicate event with same UUID fails at database level
      await expect(
        persistSyncEvent(client, {
          client_event_id: clientEventId,
          user_id: testUserId,
          type: 'equipment.move',
          payload,
          status: 'accepted',
          result: { changed: 'different result' },
          occurred_at: occurredAt,
        })
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });

  it('prevents stale devices from overwriting newer moves by ordering v_equipment_current by occurred_at (moved_at DESC)', async () => {
    // Scenario:
    // Event 1: Online worker moved the crane to Location 2 at 10:00 AM (server recorded it at 10:01 AM)
    // Event 2: Offline worker moved the crane to Location 3 at 08:00 AM (device was offline, synced at 11:00 AM)
    // Expected result: v_equipment_current MUST show Location 2 as the current location, NOT Location 3!

    const time10AM = new Date('2026-10-28T10:00:00.000Z');
    const time08AM = new Date('2026-10-28T08:00:00.000Z');

    // Insert Event 1 (10:00 AM)
    await pool.query(
      `INSERT INTO location_log (equipment_id, location_id, moved_by, moved_at, recorded_at, note)
       VALUES ($1, $2, $3, $4, NOW(), 'Event 1 at 10:00 AM')`,
      [testEquipmentId, testLocation2Id, testUserId, time10AM]
    );

    // Verify v_equipment_current shows Location 2
    let viewRes = await pool.query(
      `SELECT current_location_id FROM v_equipment_current WHERE id = $1`,
      [testEquipmentId]
    );
    expect(viewRes.rows[0].current_location_id).toBe(testLocation2Id);

    // Now insert Event 2 (occurred at 08:00 AM, but synced later with a higher id and later recorded_at)
    await pool.query(
      `INSERT INTO location_log (equipment_id, location_id, moved_by, moved_at, recorded_at, note)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', 'Event 2 stale offline move at 08:00 AM')`,
      [testEquipmentId, testLocation3Id, testUserId, time08AM]
    );

    // Crucial check: v_equipment_current MUST STILL return Location 2!
    // The older move (08:00 AM) must NOT overwrite the newer move (10:00 AM), even though it arrived later!
    viewRes = await pool.query(
      `SELECT current_location_id FROM v_equipment_current WHERE id = $1`,
      [testEquipmentId]
    );
    expect(viewRes.rows[0].current_location_id).toBe(testLocation2Id);
  });
});
