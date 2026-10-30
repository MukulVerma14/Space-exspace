import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

describe('Step 6: Equipment QR Labels Sheet (GET /api/labels/sheet)', () => {
  let adminToken: string;
  let staffToken: string;

  beforeAll(async () => {
    // 1. Authenticate admin user
    const adminLoginRes = await request(app).post('/api/auth/login').send({
      email: 'admin@spaceexspace.com',
      password: 'Admin#2026!Dev',
    });
    expect(adminLoginRes.status).toBe(200);
    adminToken = adminLoginRes.body.token;

    // 2. Authenticate staff user
    const staffLoginRes = await request(app).post('/api/auth/login').send({
      email: 'staff@spaceexspace.com',
      password: 'Staff#2026!Dev',
    });
    expect(staffLoginRes.status).toBe(200);
    staffToken = staffLoginRes.body.token;
  });

  describe('Authentication & Access Control', () => {
    it('rejects unauthenticated requests with HTTP 401 Unauthorized', async () => {
      const res = await request(app).get('/api/labels/sheet?assetCodes=CRN-50-001');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Authentication required/i);
    });

    it('allows staff role to access printable label sheet', async () => {
      const res = await request(app)
        .get('/api/labels/sheet?assetCodes=CRN-50-001')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.header['content-type']).toMatch(/text\/html/);
    });

    it('allows admin role to access printable label sheet', async () => {
      const res = await request(app)
        .get('/api/labels/sheet?assetCodes=CRN-50-001')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.header['content-type']).toMatch(/text\/html/);
    });
  });

  describe('QR Payload & Decoding Verification', () => {
    it('produces a QR code whose decoded payload is strictly the plain asset_code (no URL)', async () => {
      const assetCode = 'CRN-50-001';
      const res = await request(app)
        .get(`/api/labels/sheet?assetCodes=${assetCode}&format=json`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.labels[0].asset_code).toBe(assetCode);

      // Extract the QR PNG data URL
      const qrDataUrl: string = res.body.labels[0].qr_data_url;
      expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);

      // Decode the PNG buffer
      const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const png = PNG.sync.read(imageBuffer);

      // Decode the QR matrix with jsQR
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      expect(decoded).not.toBeNull();
      // CRITICAL ASSERTION: Plain natural key ONLY. Not a URL!
      expect(decoded!.data).toBe(assetCode);
      expect(decoded!.data).not.toMatch(/^https?:\/\//);
    });

    it('decodes QR codes correctly from the rendered HTML sheet image src', async () => {
      const res = await request(app)
        .get('/api/labels/sheet?assetCodes=GEN-250-001&format=html')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('GEN-250-001');

      // Extract img src using regex
      const match = res.text.match(/<img[^>]+src="(data:image\/png;base64,[^"]+)"/);
      expect(match).not.toBeNull();
      const qrDataUrl = match![1];

      const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const png = PNG.sync.read(imageBuffer);
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

      expect(decoded).not.toBeNull();
      expect(decoded!.data).toBe('GEN-250-001');
    });
  });

  describe('Unknown Code Handling', () => {
    it('returns HTTP 404 when an unknown asset code is requested in assetCodes', async () => {
      const res = await request(app)
        .get('/api/labels/sheet?assetCodes=NONEXISTENT-CODE-999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Equipment not found');
      expect(res.body.message).toContain('NONEXISTENT-CODE-999');
    });

    it('returns HTTP 404 if ANY code in a multi-code list is unknown', async () => {
      const res = await request(app)
        .get('/api/labels/sheet?assetCodes=CRN-50-001,UNKNOWN-999')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Equipment not found');
      expect(res.body.message).toContain('UNKNOWN-999');
    });

    it('returns HTTP 404 if filter matches no equipment', async () => {
      const res = await request(app)
        .get('/api/labels/sheet?type=NonExistentMachineTypeXYZ')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Equipment not found');
    });
  });

  describe('Hard Cap Enforcement (MAX 50 Labels)', () => {
    it('rejects assetCodes list containing more than 50 items with HTTP 400 Bad Request', async () => {
      const excessiveCodes = Array.from({ length: 51 }, (_, i) => `CODE-${i + 1}`).join(',');
      const res = await request(app)
        .get(`/api/labels/sheet?assetCodes=${excessiveCodes}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Label limit exceeded');
      expect(res.body.message).toMatch(/hard cap of 50 labels/);
    });

    it('rejects explicit limit parameter greater than 50 with HTTP 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/labels/sheet?type=Crane&limit=51')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Label limit exceeded');
      expect(res.body.message).toMatch(/hard cap of 50 labels/);
    });

    it('enforces hard cap if an unbounded filter matches more than 50 items', async () => {
      // Create temporary equipment rows in the database to test exceeding 50 items
      const rows = [];
      for (let i = 1; i <= 55; i++) {
        rows.push(`('TMP-CAP-${i}', 'SN-CAP-${i}', 1, 'good', true)`);
      }
      await pool.query(
        `INSERT INTO equipment (asset_code, serial_no, model_id, condition, active)
         VALUES ${rows.join(', ')}`
      );

      try {
        // Query by type_id=1 without explicit limit: total matching > 50
        const res = await request(app)
          .get('/api/labels/sheet?type_id=1')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Label limit exceeded');
        expect(res.body.message).toMatch(/exceeding the hard cap of 50 labels/);

        // Explicit limit=50 succeeds within the cap
        const cappedRes = await request(app)
          .get('/api/labels/sheet?type_id=1&limit=50&format=json')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(cappedRes.status).toBe(200);
        expect(cappedRes.body.count).toBe(50);
      } finally {
        await pool.query("DELETE FROM equipment WHERE asset_code LIKE 'TMP-CAP-%'");
      }
    });
  });

  describe('Zero Money / Commercial Fields Invariant', () => {
    it('verifies rendered HTML output contains zero financial data or money keywords', async () => {
      const res = await request(app)
        .get('/api/labels/sheet?assetCodes=CRN-50-001,GEN-250-001')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      const html = res.text;

      // Ensure operational identifiers are present
      expect(html).toContain('CRN-50-001');
      expect(html).toContain('GEN-250-001');
      expect(html).toContain('SPACE EXSPACE');

      // STRICT CHECK: Ensure absolutely no financial keywords or fields exist in output
      const prohibitedKeywords = [
        'applied_rate',
        'rate_unit',
        'rate',
        'SAR',
        'price',
        'cost',
        'vat',
        'invoice',
        'rental_id',
        'discount',
        'amount',
        'subtotal',
        'total',
        '$',
      ];

      for (const keyword of prohibitedKeywords) {
        // Test case-insensitive word boundary or tag occurrence
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        expect(html).not.toMatch(regex);
      }
    });

    it('verifies JSON response objects contain zero financial properties', async () => {
      const res = await request(app)
        .get('/api/labels/sheet?assetCodes=CRN-50-001,GEN-250-001&format=json')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.labels.length).toBe(2);

      const prohibitedKeys = [
        'applied_rate',
        'rate',
        'rates',
        'rate_unit',
        'price',
        'cost',
        'unit_cost',
        'unit_price',
        'vat',
        'amount',
        'subtotal',
        'total',
        'rental_id',
      ];

      for (const label of res.body.labels) {
        for (const key of prohibitedKeys) {
          expect(label).not.toHaveProperty(key);
        }
        // Verify expected operational fields
        expect(label).toHaveProperty('asset_code');
        expect(label).toHaveProperty('make');
        expect(label).toHaveProperty('model');
        expect(label).toHaveProperty('type_name');
        expect(label).toHaveProperty('qr_data_url');
      }
    });
  });

  describe('Filter-Based Sheet Generation', () => {
    it('generates labels by equipment type filter (e.g. type=Crane)', async () => {
      const res = await request(app)
        .get('/api/labels/sheet?type=Crane&format=json')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThan(0);
      for (const label of res.body.labels) {
        expect(label.type_name).toMatch(/Crane/i);
      }
    });

    it('generates labels by status filter (e.g. status=available)', async () => {
      const res = await request(app)
        .get('/api/labels/sheet?status=available&limit=10&format=json')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBeLessThanOrEqual(10);
    });

    it('rejects request with HTTP 400 when neither assetCodes nor filter criteria is supplied', async () => {
      const res = await request(app)
        .get('/api/labels/sheet')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid request');
    });
  });
});
