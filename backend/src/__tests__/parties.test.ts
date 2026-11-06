import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { seedDatabase } from '../db/seed.js';

describe('Parties API Suite — GET /api/parties (Admin Only)', () => {
  let adminToken: string;
  let staffToken: string;

  beforeAll(async () => {
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

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/parties');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Authentication required');
  });

  it('rejects staff requests with 403 Forbidden', async () => {
    const res = await request(app)
      .get('/api/parties')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('insufficient permissions');
  });

  it('returns all active parties for admin', async () => {
    const res = await request(app)
      .get('/api/parties')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.count).toBe(res.body.data.length);

    const first = res.body.data[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('is_customer');
    expect(first).toHaveProperty('is_supplier');
  });

  it('filters customers when role=customer is requested', async () => {
    const res = await request(app)
      .get('/api/parties?role=customer')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const party of res.body.data) {
      expect(party.is_customer).toBe(true);
    }
  });

  it('filters suppliers when role=supplier is requested', async () => {
    const res = await request(app)
      .get('/api/parties?role=supplier')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const party of res.body.data) {
      expect(party.is_supplier).toBe(true);
    }
  });

  it('rejects invalid role query parameter with 400 Bad Request', async () => {
    const res = await request(app)
      .get('/api/parties?role=vendor_partner')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid role filter");
  });

  it('supports search query filter', async () => {
    const res = await request(app)
      .get('/api/parties?role=supplier&search=Gulf')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const party of res.body.data) {
      expect(party.is_supplier).toBe(true);
      const matches =
        party.name.includes('Gulf') ||
        (party.contact_person && party.contact_person.includes('Gulf')) ||
        (party.email && party.email.includes('Gulf'));
      expect(matches).toBe(true);
    }
  });
});
