import { describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';
import { pool } from '../db/pool.js';
import { seedDatabase } from '../db/seed.js';

describe('Idempotent Database Seed Suite', () => {
  it('executes seedDatabase() idempotently without throwing errors', async () => {
    // Run seed twice to explicitly verify idempotency
    await expect(seedDatabase()).resolves.not.toThrow();
    await expect(seedDatabase()).resolves.not.toThrow();
  });

  it('refuses to seed when NODE_ENV is production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(seedDatabase()).rejects.toThrow(/strictly disabled in production mode/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('creates the two required system users with valid bcrypt password hashes', async () => {
    const adminRes = await pool.query(`SELECT * FROM users WHERE email = 'admin@spaceexspace.com'`);
    expect(adminRes.rows.length).toBe(1);
    expect(adminRes.rows[0].role).toBe('admin');
    expect(adminRes.rows[0].active).toBe(true);

    const isAdminPasswordValid = await bcrypt.compare('Admin#2026!Dev', adminRes.rows[0].password_hash);
    expect(isAdminPasswordValid).toBe(true);

    const staffRes = await pool.query(`SELECT * FROM users WHERE email = 'staff@spaceexspace.com'`);
    expect(staffRes.rows.length).toBe(1);
    expect(staffRes.rows[0].role).toBe('staff');
    expect(staffRes.rows[0].active).toBe(true);

    const isStaffPasswordValid = await bcrypt.compare('Staff#2026!Dev', staffRes.rows[0].password_hash);
    expect(isStaffPasswordValid).toBe(true);
  });

  it('populates ~41 realistic equipment assets across all types and locations', async () => {
    const equipCountRes = await pool.query(`SELECT count(*) FROM equipment`);
    const count = parseInt(equipCountRes.rows[0].count, 10);
    expect(count).toBeGreaterThanOrEqual(35);
    expect(count).toBeLessThanOrEqual(50);

    // Verify view has rows and status distribution
    const viewRes = await pool.query(
      `SELECT status, count(*) AS count FROM v_equipment_current GROUP BY status`
    );
    const statusMap = new Map<string, number>();
    for (const row of viewRes.rows) {
      statusMap.set(row.status, parseInt(row.count, 10));
    }

    expect(statusMap.get('available')).toBeGreaterThan(20);
    // 2 active rentals containing 5 and 2 items respectively (total 7 items currently rented)
    expect(statusMap.get('rented')).toBe(7);
    expect(statusMap.get('under_repair')).toBeGreaterThanOrEqual(1);
  });

  it('creates 3 fictional suppliers and 3 fictional customers with mock VAT numbers', async () => {
    const suppRes = await pool.query(`SELECT * FROM parties WHERE is_supplier = true`);
    expect(suppRes.rows.length).toBe(3);

    const custRes = await pool.query(`SELECT * FROM parties WHERE is_customer = true`);
    expect(custRes.rows.length).toBe(3);

    const allParties = [...suppRes.rows, ...custRes.rows];
    // Ensure no real company names are present
    for (const party of allParties) {
      expect(party.name).not.toMatch(/Aramco|SABIC|Nesma/i);
      expect(party.vat_no).toMatch(/^[12]0{13}[1-9]$/);
    }
  });

  it('seeds standard rate cards with SAR pricing for multiple units', async () => {
    const ratesRes = await pool.query(
      `SELECT DISTINCT unit FROM rates`
    );
    const units = ratesRes.rows.map((r) => r.unit);
    expect(units).toContain('daily');
    expect(units).toContain('monthly');
  });

  it('seeds received and issued invoices with accurate lines and totals', async () => {
    const invoicesRes = await pool.query(`SELECT * FROM invoices ORDER BY id ASC`);
    expect(invoicesRes.rows.length).toBe(2);

    const receivedInv = invoicesRes.rows.find((i) => i.direction === 'received');
    expect(receivedInv).toBeDefined();
    expect(Number(receivedInv.subtotal)).toBe(18400.00);
    expect(Number(receivedInv.vat_amount)).toBe(2760.00);
    expect(Number(receivedInv.total)).toBe(21160.00);

    const issuedInv = invoicesRes.rows.find((i) => i.direction === 'issued');
    expect(issuedInv).toBeDefined();
    expect(Number(issuedInv.subtotal)).toBe(83700.00);
    expect(Number(issuedInv.vat_amount)).toBe(12555.00);
    expect(Number(issuedInv.total)).toBe(96255.00);

    // Check lines
    const linesRes = await pool.query(`SELECT * FROM invoice_lines WHERE invoice_id = $1`, [receivedInv.id]);
    expect(linesRes.rows.length).toBe(3);
  });

  it('seeds stock movements and computes non-negative stock on hand', async () => {
    const stockOnHandRes = await pool.query(
      `SELECT i.sku, i.name, COALESCE(SUM(sm.qty), 0) AS stock_on_hand
       FROM items i
       LEFT JOIN stock_movements sm ON sm.item_id = i.id
       GROUP BY i.id, i.sku, i.name`
    );

    expect(stockOnHandRes.rows.length).toBeGreaterThanOrEqual(15);
    for (const row of stockOnHandRes.rows) {
      expect(Number(row.stock_on_hand)).toBeGreaterThanOrEqual(0);
    }
  });
});
