import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { seedDatabase } from '../db/seed.js';
import crypto from 'crypto';
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
    viewRes = await pool.query(
      `SELECT current_location_id FROM v_equipment_current WHERE id = $1`,
      [testEquipmentId]
    );
    expect(viewRes.rows[0].current_location_id).toBe(testLocation2Id);
  });
});

describe('Step O2: Offline Batch Replay Suite (POST /api/sync)', () => {
  let adminToken: string;
  let staffToken: string;
  let adminUser: { id: number; email: string; role: string };
  let staffUser: { id: number; email: string; role: string };

  let testYardId: number;
  let testWorkshopId: number;
  let testMaterialId: number;
  const testAssetCode = 'TEST-SYNC-O2-01';
  let testEquipmentId: number;

  beforeAll(async () => {
    // Reset seed to ensure predictable canonical state
    await seedDatabase();

    // Log in admin
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@spaceexspace.com', password: 'Admin#2026!Dev' });
    adminToken = adminRes.body.token;
    adminUser = adminRes.body.user;

    // Log in staff
    const staffRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@spaceexspace.com', password: 'Staff#2026!Dev' });
    staffToken = staffRes.body.token;
    staffUser = staffRes.body.user;

    // Fetch helper entity IDs
    const yardRes = await pool.query(`SELECT id FROM locations WHERE kind = 'yard' LIMIT 1`);
    testYardId = yardRes.rows[0].id;

    const workshopRes = await pool.query(`SELECT id FROM locations WHERE kind = 'workshop' LIMIT 1`);
    testWorkshopId = workshopRes.rows[0].id;

    const matRes = await pool.query(`SELECT id FROM items WHERE active = true LIMIT 1`);
    testMaterialId = matRes.rows[0].id;

    // Create an isolated equipment asset for Step O2 tests
    await pool.query(`DELETE FROM location_log WHERE equipment_id IN (SELECT id FROM equipment WHERE asset_code = $1)`, [testAssetCode]);
    await pool.query(`DELETE FROM equipment WHERE asset_code = $1`, [testAssetCode]);
    const mRes = await pool.query(`SELECT id FROM equipment_models LIMIT 1`);
    const eqRes = await pool.query(
      `INSERT INTO equipment (asset_code, model_id, condition) VALUES ($1, $2, 'good') RETURNING id`,
      [testAssetCode, mRes.rows[0].id]
    );
    testEquipmentId = eqRes.rows[0].id;

    // Record an initial location older than any test events (2 hours ago)
    await pool.query(
      `INSERT INTO location_log (equipment_id, location_id, moved_by, moved_at, recorded_at, note)
       VALUES ($1, $2, $3, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours', 'Initial O2 test location')`,
      [testEquipmentId, testYardId, staffUser.id]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM sync_events WHERE user_id = $1`, [staffUser.id]);
    await pool.query(`DELETE FROM location_log WHERE equipment_id = $1`, [testEquipmentId]);
    await pool.query(`DELETE FROM equipment WHERE id = $1`, [testEquipmentId]);
    await seedDatabase();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/sync')
      .send({ events: [] });
    expect(res.status).toBe(401);
  });

  it('rejects batch size exceeding 50 events with 400', async () => {
    const oversizedEvents = Array.from({ length: 51 }, () => ({
      client_event_id: crypto.randomUUID(),
      user_id: staffUser.id,
      type: 'equipment.move',
      payload: { asset_code: testAssetCode, location_id: testYardId },
      occurred_at: new Date().toISOString(),
    }));

    const res = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: oversizedEvents });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BATCH_SIZE_EXCEEDED');
  });

  it('replays batch of out-of-order events in occurred_at order and derives latest location', async () => {
    const t1 = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const t2 = new Date(Date.now() - 1800000).toISOString(); // 30 mins ago (latest)
    const tReceipt = new Date(Date.now() - 2700000).toISOString(); // 45 mins ago

    const event1Id = crypto.randomUUID();
    const event2Id = crypto.randomUUID();
    const eventReceiptId = crypto.randomUUID();

    // Send intentionally in non-chronological order: [Event 2 (latest), Event Receipt, Event 1 (earliest)]
    const batch = [
      {
        client_event_id: event2Id,
        user_id: staffUser.id,
        type: 'equipment.move',
        payload: { asset_code: testAssetCode, location_id: testWorkshopId, note: 'Relocated to workshop' },
        occurred_at: t2,
      },
      {
        client_event_id: eventReceiptId,
        user_id: staffUser.id,
        type: 'material.goods_received',
        payload: { item_id: testMaterialId, qty: 15, note: 'Received extra materials' },
        occurred_at: tReceipt,
      },
      {
        client_event_id: event1Id,
        user_id: staffUser.id,
        type: 'equipment.move',
        payload: { asset_code: testAssetCode, location_id: testYardId, note: 'Relocated to yard' },
        occurred_at: t1,
      },
    ];

    const res = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: batch });

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(3);

    const r1 = res.body.results.find((r: any) => r.client_event_id === event1Id);
    const r2 = res.body.results.find((r: any) => r.client_event_id === event2Id);
    const rReceipt = res.body.results.find((r: any) => r.client_event_id === eventReceiptId);

    expect(r1.status).toBe('accepted');
    expect(r2.status).toBe('accepted');
    expect(rReceipt.status).toBe('accepted');
    expect(rReceipt.result.delta_qty).toBe(15);

    // Verify v_equipment_current reflects Event 2 (workshop) because t2 > t1
    const viewRes = await pool.query(
      `SELECT current_location_id FROM v_equipment_current WHERE asset_code = $1`,
      [testAssetCode]
    );
    expect(viewRes.rows[0].current_location_id).toBe(testWorkshopId);
  });

  it('ensures idempotent replay: resending the batch returns duplicate status with stored result', async () => {
    const eventId = crypto.randomUUID();
    const event = {
      client_event_id: eventId,
      user_id: staffUser.id,
      type: 'equipment.move',
      payload: { asset_code: testAssetCode, location_id: testYardId },
      occurred_at: new Date(Date.now() - 60000).toISOString(),
    };

    // First attempt: Accepted
    const res1 = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: [event] });

    expect(res1.status).toBe(200);
    expect(res1.body.results[0].status).toBe('accepted');

    // Count location_log entries before retry
    const countBefore = await pool.query(
      `SELECT count(*) FROM location_log WHERE equipment_id = $1`,
      [testEquipmentId]
    );

    // Second attempt: Duplicate
    const res2 = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: [event] });

    expect(res2.status).toBe(200);
    expect(res2.body.results[0].status).toBe('duplicate');
    expect(res2.body.results[0].result).toBeDefined();

    // Verify no duplicate location_log record was inserted
    const countAfter = await pool.query(
      `SELECT count(*) FROM location_log WHERE equipment_id = $1`,
      [testEquipmentId]
    );
    expect(countAfter.rows[0].count).toBe(countBefore.rows[0].count);
  });

  it('rejects events with user_id mismatch and persists rejection audit', async () => {
    const eventId = crypto.randomUUID();
    const event = {
      client_event_id: eventId,
      user_id: adminUser.id, // Mismatched: staff user sending admin's user_id
      type: 'equipment.move',
      payload: { asset_code: testAssetCode, location_id: testYardId },
      occurred_at: new Date(Date.now() - 30000).toISOString(),
    };

    const res = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: [event] });

    expect(res.status).toBe(200);
    const item = res.body.results[0];
    expect(item.client_event_id).toBe(eventId);
    expect(item.status).toBe('rejected');
    expect(item.error).toBe('USER_MISMATCH');

    // Verify rejection is persisted in sync_events
    const checkDb = await pool.query(`SELECT * FROM sync_events WHERE client_event_id = $1`, [eventId]);
    expect(checkDb.rows.length).toBe(1);
    expect(checkDb.rows[0].status).toBe('rejected');
  });

  it('rejects events with future clock skew (> 5 minutes) and persists rejection', async () => {
    const eventId = crypto.randomUUID();
    const futureTime = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins in future

    const event = {
      client_event_id: eventId,
      user_id: staffUser.id,
      type: 'equipment.move',
      payload: { asset_code: testAssetCode, location_id: testYardId },
      occurred_at: futureTime,
    };

    const res = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: [event] });

    expect(res.status).toBe(200);
    const item = res.body.results[0];
    expect(item.status).toBe('rejected');
    expect(item.error).toBe('CLOCK_SKEW_EXCEEDED');

    // Verify rejection in DB
    const checkDb = await pool.query(`SELECT * FROM sync_events WHERE client_event_id = $1`, [eventId]);
    expect(checkDb.rows.length).toBe(1);
    expect(checkDb.rows[0].status).toBe('rejected');
  });

  it('re-checks preconditions: cannot return equipment that is not actively rented', async () => {
    const eventId = crypto.randomUUID();

    const event = {
      client_event_id: eventId,
      user_id: staffUser.id,
      type: 'equipment.return',
      payload: { asset_code: testAssetCode, location_id: testYardId },
      occurred_at: new Date(Date.now() - 10000).toISOString(),
    };

    const res = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: [event] });

    expect(res.status).toBe(200);
    const item = res.body.results[0];
    expect(item.status).toBe('rejected');
    expect(item.error).toBe('NOT_RENTED');

    // Verify rejection in DB
    const checkDb = await pool.query(`SELECT * FROM sync_events WHERE client_event_id = $1`, [eventId]);
    expect(checkDb.rows.length).toBe(1);
    expect(checkDb.rows[0].status).toBe('rejected');
  });

  it('re-checks preconditions: cannot issue stock below zero', async () => {
    const eventId = crypto.randomUUID();
    const event = {
      client_event_id: eventId,
      user_id: staffUser.id,
      type: 'material.issue',
      payload: { item_id: testMaterialId, qty: 999999 }, // Vastly exceeds available stock
      occurred_at: new Date(Date.now() - 10000).toISOString(),
    };

    const res = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: [event] });

    expect(res.status).toBe(200);
    const item = res.body.results[0];
    expect(item.status).toBe('rejected');
    expect(item.error).toBe('INSUFFICIENT_STOCK');

    // Verify rejection in DB
    const checkDb = await pool.query(`SELECT * FROM sync_events WHERE client_event_id = $1`, [eventId]);
    expect(checkDb.rows.length).toBe(1);
    expect(checkDb.rows[0].status).toBe('rejected');
  });

  it('ensures staff responses contain zero financial rates, prices, or costs', async () => {
    const assetCode = 'CRN-50-001'; // Actively rented crane (has applied_rate in rental)
    const eventId = crypto.randomUUID();

    // Staff performs a move on this machine
    const event = {
      client_event_id: eventId,
      user_id: staffUser.id,
      type: 'equipment.move',
      payload: { asset_code: assetCode, location_id: testYardId },
      occurred_at: new Date(Date.now() - 5000).toISOString(),
    };

    const res = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: [event] });

    expect(res.status).toBe(200);
    const item = res.body.results[0];
    expect(item.status).toBe('accepted');

    // Serialize whole response to string and verify forbidden financial keywords are absent
    const responseJson = JSON.stringify(res.body);
    expect(responseJson).not.toContain('applied_rate');
    expect(responseJson).not.toContain('unit_cost');
    expect(responseJson).not.toContain('unit_price');
    expect(responseJson).not.toContain('discount_note');
  });

  it('processes a mixed batch where some succeed and some fail without dropping any event', async () => {
    const validMoveId = crypto.randomUUID();
    const invalidReturnId = crypto.randomUUID();
    const clockSkewId = crypto.randomUUID();

    const batch = [
      {
        client_event_id: validMoveId,
        user_id: staffUser.id,
        type: 'equipment.move',
        payload: { asset_code: testAssetCode, location_id: testYardId },
        occurred_at: new Date(Date.now() - 100000).toISOString(),
      },
      {
        client_event_id: invalidReturnId,
        user_id: staffUser.id,
        type: 'equipment.return',
        payload: { asset_code: testAssetCode, location_id: testYardId }, // Not rented
        occurred_at: new Date(Date.now() - 90000).toISOString(),
      },
      {
        client_event_id: clockSkewId,
        user_id: staffUser.id,
        type: 'equipment.move',
        payload: { asset_code: testAssetCode, location_id: testYardId },
        occurred_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // > 5 mins
      },
    ];

    const res = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: batch });

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(3);

    const rValid = res.body.results.find((r: any) => r.client_event_id === validMoveId);
    const rInvalid = res.body.results.find((r: any) => r.client_event_id === invalidReturnId);
    const rClock = res.body.results.find((r: any) => r.client_event_id === clockSkewId);

    expect(rValid.status).toBe('accepted');
    expect(rInvalid.status).toBe('rejected');
    expect(rInvalid.error).toBe('NOT_RENTED');
    expect(rClock.status).toBe('rejected');
    expect(rClock.error).toBe('CLOCK_SKEW_EXCEEDED');

    // Verify all 3 are stored in sync_events
    const countRes = await pool.query(
      `SELECT count(*) FROM sync_events WHERE client_event_id IN ($1, $2, $3)`,
      [validMoveId, invalidReturnId, clockSkewId]
    );
    expect(countRes.rows[0].count).toBe('3');
  });
});
