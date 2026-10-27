import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { seedDatabase } from '../db/seed.js';
import { sanitizeFinancials } from '../serializers/rateSerializer.js';

describe('Auth, RBAC, and Server-Side Rate Serialization Suite', () => {
  let adminToken: string;
  let staffToken: string;

  beforeAll(async () => {
    // Ensure database is populated with initial seeded users and records
    await seedDatabase();

    // Authenticate admin to obtain valid token
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@spaceexspace.com', password: 'Admin#2026!Dev' });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.token;

    // Authenticate staff to obtain valid token
    const staffRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@spaceexspace.com', password: 'Staff#2026!Dev' });
    expect(staffRes.status).toBe(200);
    staffToken = staffRes.body.token;
  });

  describe('POST /api/auth/login', () => {
    it('successfully logs in admin and returns token and user profile', async () => {
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

    it('successfully logs in staff and returns role = staff', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'staff@spaceexspace.com', password: 'Staff#2026!Dev' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.role).toBe('staff');
      expect(res.body.user.name).toBe('Tariq Mansour (Yard Lead)');
    });

    it('rejects incorrect password with 401 and generic message', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@spaceexspace.com', password: 'WrongPassword123!' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('rejects non-existent email with 401 without revealing user existence', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@spaceexspace.com', password: 'SomePassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('rejects invalid email format with 400 validation error', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'not-an-email', password: 'Password123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details.email).toBeDefined();
    });

    it('rejects deactivated user accounts', async () => {
      // Temporarily insert a deactivated user
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
  });
});
