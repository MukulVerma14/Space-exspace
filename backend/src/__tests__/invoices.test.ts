import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { seedDatabase } from '../db/seed.js';

describe('Invoices API Suite — Issued & Received Invoices (Store-Only Workflow)', () => {
  let adminToken: string;
  let staffToken: string;
  let adminUserId: number;
  let customerPartyId: number;
  let otherCustomerPartyId: number;
  let supplierPartyId: number;
  let unitId: number;
  let itemId: number;
  let customerRentalId: number;
  let createdTestRentalId: number | null = null;

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

    // Retrieve admin user ID
    const adminUserRes = await pool.query<{ id: string | number }>(
      `SELECT id FROM users WHERE email = 'admin@spaceexspace.com'`
    );
    adminUserId = parseInt(adminUserRes.rows[0].id as string, 10);

    // Retrieve parties
    const customersRes = await pool.query<{ id: string | number; name: string }>(
      `SELECT id, name FROM parties WHERE is_customer = true ORDER BY id ASC LIMIT 2`
    );
    customerPartyId = parseInt(customersRes.rows[0].id as string, 10);
    otherCustomerPartyId = parseInt(customersRes.rows[1].id as string, 10);

    const supplierRes = await pool.query<{ id: string | number }>(
      `SELECT id FROM parties WHERE is_supplier = true LIMIT 1`
    );
    supplierPartyId = parseInt(supplierRes.rows[0].id as string, 10);

    // Retrieve standard unit and item
    const unitRes = await pool.query<{ id: string | number }>(`SELECT id FROM units LIMIT 1`);
    unitId = parseInt(unitRes.rows[0].id as string, 10);

    const itemRes = await pool.query<{ id: string | number }>(`SELECT id FROM items LIMIT 1`);
    itemId = parseInt(itemRes.rows[0].id as string, 10);

    // Retrieve or create a rental belonging to customerPartyId
    const rentalRes = await pool.query<{ id: string | number }>(
      `SELECT id FROM rentals WHERE customer_id = $1 LIMIT 1`,
      [customerPartyId]
    );
    if (rentalRes.rows.length > 0) {
      customerRentalId = parseInt(rentalRes.rows[0].id as string, 10);
    } else {
      // Pick a site location
      const locRes = await pool.query<{ id: string | number }>(`SELECT id FROM locations LIMIT 1`);
      const siteId = parseInt(locRes.rows[0].id as string, 10);

      const newRental = await pool.query<{ id: string | number }>(
        `INSERT INTO rentals (customer_id, site_id, status, start_date, expected_end)
         VALUES ($1, $2, 'confirmed', '2026-10-01', '2026-10-31')
         RETURNING id`,
        [customerPartyId, siteId]
      );
      customerRentalId = parseInt(newRental.rows[0].id as string, 10);
      createdTestRentalId = customerRentalId;
    }
  });

  afterAll(async () => {
    // Cleanup test records
    await pool.query(`DELETE FROM stock_movements WHERE note LIKE '%INV-TEST-%'`);
    await pool.query(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE invoice_no LIKE 'INV-TEST-%')`);
    await pool.query(`DELETE FROM invoices WHERE invoice_no LIKE 'INV-TEST-%'`);
    if (createdTestRentalId) {
      await pool.query(`DELETE FROM rentals WHERE id = $1`, [createdTestRentalId]);
    }
    await seedDatabase();
  });

  describe('Role-Based Access Control (Admin-Only)', () => {
    it('returns 403 Forbidden when staff attempts to create a customer invoice', async () => {
      const res = await request(app)
        .post('/api/invoices/customer')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          party_id: customerPartyId,
          invoice_no: 'INV-TEST-STAFF-001',
          invoice_date: '2026-11-01',
          due_date: '2026-12-01',
          subtotal: 1000.00,
          vat_amount: 150.00,
          total: 1150.00,
          lines: [{ description: 'Crane Service', quantity: 1, unit_id: unitId, unit_price: 1000.00 }]
        });

      expect(res.status).toBe(403);
    });

    it('returns 403 Forbidden when staff attempts to mark an invoice as paid', async () => {
      // Pick any existing invoice
      const invRes = await pool.query<{ id: string | number }>(`SELECT id FROM invoices LIMIT 1`);
      const invoiceId = parseInt(invRes.rows[0].id as string, 10);

      const res = await request(app)
        .patch(`/api/invoices/${invoiceId}/payment`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({});

      expect(res.status).toBe(403);
    });

    it('returns 403 Forbidden when staff attempts to create a supplier invoice', async () => {
      const res = await request(app)
        .post('/api/invoices/supplier')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          party_id: supplierPartyId,
          invoice_no: 'INV-TEST-STAFF-SUP',
          invoice_date: '2026-11-01',
          due_date: '2026-12-01',
          subtotal: 500.00,
          vat_amount: 75.00,
          total: 575.00,
          lines: [{ item_id: itemId, description: 'Steel', quantity: 5, unit_id: unitId, unit_price: 100.00 }]
        });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/invoices/customer — Validations & Business Invariants', () => {
    it('rejects with 400 when subtotal does not match line items sum (totals mismatch)', async () => {
      const res = await request(app)
        .post('/api/invoices/customer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          party_id: customerPartyId,
          invoice_no: 'INV-TEST-FAIL-SUB',
          invoice_date: '2026-11-01',
          due_date: '2026-12-01',
          subtotal: 950.00, // Expected 1,000.00 (2 * 500)
          vat_amount: 150.00,
          total: 1100.00,
          lines: [{ description: 'Generator Rental', quantity: 2, unit_id: unitId, unit_price: 500.00 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Totals mismatch');
      expect(res.body.message).toContain('Subtotal');
    });

    it('rejects with 400 when total does not match subtotal + vat_amount (totals mismatch)', async () => {
      const res = await request(app)
        .post('/api/invoices/customer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          party_id: customerPartyId,
          invoice_no: 'INV-TEST-FAIL-TOT',
          invoice_date: '2026-11-01',
          due_date: '2026-12-01',
          subtotal: 1000.00,
          vat_amount: 150.00,
          total: 1250.00, // Expected 1,150.00
          lines: [{ description: 'Site Office Rental', quantity: 1, unit_id: unitId, unit_price: 1000.00 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Totals mismatch');
      expect(res.body.message).toContain('Total');
    });

    it('rejects with 400 when numeric amounts exceed 2 decimal places', async () => {
      const res = await request(app)
        .post('/api/invoices/customer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          party_id: customerPartyId,
          invoice_no: 'INV-TEST-FAIL-DEC',
          invoice_date: '2026-11-01',
          due_date: '2026-12-01',
          subtotal: 1000.555, // 3 decimal places
          vat_amount: 150.08,
          total: 1150.635,
          lines: [{ description: 'Service', quantity: 1, unit_id: unitId, unit_price: 1000.555 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Totals mismatch');
    });

    it('rejects with 400 when party is not a registered customer', async () => {
      const res = await request(app)
        .post('/api/invoices/customer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          party_id: supplierPartyId, // Supplier, not customer!
          invoice_no: 'INV-TEST-FAIL-PARTY',
          invoice_date: '2026-11-01',
          due_date: '2026-12-01',
          subtotal: 1000.00,
          vat_amount: 150.00,
          total: 1150.00,
          lines: [{ description: 'Crane Rental', quantity: 1, unit_id: unitId, unit_price: 1000.00 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid customer party');
    });

    it('rejects with 400 when rental_id belongs to a different customer (foreign rental)', async () => {
      const res = await request(app)
        .post('/api/invoices/customer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          party_id: otherCustomerPartyId, // Customer B
          rental_id: customerRentalId,    // Belongs to Customer A!
          invoice_no: 'INV-TEST-FAIL-FOREIGN',
          invoice_date: '2026-11-01',
          due_date: '2026-12-01',
          subtotal: 1000.00,
          vat_amount: 150.00,
          total: 1150.00,
          lines: [{ description: 'Rental Billing', quantity: 1, unit_id: unitId, unit_price: 1000.00 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Foreign rental');
    });

    it('creates an issued customer invoice and returns 201 with lines', async () => {
      const invoiceNo = 'INV-TEST-CUST-001';
      const res = await request(app)
        .post('/api/invoices/customer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          party_id: customerPartyId,
          rental_id: customerRentalId,
          invoice_no: invoiceNo,
          invoice_date: '2026-11-01',
          due_date: '2026-11-30',
          subtotal: 15000.00,
          vat_amount: 2250.00,
          total: 17250.00,
          notes: 'November 2026 crane service',
          file_url: 's3://space-exspace-docs/invoices/INV-TEST-CUST-001.pdf',
          lines: [
            { description: '50T Tadano Crane Monthly Rental', quantity: 1, unit_id: unitId, unit_price: 12000.00 },
            { description: 'Rigging Mobilization Fee', quantity: 1, unit_id: unitId, unit_price: 3000.00 }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.invoice_id).toBeDefined();
      expect(res.body.direction).toBe('issued');
      expect(res.body.lines_recorded).toBe(2);

      // Verify stored record in database
      const invCheck = await pool.query(
        `SELECT * FROM invoices WHERE id = $1`,
        [res.body.invoice_id]
      );
      expect(invCheck.rows.length).toBe(1);
      expect(invCheck.rows[0].direction).toBe('issued');
      expect(invCheck.rows[0].status).toBe('unpaid');
      expect(invCheck.rows[0].file_url).toBe('s3://space-exspace-docs/invoices/INV-TEST-CUST-001.pdf');
    });

    it('rejects with 409 when creating an invoice with duplicate (direction, party, invoice_no)', async () => {
      const res = await request(app)
        .post('/api/invoices/customer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          party_id: customerPartyId,
          invoice_no: 'INV-TEST-CUST-001', // Already created above!
          invoice_date: '2026-11-01',
          due_date: '2026-11-30',
          subtotal: 15000.00,
          vat_amount: 2250.00,
          total: 17250.00,
          lines: [
            { description: '50T Tadano Crane Monthly Rental', quantity: 1, unit_id: unitId, unit_price: 15000.00 }
          ]
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Duplicate invoice');
    });

    it('verifies that creating an issued customer invoice creates NO stock movements', async () => {
      const invoiceNo = 'INV-TEST-CUST-NOMOVE';
      const createRes = await request(app)
        .post('/api/invoices/customer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          party_id: customerPartyId,
          invoice_no: invoiceNo,
          invoice_date: '2026-11-01',
          due_date: '2026-11-30',
          subtotal: 400.00,
          vat_amount: 60.00,
          total: 460.00,
          lines: [
            // Line with material item_id
            { description: 'Lubricant drum supply', item_id: itemId, quantity: 2, unit_id: unitId, unit_price: 200.00 }
          ]
        });

      expect(createRes.status).toBe(201);
      const invoiceId = createRes.body.invoice_id;

      // Assert that stock_movements contains zero entries linked to this invoice
      const movementCount = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM stock_movements WHERE invoice_line_invoice_id = $1`,
        [invoiceId]
      );
      expect(parseInt(movementCount.rows[0].count, 10)).toBe(0);
    });

    it('rejects file_url containing executable schemes (e.g. javascript:)', async () => {
      const res = await request(app)
        .post('/api/invoices/customer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          party_id: customerPartyId,
          invoice_no: 'INV-TEST-CUST-XSS',
          invoice_date: '2026-11-01',
          due_date: '2026-11-30',
          subtotal: 100.00,
          vat_amount: 15.00,
          total: 115.00,
          file_url: 'javascript:alert(document.cookie)',
          lines: [{ description: 'Item', quantity: 1, unit_id: unitId, unit_price: 100.00 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  describe('PATCH /api/invoices/:id/payment — State Transitions & Payment Auditing', () => {
    let testInvoiceId: number;
    let testSupplierInvoiceId: number;

    beforeAll(async () => {
      // Create an unpaid issued invoice
      const invRes = await pool.query<{ id: string | number }>(
        `INSERT INTO invoices (direction, invoice_no, party_id, invoice_date, due_date, subtotal, vat_amount, total, status)
         VALUES ('issued', 'INV-TEST-PAY-001', $1, '2026-10-15', '2026-11-15', 5000.00, 750.00, 5750.00, 'unpaid')
         RETURNING id`,
        [customerPartyId]
      );
      testInvoiceId = parseInt(invRes.rows[0].id as string, 10);

      // Create an unpaid received supplier invoice
      const suppInvRes = await pool.query<{ id: string | number }>(
        `INSERT INTO invoices (direction, invoice_no, party_id, invoice_date, due_date, subtotal, vat_amount, total, status)
         VALUES ('received', 'INV-TEST-SUP-PAY-001', $1, '2026-10-10', '2026-11-10', 3000.00, 450.00, 3450.00, 'unpaid')
         RETURNING id`,
        [supplierPartyId]
      );
      testSupplierInvoiceId = parseInt(suppInvRes.rows[0].id as string, 10);
    });

    it('rejects payment date in the future', async () => {
      const futureDate = '2099-01-01';
      const res = await request(app)
        .patch(`/api/invoices/${testInvoiceId}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paid_on: futureDate });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid payment date');
      expect(res.body.message).toContain('future');
    });

    it('marks an unpaid issued invoice as paid, defaulting paid_on to today and recording paid_by', async () => {
      const res = await request(app)
        .patch(`/api/invoices/${testInvoiceId}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      expect(res.body.data.paid_by).toBe(adminUserId);

      const todayStr = new Date().toISOString().slice(0, 10);
      expect(res.body.data.paid_on).toBe(todayStr);

      // Verify GET /api/invoices/:id returns paid_by and paid_by_name
      const getRes = await request(app)
        .get(`/api/invoices/${testInvoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.status).toBe('paid');
      expect(getRes.body.data.paid_by).toBe(adminUserId);
      expect(getRes.body.data.paid_by_name).toBeDefined();
    });

    it('rejects with 400 when attempting to mark an already paid invoice as paid', async () => {
      const res = await request(app)
        .patch(`/api/invoices/${testInvoiceId}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invoice already paid');
    });

    it('marks a received supplier invoice as paid (works for both directions)', async () => {
      const customPaidOn = '2026-10-25';
      const res = await request(app)
        .patch(`/api/invoices/${testSupplierInvoiceId}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paid_on: customPaidOn });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      expect(res.body.data.direction).toBe('received');
      expect(res.body.data.paid_by).toBe(adminUserId);
      expect(res.body.data.paid_on).toBe(customPaidOn);
    });

    it('rejects with 400 when invoice is void', async () => {
      // Create a void invoice
      const voidInvRes = await pool.query<{ id: string | number }>(
        `INSERT INTO invoices (direction, invoice_no, party_id, invoice_date, due_date, subtotal, vat_amount, total, status)
         VALUES ('issued', 'INV-TEST-VOID-001', $1, '2026-10-01', '2026-10-31', 100.00, 15.00, 115.00, 'void')
         RETURNING id`,
        [customerPartyId]
      );
      const voidInvoiceId = parseInt(voidInvRes.rows[0].id as string, 10);

      const res = await request(app)
        .patch(`/api/invoices/${voidInvoiceId}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invoice is void');
    });

    it('returns 404 when marking a non-existent invoice as paid', async () => {
      const res = await request(app)
        .patch(`/api/invoices/999999/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/invoices/supplier — Regression & Stock Receipt Creation', () => {
    it('creates a supplier invoice with stock movement receipts and optional file_url', async () => {
      const invoiceNo = 'INV-TEST-SUP-STOCK-001';
      const res = await request(app)
        .post('/api/invoices/supplier')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          party_id: supplierPartyId,
          invoice_no: invoiceNo,
          invoice_date: '2026-11-01',
          due_date: '2026-11-30',
          subtotal: 1000.00,
          vat_amount: 150.00,
          total: 1150.00,
          notes: 'Batch replenishment',
          file_url: 'scan_reference_batch_123.pdf',
          record_stock_receipt: true,
          lines: [
            { item_id: itemId, description: 'Steel Plate 6mm', quantity: 10, unit_id: unitId, unit_price: 100.00 }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.lines_recorded).toBe(1);

      // Verify that stock receipt movement was created
      const movementsRes = await pool.query(
        `SELECT * FROM stock_movements WHERE invoice_line_invoice_id = $1`,
        [res.body.invoice_id]
      );
      expect(movementsRes.rows.length).toBe(1);
      expect(movementsRes.rows[0].type).toBe('receipt');
      expect(Number(movementsRes.rows[0].qty)).toBe(10);
      expect(Number(movementsRes.rows[0].unit_cost)).toBe(100.00);

      // Verify file_url stored
      const invCheck = await pool.query(`SELECT file_url FROM invoices WHERE id = $1`, [res.body.invoice_id]);
      expect(invCheck.rows[0].file_url).toBe('scan_reference_batch_123.pdf');
    });
  });
});
