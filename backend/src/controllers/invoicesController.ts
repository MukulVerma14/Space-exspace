import { Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';

const supplierInvoiceLineSchema = z.object({
  item_id: z.number().int().positive('Item ID must be a positive integer'),
  description: z.string().min(1, 'Line description is required'),
  quantity: z.number().positive('Quantity must be positive'),
  unit_id: z.number().int().positive('Unit ID must be a positive integer'),
  unit_price: z.number().nonnegative('Unit price must be non-negative')
});

const createSupplierInvoiceSchema = z.object({
  party_id: z.number().int().positive('Supplier party ID must be a positive integer'),
  invoice_no: z.string().min(1, 'Invoice number is required'),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invoice date must be YYYY-MM-DD'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD'),
  subtotal: z.number().nonnegative(),
  vat_amount: z.number().nonnegative(),
  total: z.number().nonnegative(),
  notes: z.string().optional(),
  record_stock_receipt: z.boolean().default(true),
  lines: z.array(supplierInvoiceLineSchema).min(1, 'Invoice must have at least one line item')
}).refine(data => data.due_date >= data.invoice_date, {
  message: 'due_date must be greater than or equal to invoice_date',
  path: ['due_date']
});

/**
 * List stored invoices with filters.
 * Admin only.
 */
export async function listInvoices(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20', 10)));
  const offset = (page - 1) * limit;

  const { direction, status, party_id } = req.query;
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (direction && (direction === 'issued' || direction === 'received')) {
    params.push(direction);
    whereClauses.push(`inv.direction = $${params.length}`);
  }

  if (status && typeof status === 'string') {
    params.push(status);
    whereClauses.push(`inv.status = $${params.length}`);
  }

  if (party_id && !isNaN(Number(party_id))) {
    params.push(Number(party_id));
    whereClauses.push(`inv.party_id = $${params.length}`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM invoices inv ${whereSql}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const query = `
    SELECT
      inv.id,
      inv.direction,
      inv.invoice_no,
      inv.party_id,
      p.name AS party_name,
      inv.rental_id,
      inv.invoice_date,
      inv.due_date,
      inv.subtotal,
      inv.vat_amount,
      inv.total,
      inv.status,
      inv.paid_on,
      inv.created_at,
      COUNT(il.line_no)::int AS line_count
    FROM invoices inv
    JOIN parties p ON p.id = inv.party_id
    LEFT JOIN invoice_lines il ON il.invoice_id = inv.id
    ${whereSql}
    GROUP BY inv.id, p.name
    ORDER BY inv.invoice_date DESC, inv.id DESC
    LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
  `;

  const result = await pool.query(query, dataParams);

  res.json({
    data: result.rows,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit)
    }
  });
}

/**
 * Get single invoice with its line items.
 * Admin only.
 */
export async function getInvoiceById(req: Request, res: Response): Promise<void> {
  const invoiceId = parseInt(req.params.id, 10);

  if (isNaN(invoiceId)) {
    res.status(400).json({ error: 'Invalid invoice ID' });
    return;
  }

  const invRes = await pool.query(
    `SELECT
      inv.id,
      inv.direction,
      inv.invoice_no,
      inv.party_id,
      p.name AS party_name,
      p.vat_no AS party_vat_no,
      inv.rental_id,
      inv.invoice_date,
      inv.due_date,
      inv.subtotal,
      inv.vat_amount,
      inv.total,
      inv.status,
      inv.paid_on,
      inv.notes,
      inv.created_at
    FROM invoices inv
    JOIN parties p ON p.id = inv.party_id
    WHERE inv.id = $1`,
    [invoiceId]
  );

  if (invRes.rows.length === 0) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }

  const linesRes = await pool.query(
    `SELECT
      il.line_no,
      il.description,
      il.item_id,
      i.sku AS item_sku,
      i.name AS item_name,
      il.quantity,
      il.unit_id,
      u.code AS unit_code,
      il.unit_price,
      (il.quantity * il.unit_price)::numeric(12,2) AS line_total
    FROM invoice_lines il
    LEFT JOIN items i ON i.id = il.item_id
    JOIN units u ON u.id = il.unit_id
    WHERE il.invoice_id = $1
    ORDER BY il.line_no ASC`,
    [invoiceId]
  );

  res.json({
    data: {
      ...invRes.rows[0],
      lines: linesRes.rows
    }
  });
}

/**
 * Record a received supplier invoice with line items and optional stock movement receipts.
 * Admin only. Fulfills confirmed client requirement:
 * "Invoices stored, and material prices tracked over time".
 */
export async function createSupplierInvoice(req: Request, res: Response): Promise<void> {
  const parsed = createSupplierInvoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    return;
  }

  const {
    party_id,
    invoice_no,
    invoice_date,
    due_date,
    subtotal,
    vat_amount,
    total,
    notes,
    record_stock_receipt,
    lines
  } = parsed.data;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify supplier party exists and is marked is_supplier
    const partyCheck = await client.query(
      `SELECT id, name FROM parties WHERE id = $1 AND is_supplier = true`,
      [party_id]
    );
    if (partyCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Invalid party ID or party is not registered as a supplier' });
      return;
    }

    // 2. Check for duplicate invoice (direction + party_id + invoice_no is UNIQUE)
    const duplicateCheck = await client.query(
      `SELECT id FROM invoices WHERE direction = 'received' AND party_id = $1 AND invoice_no = $2`,
      [party_id, invoice_no]
    );
    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: `Supplier invoice '${invoice_no}' already exists for this supplier` });
      return;
    }

    // 3. Insert invoice header
    const invoiceInsert = await client.query<{ id: string }>(
      `INSERT INTO invoices (
        direction, invoice_no, party_id, invoice_date, due_date,
        subtotal, vat_amount, total, status, notes
       ) VALUES ('received', $1, $2, $3, $4, $5, $6, $7, 'unpaid', $8)
       RETURNING id`,
      [invoice_no, party_id, invoice_date, due_date, subtotal, vat_amount, total, notes || null]
    );
    const invoiceId = invoiceInsert.rows[0].id;

    // 4. Insert invoice lines & optional stock receipts
    let lineNo = 1;
    for (const line of lines) {
      // Verify item exists
      const itemCheck = await client.query(`SELECT id FROM items WHERE id = $1`, [line.item_id]);
      if (itemCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: `Material item ID ${line.item_id} does not exist` });
        return;
      }

      await client.query(
        `INSERT INTO invoice_lines (invoice_id, line_no, description, item_id, quantity, unit_id, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invoiceId, lineNo, line.description, line.item_id, line.quantity, line.unit_id, line.unit_price]
      );

      // If requested, immediately record a stock receipt movement linked to this invoice line
      if (record_stock_receipt) {
        await client.query(
          `INSERT INTO stock_movements (
            item_id, qty, type, invoice_line_invoice_id, invoice_line_no, unit_cost, moved_by, note
           ) VALUES ($1, $2, 'receipt', $3, $4, $5, $6, $7)`,
          [
            line.item_id,
            line.quantity,
            invoiceId,
            lineNo,
            line.unit_price,
            req.user!.id,
            `Received via supplier invoice #${invoice_no}`
          ]
        );
      }

      lineNo++;
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Supplier invoice recorded successfully. Material purchase prices and stock updated.',
      invoice_id: parseInt(invoiceId, 10),
      invoice_no,
      lines_recorded: lines.length
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to record supplier invoice', details: err instanceof Error ? err.message : String(err) });
  } finally {
    client.release();
  }
}
