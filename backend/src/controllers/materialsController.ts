import { Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { sanitizeFinancials } from '../serializers/rateSerializer.js';

const stockMovementSchema = z.object({
  item_id: z.number().int().positive('Item ID must be a positive integer'),
  type: z.enum(['receipt', 'issue', 'adjustment', 'return']),
  qty: z.number().refine(val => val !== 0, 'Quantity cannot be zero'),
  unit_cost: z.number().nonnegative('Unit cost must be non-negative').optional(),
  maintenance_id: z.number().int().positive().optional(),
  note: z.string().optional()
});

/**
 * List all material SKUs with live calculated stock on hand.
 * WHY: In a single-entry append-only ledger, stock on hand is SUM(qty) over stock_movements.
 * It is never a static stored column in the items table.
 */
export async function listMaterials(req: Request, res: Response): Promise<void> {
  const { category_id, low_stock, q } = req.query;

  const whereClauses: string[] = ['i.active = true'];
  const params: unknown[] = [];

  if (category_id && !isNaN(Number(category_id))) {
    params.push(Number(category_id));
    whereClauses.push(`i.category_id = $${params.length}`);
  }

  if (q && typeof q === 'string') {
    params.push(`%${q}%`);
    whereClauses.push(`(i.sku ILIKE $${params.length} OR i.name ILIKE $${params.length})`);
  }

  const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

  // Query calculating current stock via SUM(sm.qty)
  let havingClause = '';
  if (low_stock === 'true') {
    havingClause = 'HAVING COALESCE(SUM(sm.qty), 0) <= i.reorder_level';
  }

  const query = `
    SELECT
      i.id,
      i.sku,
      i.name,
      i.category_id,
      ic.name AS category_name,
      i.unit_id,
      u.code AS unit_code,
      u.name AS unit_name,
      i.reorder_level,
      COALESCE(SUM(sm.qty), 0)::numeric(12,3) AS current_stock,
      (COALESCE(SUM(sm.qty), 0) <= i.reorder_level) AS is_low_stock
    FROM items i
    JOIN item_categories ic ON ic.id = i.category_id
    JOIN units u ON u.id = i.unit_id
    LEFT JOIN stock_movements sm ON sm.item_id = i.id
    ${whereSql}
    GROUP BY i.id, ic.name, u.code, u.name
    ${havingClause}
    ORDER BY i.sku ASC
  `;

  const result = await pool.query(query, params);
  const userRole = req.user?.role || 'staff';

  res.json({
    data: sanitizeFinancials(result.rows, userRole)
  });
}

/**
 * Get single material SKU by ID with stock on hand and specification.
 */
export async function getMaterialById(req: Request, res: Response): Promise<void> {
  const itemId = parseInt(req.params.id, 10);

  if (isNaN(itemId)) {
    res.status(400).json({ error: 'Invalid material item ID' });
    return;
  }

  const query = `
    SELECT
      i.id,
      i.sku,
      i.name,
      i.category_id,
      ic.name AS category_name,
      i.unit_id,
      u.code AS unit_code,
      u.name AS unit_name,
      i.reorder_level,
      i.active,
      i.created_at,
      COALESCE(SUM(sm.qty), 0)::numeric(12,3) AS current_stock,
      (COALESCE(SUM(sm.qty), 0) <= i.reorder_level) AS is_low_stock
    FROM items i
    JOIN item_categories ic ON ic.id = i.category_id
    JOIN units u ON u.id = i.unit_id
    LEFT JOIN stock_movements sm ON sm.item_id = i.id
    WHERE i.id = $1
    GROUP BY i.id, ic.name, u.code, u.name
  `;

  const result = await pool.query(query, [itemId]);

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Material item not found' });
    return;
  }

  const userRole = req.user?.role || 'staff';
  res.json({
    data: sanitizeFinancials(result.rows[0], userRole)
  });
}

/**
 * Get chronological ledger movements for an item.
 * Scrubbed for staff (unit_cost omitted).
 */
export async function getMaterialMovements(req: Request, res: Response): Promise<void> {
  const itemId = parseInt(req.params.id, 10);

  if (isNaN(itemId)) {
    res.status(400).json({ error: 'Invalid material item ID' });
    return;
  }

  const query = `
    SELECT
      sm.id,
      sm.item_id,
      sm.qty,
      sm.type,
      sm.unit_cost,
      sm.moved_at,
      sm.note,
      u.name AS moved_by_name,
      sm.maintenance_id,
      sm.invoice_line_invoice_id,
      sm.invoice_line_no
    FROM stock_movements sm
    JOIN users u ON u.id = sm.moved_by
    WHERE sm.item_id = $1
    ORDER BY sm.moved_at DESC, sm.id DESC
    LIMIT 50
  `;

  const result = await pool.query(query, [itemId]);
  const userRole = req.user?.role || 'staff';

  res.json({
    data: sanitizeFinancials(result.rows, userRole)
  });
}

/**
 * Record a stock movement in the append-only ledger.
 * Accessible to Staff and Admin.
 * Enforces signed integer arithmetic:
 * - 'receipt' & 'return' are positive (+)
 * - 'issue' is negative (-)
 * - 'adjustment' retains signed value
 * Protected by database trigger `trg_check_stock_movement_non_negative`.
 */
export async function recordStockMovement(req: Request, res: Response): Promise<void> {
  const parsed = stockMovementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    return;
  }

  const { item_id, type, qty, unit_cost, maintenance_id, note } = parsed.data;

  // Verify item exists
  const itemCheck = await pool.query(`SELECT id, name FROM items WHERE id = $1 AND active = true`, [item_id]);
  if (itemCheck.rows.length === 0) {
    res.status(404).json({ error: 'Material item not found or deactivated' });
    return;
  }

  // Calculate signed delta
  let signedQty: number;
  if (type === 'issue') {
    signedQty = -Math.abs(qty);
  } else if (type === 'receipt' || type === 'return') {
    signedQty = Math.abs(qty);
  } else {
    // adjustment
    signedQty = qty;
  }

  // Non-admins cannot record arbitrary unit_costs
  const finalUnitCost = req.user?.role === 'admin' && unit_cost !== undefined ? unit_cost : 0.00;

  try {
    const insertRes = await pool.query<{ id: string; moved_at: Date }>(
      `INSERT INTO stock_movements (item_id, qty, type, unit_cost, maintenance_id, moved_by, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, moved_at`,
      [item_id, signedQty, type, finalUnitCost, maintenance_id || null, req.user!.id, note || null]
    );

    // Compute updated stock on hand
    const stockRes = await pool.query<{ current_stock: string }>(
      `SELECT COALESCE(SUM(qty), 0) AS current_stock FROM stock_movements WHERE item_id = $1`,
      [item_id]
    );

    res.status(201).json({
      message: `Stock movement of type '${type}' recorded successfully`,
      movement_id: parseInt(insertRes.rows[0].id, 10),
      item_id,
      delta_qty: signedQty,
      current_stock: parseFloat(stockRes.rows[0].current_stock)
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Detect trigger violation (negative stock prevention)
    if (errorMsg.includes('Cannot issue') || errorMsg.includes('trg_check_stock_movement_non_negative')) {
      res.status(400).json({
        error: errorMsg.replace(/.*error: /i, '').trim(),
        code: 'INSUFFICIENT_STOCK'
      });
      return;
    }
    res.status(500).json({ error: 'Failed to record stock movement', details: errorMsg });
  }
}

/**
 * Get historical supplier purchase prices for an item.
 * Admin only! Fulfills client requirement: "Invoices stored, and material prices tracked over time".
 */
export async function getMaterialPriceHistory(req: Request, res: Response): Promise<void> {
  const itemId = parseInt(req.params.id, 10);

  if (isNaN(itemId)) {
    res.status(400).json({ error: 'Invalid material item ID' });
    return;
  }

  const query = `
    SELECT
      il.invoice_id,
      inv.invoice_no,
      inv.invoice_date,
      p.id AS supplier_id,
      p.name AS supplier_name,
      il.line_no,
      il.description,
      il.quantity,
      u.code AS unit_code,
      il.unit_price,
      (il.quantity * il.unit_price)::numeric(12,2) AS line_total
    FROM invoice_lines il
    JOIN invoices inv ON inv.id = il.invoice_id
    JOIN parties p ON p.id = inv.party_id
    JOIN units u ON u.id = il.unit_id
    WHERE il.item_id = $1 AND inv.direction = 'received'
    ORDER BY inv.invoice_date DESC, inv.id DESC, il.line_no ASC
  `;

  const result = await pool.query(query, [itemId]);

  res.json({
    item_id: itemId,
    price_history: result.rows
  });
}
