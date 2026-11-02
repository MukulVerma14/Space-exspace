import { Request, Response } from 'express';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { pool } from '../db/pool.js';

// Configure Decimal for financial precision: 28 digits, standard commercial half-up rounding
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/**
 * Validates that a numeric or string amount has at most `max` decimal places without float drift.
 */
function hasMaxDecimals(val: number | string, max: number): boolean {
  try {
    const d = new Decimal(val);
    return d.isFinite() && d.decimalPlaces() <= max;
  } catch {
    return false;
  }
}

/**
 * Plain reference string schema for file_url:
 * - max length 500 characters
 * - strictly disallows dangerous executable schemes (javascript:, data:, vbscript:)
 */
const fileUrlSchema = z
  .string()
  .trim()
  .max(500, 'file_url cannot exceed 500 characters')
  .refine((val) => !/^(javascript|data|vbscript):/i.test(val), {
    message: 'file_url must not contain executable URL schemes (e.g. javascript: or data:)'
  })
  .optional()
  .nullable();

const supplierInvoiceLineSchema = z.object({
  item_id: z.coerce.number().int().positive('Item ID must be a positive integer'),
  description: z.string().trim().min(1, 'Line description is required'),
  quantity: z.coerce.number().positive('Quantity must be positive'),
  unit_id: z.coerce.number().int().positive('Unit ID must be a positive integer'),
  unit_price: z.coerce.number().nonnegative('Unit price must be non-negative')
});

const createSupplierInvoiceSchema = z.object({
  party_id: z.coerce.number().int().positive('Supplier party ID must be a positive integer'),
  invoice_no: z.string().trim().min(1, 'Invoice number is required'),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invoice date must be YYYY-MM-DD'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD'),
  subtotal: z.coerce.number().nonnegative(),
  vat_amount: z.coerce.number().nonnegative(),
  total: z.coerce.number().nonnegative(),
  notes: z.string().optional().nullable(),
  file_url: fileUrlSchema,
  record_stock_receipt: z.boolean().default(true),
  lines: z.array(supplierInvoiceLineSchema).min(1, 'Invoice must have at least one line item')
}).refine(data => data.due_date >= data.invoice_date, {
  message: 'due_date must be greater than or equal to invoice_date',
  path: ['due_date']
});

const customerInvoiceLineSchema = z.object({
  description: z.string().trim().min(1, 'Line description is required'),
  item_id: z.coerce.number().int().positive('Item ID must be a positive integer').optional().nullable(),
  quantity: z.coerce.number().positive('Quantity must be positive'),
  unit_id: z.coerce.number().int().positive('Unit ID must be a positive integer'),
  unit_price: z.coerce.number().nonnegative('Unit price must be non-negative')
});

const createCustomerInvoiceSchema = z.object({
  party_id: z.coerce.number().int().positive('Customer party ID must be a positive integer'),
  invoice_no: z.string().trim().min(1, 'Invoice number is required'),
  rental_id: z.coerce.number().int().positive('Rental ID must be a positive integer').optional().nullable(),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invoice date must be YYYY-MM-DD'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD'),
  subtotal: z.coerce.number().nonnegative('Subtotal must be non-negative'),
  vat_amount: z.coerce.number().nonnegative('VAT amount must be non-negative'),
  total: z.coerce.number().nonnegative('Total must be non-negative'),
  notes: z.string().optional().nullable(),
  file_url: fileUrlSchema,
  lines: z.array(customerInvoiceLineSchema).min(1, 'Invoice must have at least one line item')
}).refine(data => data.due_date >= data.invoice_date, {
  message: 'due_date must be greater than or equal to invoice_date',
  path: ['due_date']
});

const markInvoicePaymentSchema = z.object({
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'paid_on must be YYYY-MM-DD').optional()
});

const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(1, 'Void reason is required').max(500, 'Void reason cannot exceed 500 characters')
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
      to_char(inv.invoice_date, 'YYYY-MM-DD') AS invoice_date,
      to_char(inv.due_date, 'YYYY-MM-DD') AS due_date,
      inv.subtotal,
      inv.vat_amount,
      inv.total,
      inv.status,
      to_char(inv.paid_on, 'YYYY-MM-DD') AS paid_on,
      inv.paid_by,
      u_paid.name AS paid_by_name,
      inv.voided_by,
      u_void.name AS voided_by_name,
      to_char(inv.voided_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS voided_at,
      inv.void_reason,
      inv.file_url,
      inv.created_at,
      COUNT(il.line_no)::int AS line_count
    FROM invoices inv
    JOIN parties p ON p.id = inv.party_id
    LEFT JOIN users u_paid ON u_paid.id = inv.paid_by
    LEFT JOIN users u_void ON u_void.id = inv.voided_by
    LEFT JOIN invoice_lines il ON il.invoice_id = inv.id
    ${whereSql}
    GROUP BY inv.id, p.name, u_paid.name, u_void.name
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
      to_char(inv.invoice_date, 'YYYY-MM-DD') AS invoice_date,
      to_char(inv.due_date, 'YYYY-MM-DD') AS due_date,
      inv.subtotal,
      inv.vat_amount,
      inv.total,
      inv.status,
      to_char(inv.paid_on, 'YYYY-MM-DD') AS paid_on,
      inv.paid_by,
      u_paid.name AS paid_by_name,
      inv.voided_by,
      u_void.name AS voided_by_name,
      to_char(inv.voided_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS voided_at,
      inv.void_reason,
      inv.file_url,
      inv.notes,
      inv.created_at
    FROM invoices inv
    JOIN parties p ON p.id = inv.party_id
    LEFT JOIN users u_paid ON u_paid.id = inv.paid_by
    LEFT JOIN users u_void ON u_void.id = inv.voided_by
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
    file_url,
    record_stock_receipt,
    lines
  } = parsed.data;

  // Validate decimal precision on header figures (max 2 decimals)
  if (!hasMaxDecimals(subtotal, 2) || !hasMaxDecimals(vat_amount, 2) || !hasMaxDecimals(total, 2)) {
    res.status(400).json({
      error: 'Totals mismatch',
      message: 'subtotal, vat_amount, and total must have at most 2 decimal places'
    });
    return;
  }

  // Validate line unit_prices (max 4 decimals)
  for (const line of lines) {
    if (!hasMaxDecimals(line.unit_price, 4)) {
      res.status(400).json({
        error: 'Totals mismatch',
        message: `Line item '${line.description}' unit_price must have at most 4 decimal places`
      });
      return;
    }
  }

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
        subtotal, vat_amount, total, status, notes, file_url
       ) VALUES ('received', $1, $2, $3, $4, $5, $6, $7, 'unpaid', $8, $9)
       RETURNING id`,
      [invoice_no, party_id, invoice_date, due_date, subtotal, vat_amount, total, notes || null, file_url || null]
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

/**
 * Record an issued customer invoice with line items in one transaction.
 * Admin only. Store-only workflow (no generation, no ZATCA XML).
 *
 * Invariants:
 * 1. party must have is_customer = true.
 * 2. rental_id, if given, must belong to that party.
 * 3. Exact decimal arithmetic (Decimal.js, never JS floats):
 *    - line_total = round_half_up(qty * unit_price, 2)
 *    - subtotal = sum(line_totals)
 *    - total = subtotal + vat_amount
 * 4. unit_price allows up to 4 decimal places.
 * 5. subtotal, vat_amount, and total allow up to 2 decimal places.
 * 6. Duplicate (direction, party, invoice_no) returns 409.
 * 7. Must NOT create stock movements.
 * 8. file_url is a plain reference string (max length, no executable URL schemes).
 */
export async function createCustomerInvoice(req: Request, res: Response): Promise<void> {
  const parsed = createCustomerInvoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    return;
  }

  const {
    party_id,
    invoice_no,
    rental_id,
    invoice_date,
    due_date,
    subtotal,
    vat_amount,
    total,
    notes,
    file_url,
    lines
  } = parsed.data;

  // 1. Validate decimal precision on header amounts (max 2 decimals)
  if (!hasMaxDecimals(subtotal, 2)) {
    res.status(400).json({ error: 'Totals mismatch', message: 'subtotal must have at most 2 decimal places' });
    return;
  }
  if (!hasMaxDecimals(vat_amount, 2)) {
    res.status(400).json({ error: 'Totals mismatch', message: 'vat_amount must have at most 2 decimal places' });
    return;
  }
  if (!hasMaxDecimals(total, 2)) {
    res.status(400).json({ error: 'Totals mismatch', message: 'total must have at most 2 decimal places' });
    return;
  }

  // 2. Server computes subtotal from line items using Decimal arithmetic
  // Each line total is rounded half-up to 2 decimal places (standard commercial rounding)
  let computedSubtotal = new Decimal(0);
  for (const line of lines) {
    if (!hasMaxDecimals(line.unit_price, 4)) {
      res.status(400).json({
        error: 'Totals mismatch',
        message: `Line item '${line.description}' unit_price must have at most 4 decimal places`
      });
      return;
    }
    const lineQty = new Decimal(line.quantity);
    const lineUnitPrice = new Decimal(line.unit_price);
    const lineTotal = lineQty.times(lineUnitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    computedSubtotal = computedSubtotal.plus(lineTotal);
  }

  // 3. Reconcile client subtotal with line items sum using exact Decimal equality
  const clientSubtotal = new Decimal(subtotal);
  if (!clientSubtotal.equals(computedSubtotal)) {
    res.status(400).json({
      error: 'Totals mismatch',
      message: `Subtotal (${clientSubtotal.toFixed(2)}) does not reconcile with sum of line items (${computedSubtotal.toFixed(2)})`
    });
    return;
  }

  // 4. Reconcile total with subtotal + vat_amount using exact Decimal equality
  const clientVat = new Decimal(vat_amount);
  const clientTotal = new Decimal(total);
  const expectedTotal = computedSubtotal.plus(clientVat);
  if (!clientTotal.equals(expectedTotal)) {
    res.status(400).json({
      error: 'Totals mismatch',
      message: `Total (${clientTotal.toFixed(2)}) does not reconcile with subtotal (${clientSubtotal.toFixed(2)}) + vat_amount (${clientVat.toFixed(2)}) which equals ${expectedTotal.toFixed(2)}`
    });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 5. Verify customer party exists and is marked is_customer = true
    const partyCheck = await client.query(
      `SELECT id, name, is_customer FROM parties WHERE id = $1`,
      [party_id]
    );
    if (partyCheck.rows.length === 0 || !partyCheck.rows[0].is_customer) {
      await client.query('ROLLBACK');
      res.status(400).json({
        error: 'Invalid customer party',
        message: `Party ID ${party_id} does not exist or is not registered as a customer`
      });
      return;
    }

    // 6. Verify rental_id, if provided, exists and belongs to that customer party
    if (rental_id) {
      const rentalCheck = await client.query(
        `SELECT id, customer_id FROM rentals WHERE id = $1`,
        [rental_id]
      );
      if (rentalCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: 'Rental not found',
          message: `Rental ID ${rental_id} does not exist`
        });
        return;
      }
      if (rentalCheck.rows[0].customer_id !== party_id) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: 'Foreign rental',
          message: `Rental ID ${rental_id} belongs to customer party ID ${rentalCheck.rows[0].customer_id}, not party ID ${party_id}`
        });
        return;
      }
    }

    // 7. Check for duplicate invoice (direction + party_id + invoice_no is UNIQUE)
    const duplicateCheck = await client.query(
      `SELECT id FROM invoices WHERE direction = 'issued' AND party_id = $1 AND invoice_no = $2`,
      [party_id, invoice_no]
    );
    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'Duplicate invoice',
        message: `Customer invoice '${invoice_no}' already exists for this customer`
      });
      return;
    }

    // 8. Insert invoice header (status defaults to 'unpaid')
    const invoiceInsert = await client.query<{ id: string }>(
      `INSERT INTO invoices (
        direction, invoice_no, party_id, rental_id, invoice_date, due_date,
        subtotal, vat_amount, total, status, notes, file_url
       ) VALUES ('issued', $1, $2, $3, $4, $5, $6, $7, $8, 'unpaid', $9, $10)
       RETURNING id`,
      [
        invoice_no,
        party_id,
        rental_id || null,
        invoice_date,
        due_date,
        subtotal,
        vat_amount,
        total,
        notes || null,
        file_url || null
      ]
    );
    const invoiceId = invoiceInsert.rows[0].id;

    // 9. Insert invoice lines (must NOT create stock movements)
    let lineNo = 1;
    for (const line of lines) {
      if (line.item_id) {
        const itemCheck = await client.query(`SELECT id FROM items WHERE id = $1`, [line.item_id]);
        if (itemCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: `Material item ID ${line.item_id} does not exist` });
          return;
        }
      }

      const unitCheck = await client.query(`SELECT id FROM units WHERE id = $1`, [line.unit_id]);
      if (unitCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: `Unit ID ${line.unit_id} does not exist` });
        return;
      }

      await client.query(
        `INSERT INTO invoice_lines (invoice_id, line_no, description, item_id, quantity, unit_id, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invoiceId, lineNo, line.description, line.item_id || null, line.quantity, line.unit_id, line.unit_price]
      );

      lineNo++;
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Customer invoice recorded successfully',
      invoice_id: parseInt(invoiceId, 10),
      invoice_no,
      direction: 'issued',
      lines_recorded: lines.length,
      subtotal,
      vat_amount,
      total
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to record customer invoice',
      details: err instanceof Error ? err.message : String(err)
    });
  } finally {
    client.release();
  }
}

/**
 * Mark an invoice as paid (works for both issued and received invoices).
 * Admin only.
 *
 * Invariants:
 * 1. Sets status = 'paid' and paid_on (defaults to today; rejected if in the future).
 * 2. Rejects if invoice is already paid or void.
 * 3. Records who marked it paid via paid_by.
 */
export async function markInvoicePayment(req: Request, res: Response): Promise<void> {
  const invoiceId = parseInt(req.params.id, 10);
  if (isNaN(invoiceId)) {
    res.status(400).json({ error: 'Invalid invoice ID' });
    return;
  }

  const parsed = markInvoicePaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const targetPaidOn = parsed.data.paid_on || todayStr;

  if (targetPaidOn > todayStr) {
    res.status(400).json({
      error: 'Invalid payment date',
      message: `paid_on (${targetPaidOn}) cannot be in the future (today is ${todayStr})`
    });
    return;
  }

  const existingRes = await pool.query(
    `SELECT id, direction, invoice_no, status, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, paid_by FROM invoices WHERE id = $1`,
    [invoiceId]
  );

  if (existingRes.rows.length === 0) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }

  const invoice = existingRes.rows[0];

  if (invoice.status === 'paid') {
    res.status(400).json({
      error: 'Invoice already paid',
      message: `Invoice '${invoice.invoice_no}' is already marked as paid on ${invoice.paid_on}`
    });
    return;
  }

  if (invoice.status === 'void') {
    res.status(400).json({
      error: 'Invoice is void',
      message: `Invoice '${invoice.invoice_no}' is void and cannot be marked as paid`
    });
    return;
  }

  const updateRes = await pool.query(
    `UPDATE invoices
     SET status = 'paid', paid_on = $1, paid_by = $2
     WHERE id = $3
     RETURNING id, direction, invoice_no, status, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, paid_by`,
    [targetPaidOn, req.user!.id, invoiceId]
  );

  res.status(200).json({
    message: 'Invoice marked as paid successfully',
    data: updateRes.rows[0]
  });
}

/**
 * Void an invoice (works for both issued and received invoices).
 * Admin only.
 *
 * Invariants:
 * 1. Requires a non-empty void reason.
 * 2. Rejects if invoice is already paid or void.
 * 3. Never deletes the invoice: sets status = 'void', records voided_by, voided_at, void_reason.
 * 4. For supplier invoices with stock receipts:
 *    - Does NOT silently delete receipts.
 *    - Inserts compensating reversing stock movements (type='void_reversal', signed negative qty)
 *      to restore accurate stock ledger without breaking append-only history.
 *    - Reversal movements are guarded by check_stock_movement_non_negative() trigger:
 *      if items have already been consumed and current stock is insufficient, voiding aborts.
 */
export async function voidInvoice(req: Request, res: Response): Promise<void> {
  const invoiceId = parseInt(req.params.id, 10);
  if (isNaN(invoiceId)) {
    res.status(400).json({ error: 'Invalid invoice ID' });
    return;
  }

  const parsed = voidInvoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    return;
  }

  const { reason } = parsed.data;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Fetch current invoice state
    const existingRes = await client.query(
      `SELECT id, direction, invoice_no, status, to_char(paid_on, 'YYYY-MM-DD') AS paid_on
       FROM invoices WHERE id = $1`,
      [invoiceId]
    );

    if (existingRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const invoice = existingRes.rows[0];

    // 2. Reject if already paid
    if (invoice.status === 'paid') {
      await client.query('ROLLBACK');
      res.status(400).json({
        error: 'Invoice already paid',
        message: `Cannot void invoice '${invoice.invoice_no}' because it has already been paid on ${invoice.paid_on}`
      });
      return;
    }

    // 3. Reject if already void
    if (invoice.status === 'void') {
      await client.query('ROLLBACK');
      res.status(400).json({
        error: 'Invoice already void',
        message: `Invoice '${invoice.invoice_no}' is already void`
      });
      return;
    }

    // 4. If supplier invoice, check for associated stock receipts and create compensating reversals
    let reversalCount = 0;
    if (invoice.direction === 'received') {
      const receiptsRes = await client.query<{
        id: string;
        item_id: number;
        qty: string;
        unit_cost: string;
        invoice_line_no: number;
      }>(
        `SELECT id, item_id, qty, unit_cost, invoice_line_no
         FROM stock_movements
         WHERE invoice_line_invoice_id = $1 AND type = 'receipt' AND qty > 0`,
        [invoiceId]
      );

      for (const receipt of receiptsRes.rows) {
        const positiveQty = Math.abs(parseFloat(receipt.qty));
        const reversingQty = -positiveQty;

        // Inserting negative movement will trigger check_stock_movement_non_negative()
        // If current stock is lower than reversingQty, trigger raises exception and rolls back
        await client.query(
          `INSERT INTO stock_movements (
            item_id, qty, type, invoice_line_invoice_id, invoice_line_no,
            unit_cost, moved_by, note, moved_at
           ) VALUES ($1, $2, 'void_reversal', $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
          [
            receipt.item_id,
            reversingQty,
            invoiceId,
            receipt.invoice_line_no,
            receipt.unit_cost,
            req.user!.id,
            `Void reversal for supplier invoice #${invoice.invoice_no}: ${reason}`
          ]
        );
        reversalCount++;
      }
    }

    // 5. Update invoice status to 'void' with audit fields
    const updateRes = await client.query(
      `UPDATE invoices
       SET status = 'void',
           voided_by = $1,
           voided_at = CURRENT_TIMESTAMP,
           void_reason = $2
       WHERE id = $3
       RETURNING id, direction, invoice_no, status,
                 to_char(voided_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS voided_at,
                 voided_by, void_reason`,
      [req.user!.id, reason, invoiceId]
    );

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Invoice voided successfully',
      data: {
        ...updateRes.rows[0],
        reversal_movements_created: reversalCount
      }
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Cannot issue') || msg.includes('current stock is')) {
      res.status(400).json({
        error: 'Insufficient stock to void invoice',
        message: `Cannot void invoice: received items have already been consumed or issued, reducing remaining stock below the receipt quantity (${msg.replace(/.*error: /i, '').trim()})`
      });
      return;
    }
    res.status(500).json({ error: 'Failed to void invoice', details: msg });
  } finally {
    client.release();
  }
}
