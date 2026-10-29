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

describe('Step O3: Role-Based Read Snapshots and ETag Caching (GET /api/sync/snapshot)', () => {
  let adminToken: string;
  let staffToken: string;

  beforeAll(async () => {
    // Log in admin
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@spaceexspace.com', password: 'Admin#2026!Dev' });
    adminToken = adminRes.body.token;

    // Log in staff
    const staffRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@spaceexspace.com', password: 'Staff#2026!Dev' });
    staffToken = staffRes.body.token;
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/sync/snapshot');
    expect(res.status).toBe(401);
  });

  it('returns active equipment, locations, materials with stock_on_hand, server_time, and etag for staff', async () => {
    const res = await request(app)
      .get('/api/sync/snapshot')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('staff');
    expect(typeof res.body.server_time).toBe('string');
    expect(res.body.etag).toBeDefined();
    expect(res.headers['etag']).toBe(res.body.etag);

    // Equipment checks
    expect(Array.isArray(res.body.equipment)).toBe(true);
    expect(res.body.equipment.length).toBeGreaterThan(0);
    const firstEquip = res.body.equipment[0];
    expect(firstEquip).toHaveProperty('id');
    expect(firstEquip).toHaveProperty('asset_code');
    expect(firstEquip).toHaveProperty('status');
    expect(firstEquip).toHaveProperty('current_location_id');

    // Locations checks
    expect(Array.isArray(res.body.locations)).toBe(true);
    expect(res.body.locations.length).toBeGreaterThan(0);
    const firstLoc = res.body.locations[0];
    expect(firstLoc).toHaveProperty('id');
    expect(firstLoc).toHaveProperty('name');
    expect(firstLoc).toHaveProperty('kind');

    // Materials checks
    expect(Array.isArray(res.body.materials)).toBe(true);
    expect(res.body.materials.length).toBeGreaterThan(0);
    const firstMat = res.body.materials[0];
    expect(firstMat).toHaveProperty('id');
    expect(firstMat).toHaveProperty('sku');
    expect(firstMat).toHaveProperty('stock_on_hand');
  });

  it('ensures staff snapshot response contains zero financial or money fields (rates, prices, costs)', async () => {
    const res = await request(app)
      .get('/api/sync/snapshot')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.standard_rates).toBeUndefined();

    // Verify across full serialized response
    const jsonStr = JSON.stringify(res.body);
    expect(jsonStr).not.toContain('applied_rate');
    expect(jsonStr).not.toContain('standard_rates');
    expect(jsonStr).not.toContain('unit_cost');
    expect(jsonStr).not.toContain('unit_price');
    expect(jsonStr).not.toContain('vat_included');
    expect(jsonStr).not.toContain('cost');
  });

  it('returns standard_rates in snapshot for admin users', async () => {
    const res = await request(app)
      .get('/api/sync/snapshot')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
    expect(Array.isArray(res.body.standard_rates)).toBe(true);
    expect(res.body.standard_rates.length).toBeGreaterThan(0);

    const firstRate = res.body.standard_rates[0];
    expect(firstRate).toHaveProperty('model_id');
    expect(firstRate).toHaveProperty('unit');
    expect(firstRate).toHaveProperty('amount');
  });

  it('returns 304 Not Modified when client provides matching If-None-Match header', async () => {
    // 1. Initial GET
    const initialRes = await request(app)
      .get('/api/sync/snapshot')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(initialRes.status).toBe(200);
    const etag = initialRes.headers['etag'];
    expect(etag).toBeDefined();

    // 2. Conditional GET with If-None-Match
    const conditionalRes = await request(app)
      .get('/api/sync/snapshot')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('If-None-Match', etag);

    expect(conditionalRes.status).toBe(304);
    expect(conditionalRes.text).toBe('');
    expect(conditionalRes.headers['etag']).toBe(etag);
  });

  it('returns fresh 200 with new ETag when database state changes', async () => {
    // 1. Initial snapshot
    const res1 = await request(app)
      .get('/api/sync/snapshot')
      .set('Authorization', `Bearer ${staffToken}`);
    const etag1 = res1.headers['etag'];

    // 2. Mutate state: record a stock movement on the first material item
    const targetItem = res1.body.materials[0];
    await pool.query(
      `INSERT INTO stock_movements (item_id, qty, type, unit_cost, moved_by, moved_at, recorded_at, note)
       VALUES ($1, 7.500, 'receipt', 0.00, (SELECT id FROM users WHERE role = 'staff' LIMIT 1), NOW(), NOW(), 'ETag mutation test')`,
      [targetItem.id]
    );

    // 3. Conditional GET with previous ETag
    const res2 = await request(app)
      .get('/api/sync/snapshot')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('If-None-Match', etag1);

    expect(res2.status).toBe(200);
    const etag2 = res2.headers['etag'];
    expect(etag2).toBeDefined();
    expect(etag2).not.toBe(etag1);

    // Clean up test movement
    await pool.query(`DELETE FROM stock_movements WHERE note = 'ETag mutation test'`);
  });
});

describe('Step O4: End-to-End Offline Field Scenarios & Multi-Device Concurrency', () => {
  let adminToken: string;
  let staffToken: string;
  let staffUser: { id: number; email: string; role: string };

  let yard1Id: number;
  let yard2Id: number;
  let workshopId: number;
  let oilItemId: number;
  const testAssetO4 = 'TEST-SYNC-O4-STALE';
  let testAssetO4Id: number;

  beforeAll(async () => {
    // Reset seed
    await seedDatabase();

    // Log in staff
    const staffRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@spaceexspace.com', password: 'Staff#2026!Dev' });
    staffToken = staffRes.body.token;
    staffUser = staffRes.body.user;

    // Log in admin
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@spaceexspace.com', password: 'Admin#2026!Dev' });
    adminToken = adminRes.body.token;

    // Fetch locations
    const locs = await pool.query(`SELECT id, kind FROM locations ORDER BY id ASC`);
    const yards = locs.rows.filter(l => l.kind === 'yard');
    yard1Id = yards[0]?.id;
    yard2Id = yards[1]?.id || yards[0]?.id;
    const workshop = locs.rows.find(l => l.kind === 'workshop');
    workshopId = workshop?.id || yard1Id;

    // Fetch material item
    const mat = await pool.query(`SELECT id FROM items WHERE active = true LIMIT 1`);
    oilItemId = mat.rows[0].id;

    // Create isolated equipment asset for O4
    await pool.query(`DELETE FROM maintenance WHERE equipment_id IN (SELECT id FROM equipment WHERE asset_code = $1)`, [testAssetO4]);
    await pool.query(`DELETE FROM location_log WHERE equipment_id IN (SELECT id FROM equipment WHERE asset_code = $1)`, [testAssetO4]);
    await pool.query(`DELETE FROM equipment WHERE asset_code = $1`, [testAssetO4]);
    const mRes = await pool.query(`SELECT id FROM equipment_models LIMIT 1`);
    const eqRes = await pool.query(
      `INSERT INTO equipment (asset_code, model_id, condition) VALUES ($1, $2, 'good') RETURNING id`,
      [testAssetO4, mRes.rows[0].id]
    );
    testAssetO4Id = eqRes.rows[0].id;

    // Initial location 3 hours ago
    await pool.query(
      `INSERT INTO location_log (equipment_id, location_id, moved_by, moved_at, recorded_at, note)
       VALUES ($1, $2, $3, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'Initial O4 location')`,
      [testAssetO4Id, yard1Id, staffUser.id]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM sync_events WHERE user_id = $1`, [staffUser.id]);
    await pool.query(`DELETE FROM maintenance WHERE equipment_id = $1`, [testAssetO4Id]);
    await pool.query(`DELETE FROM location_log WHERE equipment_id = $1`, [testAssetO4Id]);
    await pool.query(`DELETE FROM equipment WHERE id = $1`, [testAssetO4Id]);
    await seedDatabase();
  });

  it('handles stale device syncing an old move: accepted into history but does NOT overwrite newer location', async () => {
    // Scenario:
    // 08:00 AM: Worker A (offline) moves crane to Yard 2
    // 09:30 AM: Worker B (online) moves crane to Workshop
    // 10:00 AM: Worker B's move is synced/recorded first
    // 11:00 AM: Worker A regains connection and syncs 08:00 AM move
    const t0800 = new Date(Date.now() - 3 * 3600 * 1000).toISOString(); // 3 hours ago
    const t0930 = new Date(Date.now() - 1.5 * 3600 * 1000).toISOString(); // 1.5 hours ago

    const eventBId = crypto.randomUUID();
    const eventAId = crypto.randomUUID();

    // 1. Worker B's move (occurred at 09:30 AM) syncs first
    const syncBRes = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        events: [
          {
            client_event_id: eventBId,
            user_id: staffUser.id,
            type: 'equipment.move',
            payload: { asset_code: testAssetO4, location_id: workshopId, note: 'Moved to workshop by Worker B' },
            occurred_at: t0930,
          },
        ],
      });

    expect(syncBRes.status).toBe(200);
    expect(syncBRes.body.results[0].status).toBe('accepted');

    // Derived view reflects Worker B's move (workshop)
    let viewRes = await pool.query(
      `SELECT current_location_id FROM v_equipment_current WHERE asset_code = $1`,
      [testAssetO4]
    );
    expect(viewRes.rows[0].current_location_id).toBe(workshopId);

    // 2. Worker A's stale offline move (occurred earlier at 08:00 AM) syncs later
    const syncARes = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        events: [
          {
            client_event_id: eventAId,
            user_id: staffUser.id,
            type: 'equipment.move',
            payload: { asset_code: testAssetO4, location_id: yard2Id, note: 'Moved to yard 2 by Worker A' },
            occurred_at: t0800,
          },
        ],
      });

    expect(syncARes.status).toBe(200);
    expect(syncARes.body.results[0].status).toBe('accepted'); // Event accepted into audit trail

    // Both events are present in location_log
    const logCheck = await pool.query(
      `SELECT location_id, moved_at FROM location_log WHERE equipment_id = $1 ORDER BY moved_at DESC`,
      [testAssetO4Id]
    );
    expect(logCheck.rows.length).toBeGreaterThanOrEqual(2);

    // CRITICAL: v_equipment_current MUST STILL reflect Workshop because t0930 > t0800!
    viewRes = await pool.query(
      `SELECT current_location_id FROM v_equipment_current WHERE asset_code = $1`,
      [testAssetO4]
    );
    expect(viewRes.rows[0].current_location_id).toBe(workshopId);
  });

  it('handles out-of-order interleaved batch where some events succeed and others fail preconditions', async () => {
    // Current stock of test material
    const stockBefore = await pool.query<{ stock: string }>(
      `SELECT COALESCE(SUM(qty), 0) AS stock FROM stock_movements WHERE item_id = $1`,
      [oilItemId]
    );
    const initialStock = parseFloat(stockBefore.rows[0].stock);

    const t1 = new Date(Date.now() - 40000).toISOString();
    const t2 = new Date(Date.now() - 30000).toISOString();
    const t3 = new Date(Date.now() - 20000).toISOString();

    const ev1ValidReceipt = crypto.randomUUID();
    const ev2Overdraw = crypto.randomUUID();
    const ev3ValidIssue = crypto.randomUUID();

    // Send intentionally in non-chronological order: [t3 (issue), t2 (excessive issue), t1 (receipt)]
    const batch = [
      {
        client_event_id: ev3ValidIssue,
        user_id: staffUser.id,
        type: 'material.issue',
        payload: { item_id: oilItemId, qty: 2 },
        occurred_at: t3,
      },
      {
        client_event_id: ev2Overdraw,
        user_id: staffUser.id,
        type: 'material.issue',
        payload: { item_id: oilItemId, qty: 999999 }, // Precondition failure
        occurred_at: t2,
      },
      {
        client_event_id: ev1ValidReceipt,
        user_id: staffUser.id,
        type: 'material.goods_received',
        payload: { item_id: oilItemId, qty: 10 },
        occurred_at: t1,
      },
    ];

    const res = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: batch });

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(3);

    const rReceipt = res.body.results.find((r: any) => r.client_event_id === ev1ValidReceipt);
    const rOverdraw = res.body.results.find((r: any) => r.client_event_id === ev2Overdraw);
    const rIssue = res.body.results.find((r: any) => r.client_event_id === ev3ValidIssue);

    expect(rReceipt.status).toBe('accepted');
    expect(rOverdraw.status).toBe('rejected');
    expect(rOverdraw.error).toBe('INSUFFICIENT_STOCK');
    expect(rIssue.status).toBe('accepted');

    // Check final stock = initialStock + 10 - 2
    const stockAfter = await pool.query<{ stock: string }>(
      `SELECT COALESCE(SUM(qty), 0) AS stock FROM stock_movements WHERE item_id = $1`,
      [oilItemId]
    );
    expect(parseFloat(stockAfter.rows[0].stock)).toBe(initialStock + 10 - 2);
  });

  it('verifies idempotent batch re-execution preserves all results and prevents duplicate database writes', async () => {
    const moveId = crypto.randomUUID();
    const receiptId = crypto.randomUUID();

    const batch = [
      {
        client_event_id: moveId,
        user_id: staffUser.id,
        type: 'equipment.move',
        payload: { asset_code: testAssetO4, location_id: yard1Id, note: 'Idempotency test move' },
        occurred_at: new Date(Date.now() - 10000).toISOString(),
      },
      {
        client_event_id: receiptId,
        user_id: staffUser.id,
        type: 'material.goods_received',
        payload: { item_id: oilItemId, qty: 5 },
        occurred_at: new Date(Date.now() - 5000).toISOString(),
      },
    ];

    // First attempt: Accepted
    const res1 = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: batch });

    expect(res1.status).toBe(200);
    expect(res1.body.results[0].status).toBe('accepted');
    expect(res1.body.results[1].status).toBe('accepted');

    // Count records before retry
    const locCountBefore = await pool.query(`SELECT count(*) FROM location_log WHERE equipment_id = $1`, [testAssetO4Id]);
    const stockCountBefore = await pool.query(`SELECT count(*) FROM stock_movements WHERE item_id = $1`, [oilItemId]);

    // Second attempt: Resending exact batch
    const res2 = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ events: batch });

    expect(res2.status).toBe(200);
    expect(res2.body.results[0].status).toBe('duplicate');
    expect(res2.body.results[1].status).toBe('duplicate');

    // Stored results must be identical
    expect(res2.body.results[0].result).toEqual(res1.body.results[0].result);
    expect(res2.body.results[1].result).toEqual(res1.body.results[1].result);

    // Database counts must be identical (no duplicate rows)
    const locCountAfter = await pool.query(`SELECT count(*) FROM location_log WHERE equipment_id = $1`, [testAssetO4Id]);
    const stockCountAfter = await pool.query(`SELECT count(*) FROM stock_movements WHERE item_id = $1`, [oilItemId]);

    expect(locCountAfter.rows[0].count).toBe(locCountBefore.rows[0].count);
    expect(stockCountAfter.rows[0].count).toBe(stockCountBefore.rows[0].count);
  });

  it('rejects repair when asset is already under repair (precondition guard)', async () => {
    // 1. Send crane to repair
    const repairEvent1Id = crypto.randomUUID();
    const res1 = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        events: [
          {
            client_event_id: repairEvent1Id,
            user_id: staffUser.id,
            type: 'equipment.repair',
            payload: { asset_code: testAssetO4, kind: 'repair', description: 'Hydraulic leak' },
            occurred_at: new Date(Date.now() - 3000).toISOString(),
          },
        ],
      });

    expect(res1.status).toBe(200);
    expect(res1.body.results[0].status).toBe('accepted');

    // 2. Try to send the same crane to repair again while already under repair
    const repairEvent2Id = crypto.randomUUID();
    const res2 = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        events: [
          {
            client_event_id: repairEvent2Id,
            user_id: staffUser.id,
            type: 'equipment.repair',
            payload: { asset_code: testAssetO4, kind: 'repair', description: 'Second repair attempt' },
            occurred_at: new Date(Date.now() - 1000).toISOString(),
          },
        ],
      });

    expect(res2.status).toBe(200);
    expect(res2.body.results[0].status).toBe('rejected');
    expect(res2.body.results[0].error).toBe('ALREADY_UNDER_REPAIR');

    // Verify rejection row is stored in sync_events
    const checkDb = await pool.query(`SELECT * FROM sync_events WHERE client_event_id = $1`, [repairEvent2Id]);
    expect(checkDb.rows.length).toBe(1);
    expect(checkDb.rows[0].status).toBe('rejected');
  });
});
