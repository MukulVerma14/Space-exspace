import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { seedDatabase } from '../db/seed.js';

describe('Equipment API & QR Actions Suite', () => {
  let adminToken: string;
  let staffToken: string;

  beforeAll(async () => {
    // Seed fresh database state
    await seedDatabase();

    // Authenticate admin
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@spaceexspace.com', password: 'Admin#2026!Dev' });
    adminToken = adminRes.body.token;

    // Authenticate staff
    const staffRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@spaceexspace.com', password: 'Staff#2026!Dev' });
    staffToken = staffRes.body.token;
  });

  afterAll(async () => {
    // Cleanly restore canonical database state for other test suites
    await seedDatabase();
  });

  describe('GET /api/equipment (Fleet List & Filters)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/equipment');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Authentication required/i);
    });

    it('returns paginated equipment fleet for staff with metadata', async () => {
      const res = await request(app)
        .get('/api/equipment?page=1&limit=10')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBe(10);
      expect(res.body.pagination).toEqual({
        total: expect.any(Number),
        page: 1,
        limit: 10,
        totalPages: expect.any(Number),
        hasNext: true,
        hasPrev: false,
      });

      // Verify essential equipment properties from v_equipment_current
      const firstItem = res.body.items[0];
      expect(firstItem).toHaveProperty('asset_code');
      expect(firstItem).toHaveProperty('make');
      expect(firstItem).toHaveProperty('model');
      expect(firstItem).toHaveProperty('type_name');
      expect(firstItem).toHaveProperty('current_location_name');
      expect(firstItem).toHaveProperty('status');
    });

    it('filters equipment list by status', async () => {
      const resAvailable = await request(app)
        .get('/api/equipment?status=available')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resAvailable.status).toBe(200);
      for (const item of resAvailable.body.items) {
        expect(item.status).toBe('available');
      }

      const resRented = await request(app)
        .get('/api/equipment?status=rented')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resRented.status).toBe(200);
      expect(resRented.body.items.length).toBe(7); // Seeded active rentals contain 7 items
      for (const item of resRented.body.items) {
        expect(item.status).toBe('rented');
        expect(item.current_customer_name).toBeDefined();
      }
    });

    it('searches equipment by query across make, model, and asset code', async () => {
      const res = await request(app)
        .get('/api/equipment?search=Tadano')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      for (const item of res.body.items) {
        expect(item.make.toLowerCase()).toContain('tadano');
      }
    });
  });

  describe('GET /api/equipment/:asset_code (QR Scan Resolution)', () => {
    it('returns 404 if asset code does not exist', async () => {
      const res = await request(app)
        .get('/api/equipment/NONEXISTENT-999')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/was not found/i);
    });

    it('scans equipment and provides location history and active rental details', async () => {
      // Find a known rented crane from seed
      const res = await request(app)
        .get('/api/equipment/CRN-50-001')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.asset_code).toBe('CRN-50-001');
      expect(res.body.status).toBe('rented');
      expect(res.body.location_history).toBeDefined();
      expect(Array.isArray(res.body.location_history)).toBe(true);
      expect(res.body.location_history.length).toBeGreaterThan(0);

      // Admin has access to active rental terms and standard rates
      expect(res.body.active_rental).toBeDefined();
      expect(res.body.active_rental.customer_name).toBe('Apex Infrastructure Partners');
      expect(res.body.active_rental.applied_rate).toBeDefined();
      expect(res.body.standard_rates).toBeDefined();
    });

    it('STRICTLY hides applied_rate, discount_note, and standard_rates when scanned by staff', async () => {
      const res = await request(app)
        .get('/api/equipment/CRN-50-001')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.asset_code).toBe('CRN-50-001');
      expect(res.body.status).toBe('rented');

      // Staff sees operational data
      expect(res.body.current_location_name).toBeDefined();
      expect(res.body.active_rental).toBeDefined();
      expect(res.body.active_rental.customer_name).toBe('Apex Infrastructure Partners');
      expect(res.body.active_rental.site_name).toBeDefined();

      // Staff MUST NOT see sensitive financial data
      expect(res.body.active_rental).not.toHaveProperty('applied_rate');
      expect(res.body.active_rental).not.toHaveProperty('discount_note');
      expect(res.body).not.toHaveProperty('standard_rates');
      expect(res.body.applied_rate).toBeUndefined();
    });
  });

  describe('POST /api/equipment/:asset_code/move (Action: Transfer Location)', () => {
    it('moves an available equipment to a new yard and updates location_log', async () => {
      // Pick an available equipment
      const availableEquipRes = await pool.query(
        `SELECT asset_code FROM v_equipment_current WHERE status = 'available' LIMIT 1`
      );
      const assetCode = availableEquipRes.rows[0].asset_code;

      // Get Jubail Storage Yard location ID
      const jubailRes = await pool.query(
        `SELECT id, name FROM locations WHERE name = 'Jubail Storage Yard'`
      );
      const jubailYardId = jubailRes.rows[0].id;

      const res = await request(app)
        .post(`/api/equipment/${assetCode}/move`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          location_id: jubailYardId,
          note: 'Transferred by low-bed trailer to Jubail',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/successfully moved to Jubail Storage Yard/i);
      expect(res.body.equipment.current_location_name).toBe('Jubail Storage Yard');

      // Verify that a row was appended to location_log
      const logCheck = await pool.query(
        `SELECT ll.*, u.email AS user_email
         FROM location_log ll
         JOIN users u ON u.id = ll.moved_by
         WHERE ll.equipment_id = $1
         ORDER BY ll.moved_at DESC LIMIT 1`,
        [res.body.equipment.id]
      );
      expect(logCheck.rows.length).toBe(1);
      expect(logCheck.rows[0].location_id).toBe(jubailYardId);
      expect(logCheck.rows[0].user_email).toBe('staff@spaceexspace.com');
      expect(logCheck.rows[0].note).toBe('Transferred by low-bed trailer to Jubail');
    });

    it('rejects move if target location does not exist', async () => {
      const res = await request(app)
        .post('/api/equipment/CRN-50-001/move')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ location_id: 999999 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/does not exist/i);
    });
  });

  describe('POST /api/equipment/:asset_code/return (Action: Return from Rental)', () => {
    it('rejects return action if equipment is not actively rented', async () => {
      // Find an available equipment
      const availableRes = await pool.query(
        `SELECT asset_code FROM v_equipment_current WHERE status = 'available' LIMIT 1`
      );
      const assetCode = availableRes.rows[0].asset_code;

      const yardRes = await pool.query(`SELECT id FROM locations WHERE kind = 'yard' LIMIT 1`);

      const res = await request(app)
        .post(`/api/equipment/${assetCode}/return`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ location_id: yardRes.rows[0].id });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/does not have an active rental to return/i);
    });

    it('returns a rented crane, sets returned_at, writes location_log, and switches status to available', async () => {
      const assetCode = 'CRN-50-001';

      // Verify it starts as rented
      const beforeRes = await pool.query(
        `SELECT status, current_rental_id FROM v_equipment_current WHERE asset_code = $1`,
        [assetCode]
      );
      expect(beforeRes.rows[0].status).toBe('rented');
      const rentalId = beforeRes.rows[0].current_rental_id;

      // Get SPACE Central Dammam Yard ID
      const yardRes = await pool.query(
        `SELECT id FROM locations WHERE name = 'SPACE Central Dammam Yard'`
      );
      const dammamYardId = yardRes.rows[0].id;

      const res = await request(app)
        .post(`/api/equipment/${assetCode}/return`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          location_id: dammamYardId,
          condition: 'good',
          note: 'Completed project at Ras Tanura; returned clean',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/successfully returned/i);

      // Verify v_equipment_current immediately derives 'available'
      expect(res.body.equipment.status).toBe('available');
      expect(res.body.equipment.current_location_name).toBe('SPACE Central Dammam Yard');

      // Verify returned_at was updated on rental_items
      const itemCheck = await pool.query(
        `SELECT returned_at FROM rental_items WHERE rental_id = $1 AND equipment_id = $2`,
        [rentalId, res.body.equipment.id]
      );
      expect(itemCheck.rows[0].returned_at).not.toBeNull();
    });
  });

  describe('POST /api/equipment/:asset_code/repair (Action: Send to Repair)', () => {
    it('rejects sending equipment to repair if actively rented', async () => {
      // Find an equipment that is currently rented
      const rentedRes = await pool.query(
        `SELECT asset_code FROM v_equipment_current WHERE status = 'rented' LIMIT 1`
      );
      const assetCode = rentedRes.rows[0].asset_code;

      const res = await request(app)
        .post(`/api/equipment/${assetCode}/repair`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          kind: 'repair',
          description: 'Engine oil leaking',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/is actively rented/i);
    });

    it('rejects sending equipment to repair if it is already under repair', async () => {
      // Find equipment currently under repair
      const underRepairRes = await pool.query(
        `SELECT asset_code FROM v_equipment_current WHERE status = 'under_repair' LIMIT 1`
      );
      const assetCode = underRepairRes.rows[0].asset_code;

      const res = await request(app)
        .post(`/api/equipment/${assetCode}/repair`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          kind: 'repair',
          description: 'Secondary inspection',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already has an open maintenance work order/i);
    });

    it('successfully sends an available equipment to repair, updates location_log and condition', async () => {
      // Pick an available equipment
      const availableRes = await pool.query(
        `SELECT asset_code FROM v_equipment_current WHERE status = 'available' LIMIT 1`
      );
      const assetCode = availableRes.rows[0].asset_code;

      const res = await request(app)
        .post(`/api/equipment/${assetCode}/repair`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          kind: 'repair',
          description: 'Boom cylinder seal leaking hydraulic oil',
          note: 'Urgent fix needed before next rental',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/successfully sent to maintenance/i);
      expect(res.body.equipment.status).toBe('under_repair');
      expect(res.body.equipment.condition).toBe('needs_repair');
      expect(res.body.equipment.current_maintenance_desc).toBe('Boom cylinder seal leaking hydraulic oil');

      // Check maintenance table has the record
      const maintCheck = await pool.query(
        `SELECT * FROM maintenance WHERE equipment_id = $1 AND closed_at IS NULL`,
        [res.body.equipment.id]
      );
      expect(maintCheck.rows.length).toBe(1);
      expect(maintCheck.rows[0].description).toBe('Boom cylinder seal leaking hydraulic oil');
      // For staff, cost must default to 0
      expect(Number(maintCheck.rows[0].cost)).toBe(0);
    });
  });
});
