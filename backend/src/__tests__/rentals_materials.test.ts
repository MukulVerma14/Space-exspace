import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { seedDatabase } from '../db/seed.js';

describe('Step 5: Rentals & Materials Inventory API Suite', () => {
  let adminToken: string;
  let staffToken: string;
  let createdTestRentalId: number | null = null;

  beforeAll(async () => {
    // Re-seed database to ensure clean, predictable state
    await seedDatabase();

    // Authenticate admin user
    const adminLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@spaceexspace.com', password: 'Admin#2026!Dev' });
    adminToken = adminLoginRes.body.token;

    // Authenticate staff user
    const staffLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@spaceexspace.com', password: 'Staff#2026!Dev' });
    staffToken = staffLoginRes.body.token;
  });

  afterAll(async () => {
    // Cleanly delete test records to avoid polluting other test suites (such as seed.test.ts)
    await pool.query(`DELETE FROM stock_movements WHERE invoice_line_invoice_id IN (SELECT id FROM invoices WHERE invoice_no LIKE 'TEST-SUP-%')`);
    await pool.query(`DELETE FROM invoices WHERE invoice_no LIKE 'TEST-SUP-%'`);

    if (createdTestRentalId) {
      await pool.query(`DELETE FROM rental_items WHERE rental_id = $1`, [createdTestRentalId]);
      await pool.query(`DELETE FROM rentals WHERE id = $1`, [createdTestRentalId]);
    }

    await seedDatabase();
  });

  describe('Rentals API Lifecycle & Double-Booking Prevention', () => {
    it('allows Admin to list rentals and view financial applied rates', async () => {
      const res = await request(app)
        .get('/api/rentals')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
      expect(res.body.pagination).toBeDefined();

      // Check detailed rental by ID for admin
      const rentalId = res.body.data[0].id;
      const detailRes = await request(app)
        .get(`/api/rentals/${rentalId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.items[0]).toHaveProperty('applied_rate');
      expect(Number(detailRes.body.data.items[0].applied_rate)).toBeGreaterThan(0);
    });

    it('sanitizes rates and financial fields when Staff views rentals', async () => {
      const res = await request(app)
        .get('/api/rentals')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);

      const rentalId = res.body.data[0].id;
      const detailRes = await request(app)
        .get(`/api/rentals/${rentalId}`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(detailRes.status).toBe(200);
      const items = detailRes.body.data.items;
      expect(items.length).toBeGreaterThan(0);
      // Operational details exist, but commercial rates are physically omitted!
      expect(items[0]).toHaveProperty('asset_code');
      expect(items[0]).toHaveProperty('make');
      expect(items[0]).not.toHaveProperty('applied_rate');
      expect(items[0]).not.toHaveProperty('discount_note');
    });

    it('rejects Staff from creating a new rental contract (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/rentals')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          customer_id: 1,
          site_id: 5,
          start_date: '2026-11-01',
          expected_end: '2026-11-30',
          items: [{ equipment_id: 1, applied_rate: 1000, rate_unit: 'daily' }]
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Forbidden/i);
    });

    it('prevents double-booking an asset that is currently rented (409 Conflict)', async () => {
      // Find an asset that is currently rented
      const rentedRes = await pool.query<{ id: number; asset_code: string }>(
        `SELECT id, asset_code FROM v_equipment_current WHERE status = 'rented' LIMIT 1`
      );
      expect(rentedRes.rows.length).toBe(1);
      const rentedAsset = rentedRes.rows[0];

      // Attempt to create a new rental containing this already-rented asset
      const res = await request(app)
        .post('/api/rentals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer_id: 4, // Apex Infrastructure Partners
          site_id: 5,     // Ras Tanura Refinery Site
          start_date: '2026-11-01',
          expected_end: '2026-11-15',
          status: 'confirmed',
          items: [
            {
              equipment_id: rentedAsset.id,
              applied_rate: 1800.00,
              rate_unit: 'daily',
              discount_note: 'Attempted double-booking'
            }
          ]
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/currently unavailable/i);
      expect(res.body.conflict_asset_code).toBe(rentedAsset.asset_code);
    });

    it('allows Admin to create a rental with an available asset, then pickup and return it', async () => {
      // Find an available crane or generator
      const availRes = await pool.query<{ id: number; asset_code: string }>(
        `SELECT id, asset_code FROM v_equipment_current WHERE status = 'available' LIMIT 1`
      );
      expect(availRes.rows.length).toBe(1);
      const availAsset = availRes.rows[0];

      // 1. Admin creates confirmed rental
      const createRes = await request(app)
        .post('/api/rentals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer_id: 4, // Apex Infrastructure
          site_id: 5,     // Ras Tanura site
          start_date: '2026-11-10',
          expected_end: '2026-11-20',
          status: 'confirmed',
          items: [
            {
              equipment_id: availAsset.id,
              applied_rate: 1650.00,
              rate_unit: 'daily',
              discount_note: 'Standard agreed daily tariff'
            }
          ]
        });

      expect(createRes.status).toBe(201);
      createdTestRentalId = createRes.body.rental_id;

      // Derived status in v_equipment_current should now immediately be 'rented'
      const statusRes1 = await pool.query(
        `SELECT status FROM v_equipment_current WHERE id = $1`,
        [availAsset.id]
      );
      expect(statusRes1.rows[0].status).toBe('rented');

      // 2. Staff picks up rental and dispatches it
      const pickupRes = await request(app)
        .post(`/api/rentals/${createdTestRentalId}/pickup`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ note: 'Mobilized with low-bed trailer' });

      expect(pickupRes.status).toBe(200);
      expect(pickupRes.body.dispatched_items_count).toBe(1);

      // Verify location_log shows site relocation
      const locRes = await pool.query(
        `SELECT current_location_id FROM v_equipment_current WHERE id = $1`,
        [availAsset.id]
      );
      expect(locRes.rows[0].current_location_id).toBe(5);

      // 3. Return rental back to central yard (location 1)
      const returnRes = await request(app)
        .post(`/api/rentals/${createdTestRentalId}/return`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ location_id: 1, note: 'Job completed safely' });

      expect(returnRes.status).toBe(200);
      expect(returnRes.body.returned_items_count).toBe(1);

      // Status in v_equipment_current should be back to 'available' at yard 1
      const finalRes = await pool.query(
        `SELECT status, current_location_id FROM v_equipment_current WHERE id = $1`,
        [availAsset.id]
      );
      expect(finalRes.rows[0].status).toBe('available');
      expect(finalRes.rows[0].current_location_id).toBe(1);
    });
  });

  describe('Materials Ledger & Non-Negative Trigger', () => {
    it('lists material SKUs with live SUM(qty) stock on hand', async () => {
      const res = await request(app)
        .get('/api/materials')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(10);
      const item = res.body.data[0];
      expect(item).toHaveProperty('sku');
      expect(item).toHaveProperty('current_stock');
      expect(Number(item.current_stock)).toBeGreaterThanOrEqual(0);
    });

    it('allows Staff to record a valid stock issue movement', async () => {
      // Find an item with stock > 10
      const itemRes = await pool.query<{ id: number; current_stock: string }>(
        `SELECT i.id, COALESCE(SUM(sm.qty), 0) AS current_stock
         FROM items i
         JOIN stock_movements sm ON sm.item_id = i.id
         GROUP BY i.id
         HAVING COALESCE(SUM(sm.qty), 0) >= 10
         LIMIT 1`
      );
      expect(itemRes.rows.length).toBe(1);
      const item = itemRes.rows[0];
      const initialStock = parseFloat(item.current_stock);

      const res = await request(app)
        .post('/api/materials/movements')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          item_id: item.id,
          type: 'issue',
          qty: 2.0,
          note: 'Used for routine vehicle maintenance'
        });

      expect(res.status).toBe(201);
      expect(res.body.delta_qty).toBe(-2.0);
      expect(res.body.current_stock).toBe(initialStock - 2.0);
    });

    it('rejects an issue that would cause negative inventory (database trigger enforcement)', async () => {
      // Find an item with limited stock
      const itemRes = await pool.query<{ id: number; current_stock: string }>(
        `SELECT i.id, COALESCE(SUM(sm.qty), 0) AS current_stock
         FROM items i
         JOIN stock_movements sm ON sm.item_id = i.id
         GROUP BY i.id
         LIMIT 1`
      );
      const item = itemRes.rows[0];
      const stock = parseFloat(item.current_stock);

      // Attempt to issue more units than exist
      const excessiveQty = stock + 5000;
      const res = await request(app)
        .post('/api/materials/movements')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          item_id: item.id,
          type: 'issue',
          qty: excessiveQty,
          note: 'Attempting invalid deficit issue'
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.error).toMatch(/Cannot issue/i);
    });
  });

  describe('Supplier Invoices & Price History Tracking Over Time', () => {
    it('allows Admin to record a received supplier invoice and auto-update stock receipt', async () => {
      // Pick a supplier (e.g. Gulf Heavy Metals Trading id=1)
      const supplierRes = await pool.query<{ id: number }>(
        `SELECT id FROM parties WHERE is_supplier = true LIMIT 1`
      );
      const supplierId = supplierRes.rows[0].id;

      // Pick item 1 (Mild Steel Plate)
      const itemRes = await pool.query<{ id: number; current_stock: string }>(
        `SELECT i.id, COALESCE(SUM(sm.qty), 0) AS current_stock
         FROM items i
         LEFT JOIN stock_movements sm ON sm.item_id = i.id
         WHERE i.id = 1
         GROUP BY i.id`
      );
      const initialStock = parseFloat(itemRes.rows[0].current_stock);

      const invoiceNo = `TEST-SUP-${Date.now()}`;
      const res = await request(app)
        .post('/api/invoices/supplier')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          party_id: supplierId,
          invoice_no: invoiceNo,
          invoice_date: '2026-10-28',
          due_date: '2026-11-28',
          subtotal: 2500.00,
          vat_amount: 375.00,
          total: 2875.00,
          notes: 'Emergency batch of steel plates',
          record_stock_receipt: true,
          lines: [
            {
              item_id: 1,
              description: 'Mild Steel Plate 6mm',
              quantity: 10.000,
              unit_id: 1, // pcs
              unit_price: 250.00
            }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.invoice_no).toBe(invoiceNo);

      // Verify stock increased by 10.000
      const updatedStockRes = await pool.query<{ current_stock: string }>(
        `SELECT COALESCE(SUM(qty), 0) AS current_stock FROM stock_movements WHERE item_id = 1`
      );
      expect(parseFloat(updatedStockRes.rows[0].current_stock)).toBe(initialStock + 10.0);
    });

    it('captures material price history over time from supplier invoices (Admin only)', async () => {
      const res = await request(app)
        .get('/api/materials/1/price-history')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.item_id).toBe(1);
      expect(res.body.price_history.length).toBeGreaterThanOrEqual(1);

      const latestPriceRecord = res.body.price_history[0];
      expect(latestPriceRecord).toHaveProperty('unit_price');
      expect(latestPriceRecord).toHaveProperty('supplier_name');
      expect(latestPriceRecord).toHaveProperty('invoice_no');
      expect(latestPriceRecord).toHaveProperty('invoice_date');
    });

    it('forbids Staff from viewing material price history (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/materials/1/price-history')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Forbidden/i);
    });
  });
});
