import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { seedDatabase } from '../db/seed.js';
import { sanitizeFinancials } from '../serializers/rateSerializer.js';

describe('Step 4: Authentication, RBAC & Token Security Suite', () => {
  let adminToken: string;
  let staffToken: string;

  beforeAll(async () => {
    // Re-seed to guarantee test credentials and baseline state
    await seedDatabase();

    // Login as Admin
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@spaceexspace.com', password: 'Admin#2026!Dev' });
    adminToken = adminRes.body.token;

    // Login as Staff
    const staffRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@spaceexspace.com', password: 'Staff#2026!Dev' });
    staffToken = staffRes.body.token;
  });

  afterAll(async () => {
    // Re-seed after tests to keep DB pristine
    await seedDatabase();
  });

  describe('POST /api/auth/login', () => {
    it('authenticates valid admin credentials and returns JWT token + user profile', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@spaceexspace.com', password: 'Admin#2026!Dev' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(typeof res.body.token).toBe('string');
      expect(res.body.user).toEqual({
        id: expect.any(Number),
        name: 'Abdullah Al-Dosari (Operations Director)',
        email: 'admin@spaceexspace.com',
        role: 'admin',
      });
    });

    it('authenticates valid staff credentials and returns JWT token + user profile', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'staff@spaceexspace.com', password: 'Staff#2026!Dev' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(typeof res.body.token).toBe('string');
      expect(res.body.user).toEqual({
        id: expect.any(Number),
        name: 'Tariq Mansour (Yard Lead)',
        email: 'staff@spaceexspace.com',
        role: 'staff',
      });
    });

    it('rejects invalid password with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@spaceexspace.com', password: 'WrongPassword123!' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid email or password/i);
      expect(res.body.token).toBeUndefined();
    });

    it('rejects non-existent user email with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@spaceexspace.com', password: 'AnyPassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid email or password/i);
    });

    it('rejects deactivated user accounts', async () => {
      // Temporarily insert a disabled user
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role, active)
         VALUES ('Disabled User', 'disabled@spaceexspace.com', '$2b$10$dummyhashnotreal', 'staff', false)
         ON CONFLICT (email) DO UPDATE SET active = false`
      );

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'disabled@spaceexspace.com', password: 'AnyPassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/deactivated|invalid/i);

      // Clean up
      await pool.query(`DELETE FROM users WHERE email = 'disabled@spaceexspace.com'`);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Authentication required/i);
    });

    it('returns 401 when token is malformed', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token-string');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid authentication token/i);
    });

    it('returns user profile when authenticated with valid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({
        id: expect.any(Number),
        name: 'Abdullah Al-Dosari (Operations Director)',
        email: 'admin@spaceexspace.com',
        role: 'admin',
      });
    });
  });

  describe('RBAC and Rate Stripping (/api/rates)', () => {
    it('allows admin to access standard rate cards (200 OK)', async () => {
      const res = await request(app)
        .get('/api/rates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.rates).toBeDefined();
      expect(Array.isArray(res.body.rates)).toBe(true);
      expect(res.body.rates.length).toBeGreaterThan(0);
      // Admin sees rate amounts
      expect(res.body.rates[0]).toHaveProperty('amount');
    });

    it('STRICTLY FORBIDS staff from accessing standard rate cards (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/rates')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/insufficient permissions/i);
      expect(res.body.rates).toBeUndefined();
    });

    it('demonstrates server-side rate serialization: Admin sees financial terms', async () => {
      const res = await request(app)
        .get('/api/rates/rental-quote-demo')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('admin');
      expect(res.body.data).toHaveProperty('asset_code');
      expect(res.body.data).toHaveProperty('applied_rate');
      expect(res.body.data).toHaveProperty('rate_unit');
      expect(res.body.data.applied_rate).toBeDefined();
    });

    it('demonstrates server-side rate serialization: Staff NEVER sees applied_rate or discount_note', async () => {
      const res = await request(app)
        .get('/api/rates/rental-quote-demo')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('staff');
      // Staff CAN see operational details
      expect(res.body.data).toHaveProperty('asset_code');
      expect(res.body.data).toHaveProperty('customer_name');
      expect(res.body.data).toHaveProperty('site_name');
      expect(res.body.data).toHaveProperty('rental_status');
      expect(res.body.data).toHaveProperty('rate_unit');

      // Staff CANNOT see sensitive financial details: keys must NOT exist in JSON
      expect(res.body.data).not.toHaveProperty('applied_rate');
      expect(res.body.data).not.toHaveProperty('discount_note');
      expect(res.body.data.applied_rate).toBeUndefined();
      expect(res.body.data.discount_note).toBeUndefined();
    });
  });

  describe('Unit Test: sanitizeFinancials()', () => {
    it('strips all restricted financial keys recursively from objects and arrays for staff', () => {
      const sensitiveRecord = {
        id: 101,
        asset_code: 'CRN-50T-01',
        applied_rate: '2500.00',
        rate_unit: 'daily',
        discount_note: 'VIP customer 10% off',
        cost: '450.00',
        invoice: {
          subtotal: '2500.00',
          vat_amount: '375.00',
          total: '2875.00',
          lines: [
            { line_no: 1, unit_price: '2500.00', description: 'Crane rental' },
          ],
        },
      };

      const sanitizedForStaff = sanitizeFinancials(sensitiveRecord, 'staff');

      expect(sanitizedForStaff).toEqual({
        id: 101,
        asset_code: 'CRN-50T-01',
        rate_unit: 'daily',
        invoice: {
          lines: [
            { line_no: 1, description: 'Crane rental' },
          ],
        },
      });

      // Confirm raw object retains all values for admin
      const untouchedForAdmin = sanitizeFinancials(sensitiveRecord, 'admin');
      expect(untouchedForAdmin).toEqual(sensitiveRecord);
    });

    it('strips customer contact details (customer_contact, customer_phone, contact_person, phone, email) for staff', () => {
      const record = {
        id: 1,
        customer_name: 'Apex Infrastructure',
        customer_contact: 'Eng. Tariq Al-Ghamdi',
        customer_phone: '+966 50 123 4567',
        contact_person: 'Eng. Tariq',
        phone: '+966 50 123 4567',
        email: 'tariq@apex.sa',
        site_name: 'Ras Tanura Site'
      };

      const sanitized = sanitizeFinancials(record, 'staff');
      expect(sanitized).toEqual({
        id: 1,
        customer_name: 'Apex Infrastructure',
        site_name: 'Ras Tanura Site'
      });

      const adminView = sanitizeFinancials(record, 'admin');
      expect(adminView).toEqual(record);
    });
  });
});
