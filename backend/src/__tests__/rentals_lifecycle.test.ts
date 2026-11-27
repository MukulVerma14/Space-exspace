import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { seedDatabase } from '../db/seed.js';

describe('R1: Rental Lifecycle Rules & Backend Safeguards', () => {
  let adminToken: string;
  let staffToken: string;

  beforeAll(async () => {
    await pool.query('DELETE FROM rental_items WHERE rental_id > 3');
    await pool.query('DELETE FROM rentals WHERE id > 3');
    await seedDatabase();

    const adminLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@spaceexspace.com', password: 'Admin#2026!Dev' });
    adminToken = adminLoginRes.body.token;

    const staffLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@spaceexspace.com', password: 'Staff#2026!Dev' });
    staffToken = staffLoginRes.body.token;
  });

  beforeEach(async () => {
    // Reset DB state before each test to guarantee absolute isolation
    await pool.query('DELETE FROM rental_items WHERE rental_id > 3');
    await pool.query('DELETE FROM rentals WHERE id > 3');
    await seedDatabase();
  });

  afterAll(async () => {
    await pool.query('DELETE FROM rental_items WHERE rental_id > 3');
    await pool.query('DELETE FROM rentals WHERE id > 3');
    await seedDatabase();
  });

  it('Rule 1: items must be available (rejects rented, repair, or inactive with 409 Conflict)', async () => {
    // 1. Check currently rented asset
    const rentedRes = await pool.query<{ id: number; asset_code: string }>(
      "SELECT id, asset_code FROM v_equipment_current WHERE status = 'rented' LIMIT 1"
    );
    expect(rentedRes.rows.length).toBe(1);
    const rentedAsset = rentedRes.rows[0];

    const resRented = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-20',
        expected_end: '2026-11-30',
        status: 'confirmed',
        items: [{ equipment_id: rentedAsset.id, applied_rate: 1500, rate_unit: 'daily' }]
      });
    expect(resRented.status).toBe(409);
    expect(resRented.body.error).toMatch(/currently unavailable/i);
    expect(resRented.body.conflict_asset_code).toBe(rentedAsset.asset_code);

    // 2. Check under repair asset
    const maintRes = await pool.query<{ id: number; asset_code: string }>(
      "SELECT id, asset_code FROM v_equipment_current WHERE status = 'under_repair' LIMIT 1"
    );
    expect(maintRes.rows.length).toBe(1);
    const maintAsset = maintRes.rows[0];

    const resMaint = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-20',
        expected_end: '2026-11-30',
        status: 'confirmed',
        items: [{ equipment_id: maintAsset.id, applied_rate: 1500, rate_unit: 'daily' }]
      });
    expect(resMaint.status).toBe(409);
    expect(resMaint.body.error).toMatch(/currently unavailable/i);
    expect(resMaint.body.conflict_asset_code).toBe(maintAsset.asset_code);
  });

  it('Rule 2: no active rental per item (rejects duplicate active rental for same asset with 409 Conflict)', async () => {
    const availRes = await pool.query<{ id: number; asset_code: string }>(
      "SELECT id, asset_code FROM v_equipment_current WHERE status = 'available' LIMIT 1"
    );
    const asset = availRes.rows[0];

    // 1. Create first confirmed rental R1 with this asset -> succeeds
    const r1Res = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-20',
        expected_end: '2026-11-30',
        status: 'confirmed',
        items: [{ equipment_id: asset.id, applied_rate: 1500, rate_unit: 'daily' }]
      });
    expect(r1Res.status).toBe(201);

    // 2. Attempt to create second confirmed rental R2 with the same asset -> rejected with 409 Conflict
    const r2Res = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-20',
        expected_end: '2026-11-30',
        status: 'confirmed',
        items: [{ equipment_id: asset.id, applied_rate: 1600, rate_unit: 'daily' }]
      });
    expect(r2Res.status).toBe(409);
    expect(r2Res.body.conflict_asset_code).toBe(asset.asset_code);
  });

  it('Rule 3: applied_rate is stored per item and preserved independently of standard rate changes', async () => {
    const availRes = await pool.query<{ id: number; model_id: number }>(
      "SELECT id, model_id FROM v_equipment_current WHERE status = 'available' LIMIT 1"
    );
    const asset = availRes.rows[0];

    const createRes = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-20',
        expected_end: '2026-11-30',
        status: 'quotation',
        items: [
          {
            equipment_id: asset.id,
            applied_rate: '1850.50',
            rate_unit: 'daily',
            discount_note: 'Agreed corporate tariff'
          }
        ]
      });
    expect(createRes.status).toBe(201);
    const rentalId = createRes.body.rental_id;

    const detail1 = await request(app)
      .get(`/api/rentals/${rentalId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail1.status).toBe(200);
    expect(detail1.body.data.items[0].applied_rate).toBe('1850.50');
    expect(detail1.body.data.items[0].discount_note).toBe('Agreed corporate tariff');

    // Mutate standard rates
    await pool.query(
      "UPDATE rates SET amount = 99999.00 WHERE model_id = $1 AND unit = 'daily'",
      [asset.model_id]
    );

    // Stored applied_rate on rental_items is unchanged
    const detail2 = await request(app)
      .get(`/api/rentals/${rentalId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail2.body.data.items[0].applied_rate).toBe('1850.50');
  });

  it('Rule 4: a quotation or cancelled rental never makes an item rented in v_equipment_current', async () => {
    const availRes = await pool.query<{ id: number; asset_code: string }>(
      "SELECT id, asset_code FROM v_equipment_current WHERE status = 'available' LIMIT 1"
    );
    const asset = availRes.rows[0];

    // 1. Create quotation
    const quoteRes = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-20',
        expected_end: '2026-11-25',
        status: 'quotation',
        items: [{ equipment_id: asset.id, applied_rate: 1400.00, rate_unit: 'daily' }]
      });
    expect(quoteRes.status).toBe(201);
    const rentalId = quoteRes.body.rental_id;

    // View must still show 'available' (a quotation never makes an item rented)
    const view1 = await pool.query<{ status: string }>('SELECT status FROM v_equipment_current WHERE id = $1', [asset.id]);
    expect(view1.rows[0].status).toBe('available');

    // 2. Confirm rental -> now 'rented'
    const confirmRes = await request(app)
      .post(`/api/rentals/${rentalId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(confirmRes.status).toBe(200);

    const view2 = await pool.query<{ status: string }>('SELECT status FROM v_equipment_current WHERE id = $1', [asset.id]);
    expect(view2.rows[0].status).toBe('rented');

    // 3. Cancel rental -> immediately 'available' (a cancelled rental never makes an item rented)
    const cancelRes = await request(app)
      .post(`/api/rentals/${rentalId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(cancelRes.status).toBe(200);

    const view3 = await pool.query<{ status: string }>('SELECT status FROM v_equipment_current WHERE id = $1', [asset.id]);
    expect(view3.rows[0].status).toBe('available');
  });

  it('Rule 5: cancelling frees its items (trigger sets returned_at and allows re-rental)', async () => {
    const availRes = await pool.query<{ id: number }>(
      "SELECT id FROM v_equipment_current WHERE status = 'available' LIMIT 1"
    );
    const assetId = availRes.rows[0].id;

    // 1. Create confirmed rental
    const r1 = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-20',
        expected_end: '2026-11-25',
        status: 'confirmed',
        items: [{ equipment_id: assetId, applied_rate: 1500.00, rate_unit: 'daily' }]
      });
    expect(r1.status).toBe(201);
    const r1Id = r1.body.rental_id;

    // 2. Admin cancels rental
    const cancelRes = await request(app)
      .post(`/api/rentals/${r1Id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(cancelRes.status).toBe(200);

    // Verify trigger set returned_at
    const itemCheck = await pool.query<{ returned_at: string | null }>(
      'SELECT returned_at FROM rental_items WHERE rental_id = $1 AND equipment_id = $2',
      [r1Id, assetId]
    );
    expect(itemCheck.rows[0].returned_at).not.toBeNull();

    // 3. Verify asset can immediately be rented again without conflict
    const r2 = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-26',
        expected_end: '2026-11-30',
        status: 'confirmed',
        items: [{ equipment_id: assetId, applied_rate: 1600.00, rate_unit: 'daily' }]
      });
    expect(r2.status).toBe(201);
  });

  it('Rule 6: uses decimal.js for financial validation and rate precision', async () => {
    const availRes = await pool.query<{ id: number }>(
      "SELECT id FROM v_equipment_current WHERE status = 'available' LIMIT 1"
    );
    const assetId = availRes.rows[0].id;

    // Rejects >2 decimal places
    const resTooManyDecimals = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-20',
        expected_end: '2026-11-25',
        status: 'confirmed',
        items: [{ equipment_id: assetId, applied_rate: 1500.125, rate_unit: 'daily' }]
      });
    expect(resTooManyDecimals.status).toBe(400);

    // Rejects negative rate
    const resNegative = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-20',
        expected_end: '2026-11-25',
        status: 'confirmed',
        items: [{ equipment_id: assetId, applied_rate: -100, rate_unit: 'daily' }]
      });
    expect(resNegative.status).toBe(400);

    // Accepts exact 2-decimal string and normalizes it
    const resValid = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-20',
        expected_end: '2026-11-25',
        status: 'confirmed',
        items: [{ equipment_id: assetId, applied_rate: '1750.50', rate_unit: 'daily' }]
      });
    expect(resValid.status).toBe(201);
  });

  it('Rule 7: Staff responses contain NO money and NO customer contact details', async () => {
    const rentalRes = await pool.query<{ id: number }>(
      "SELECT id FROM rentals WHERE status IN ('confirmed', 'picked_up') LIMIT 1"
    );
    const rentalId = rentalRes.rows[0].id;

    // Staff view
    const staffRes = await request(app)
      .get(`/api/rentals/${rentalId}`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(staffRes.status).toBe(200);
    const staffData = staffRes.body.data;

    // No customer contact details
    expect(staffData.customer_contact).toBeUndefined();
    expect(staffData.customer_phone).toBeUndefined();
    expect(staffData).not.toHaveProperty('customer_contact');
    expect(staffData).not.toHaveProperty('customer_phone');

    // No money fields
    expect(staffData).not.toHaveProperty('applied_rate');
    for (const item of staffData.items) {
      expect(item.applied_rate).toBeUndefined();
      expect(item.discount_note).toBeUndefined();
      expect(item).not.toHaveProperty('applied_rate');
      expect(item).not.toHaveProperty('discount_note');
    }

    // Operational fields present
    expect(staffData).toHaveProperty('id');
    expect(staffData).toHaveProperty('customer_name');
    expect(staffData).toHaveProperty('site_name');
    expect(staffData).toHaveProperty('status');
    expect(staffData.items[0]).toHaveProperty('asset_code');
    expect(staffData.items[0]).toHaveProperty('make');

    // Admin view has all contact and money details
    const adminRes = await request(app)
      .get(`/api/rentals/${rentalId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminRes.status).toBe(200);
    expect(adminRes.body.data).toHaveProperty('customer_contact');
    expect(adminRes.body.data).toHaveProperty('customer_phone');
    expect(adminRes.body.data.items[0]).toHaveProperty('applied_rate');
  });

  it('Role guards & invalid pickup: Staff cannot confirm or cancel, cannot pickup quotations', async () => {
    const availRes = await pool.query<{ id: number }>(
      "SELECT id FROM v_equipment_current WHERE status = 'available' LIMIT 1"
    );
    const assetId = availRes.rows[0].id;

    // Admin creates quotation
    const createRes = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer_id: 4,
        site_id: 5,
        start_date: '2026-11-20',
        expected_end: '2026-11-25',
        status: 'quotation',
        items: [{ equipment_id: assetId, applied_rate: 1500.00, rate_unit: 'daily' }]
      });
    expect(createRes.status).toBe(201);
    const rentalId = createRes.body.rental_id;

    // Staff cannot confirm (403)
    const staffConfirm = await request(app)
      .post(`/api/rentals/${rentalId}/confirm`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(staffConfirm.status).toBe(403);

    // Staff cannot cancel (403)
    const staffCancel = await request(app)
      .post(`/api/rentals/${rentalId}/cancel`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(staffCancel.status).toBe(403);

    // Cannot pickup quotation before confirmation (400)
    const pickupQuote = await request(app)
      .post(`/api/rentals/${rentalId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ note: 'Attempting invalid pickup' });
    expect(pickupQuote.status).toBe(400);
    expect(pickupQuote.body.error).toMatch(/must be confirmed first/i);

    // Admin confirms quotation (200)
    const adminConfirm = await request(app)
      .post(`/api/rentals/${rentalId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminConfirm.status).toBe(200);
    expect(adminConfirm.body.status).toBe('confirmed');

    // Admin cancels confirmed rental (200)
    const adminCancel = await request(app)
      .post(`/api/rentals/${rentalId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminCancel.status).toBe(200);
    expect(adminCancel.body.status).toBe('cancelled');
  });
});
