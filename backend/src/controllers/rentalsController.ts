import { Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { sanitizeFinancials } from '../serializers/rateSerializer.js';

// Validation schemas for rental lifecycle
const createRentalSchema = z.object({
  customer_id: z.number().int().positive('Customer ID must be a positive integer'),
  site_id: z.number().int().positive('Site location ID must be a positive integer'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format'),
  expected_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected end date must be in YYYY-MM-DD format'),
  status: z.enum(['quotation', 'confirmed', 'picked_up']).default('confirmed'),
  items: z.array(z.object({
    equipment_id: z.number().int().positive('Equipment ID must be a positive integer'),
    applied_rate: z.number().nonnegative('Applied rate must be non-negative'),
    rate_unit: z.enum(['hourly', 'daily', 'weekly', 'monthly']),
    discount_note: z.string().optional()
  })).min(1, 'Rental must include at least one equipment item')
}).refine(data => data.expected_end >= data.start_date, {
  message: 'expected_end must be greater than or equal to start_date',
  path: ['expected_end']
});

const pickupRentalSchema = z.object({
  note: z.string().optional()
});

const returnRentalSchema = z.object({
  location_id: z.number().int().positive('Yard location ID must be a positive integer'),
  note: z.string().optional()
});

/**
 * List rentals with filtering and pagination.
 * Accessible to both Admin and Staff.
 * Staff responses are sanitized to remove agreed rates.
 */
export async function listRentals(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20', 10)));
  const offset = (page - 1) * limit;

  const { status, customer_id } = req.query;
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (status && typeof status === 'string') {
    params.push(status);
    whereClauses.push(`r.status = $${params.length}`);
  }

  if (customer_id && !isNaN(Number(customer_id))) {
    params.push(Number(customer_id));
    whereClauses.push(`r.customer_id = $${params.length}`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Count total matching rows
  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM rentals r ${whereSql}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  // Fetch rentals with customer and site names, plus item counts
  const dataParams = [...params, limit, offset];
  const query = `
    SELECT
      r.id,
      r.customer_id,
      p.name AS customer_name,
      r.site_id,
      loc.name AS site_name,
      r.status,
      r.start_date,
      r.expected_end,
      r.created_at,
      COUNT(ri.equipment_id)::int AS total_items,
      COUNT(CASE WHEN ri.returned_at IS NULL THEN 1 END)::int AS active_items
    FROM rentals r
    JOIN parties p ON p.id = r.customer_id
    JOIN locations loc ON loc.id = r.site_id
    LEFT JOIN rental_items ri ON ri.rental_id = r.id
    ${whereSql}
    GROUP BY r.id, p.name, loc.name
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
  `;

  const result = await pool.query(query, dataParams);
  const userRole = req.user?.role || 'staff';

  res.json({
    data: sanitizeFinancials(result.rows, userRole),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit)
    }
  });
}

/**
 * Get detailed rental agreement by ID, including its line items.
 */
export async function getRentalById(req: Request, res: Response): Promise<void> {
  const rentalId = parseInt(req.params.id, 10);

  if (isNaN(rentalId)) {
    res.status(400).json({ error: 'Invalid rental ID' });
    return;
  }

  const rentalRes = await pool.query(
    `SELECT
      r.id,
      r.customer_id,
      p.name AS customer_name,
      p.contact_person AS customer_contact,
      p.phone AS customer_phone,
      r.site_id,
      loc.name AS site_name,
      r.status,
      r.start_date,
      r.expected_end,
      r.created_at
    FROM rentals r
    JOIN parties p ON p.id = r.customer_id
    JOIN locations loc ON loc.id = r.site_id
    WHERE r.id = $1`,
    [rentalId]
  );

  if (rentalRes.rows.length === 0) {
    res.status(404).json({ error: 'Rental agreement not found' });
    return;
  }

  const itemsRes = await pool.query(
    `SELECT
      ri.equipment_id,
      e.asset_code,
      em.make,
      em.model,
      et.name AS type_name,
      ri.applied_rate,
      ri.rate_unit,
      ri.discount_note,
      ri.returned_at
    FROM rental_items ri
    JOIN equipment e ON e.id = ri.equipment_id
    JOIN equipment_models em ON em.id = e.model_id
    JOIN equipment_types et ON et.id = em.type_id
    WHERE ri.rental_id = $1
    ORDER BY e.asset_code ASC`,
    [rentalId]
  );

  const rental = {
    ...rentalRes.rows[0],
    items: itemsRes.rows
  };

  const userRole = req.user?.role || 'staff';
  res.json({
    data: sanitizeFinancials(rental, userRole)
  });
}

/**
 * Create a new rental agreement with line items.
 * Restricted to Admin role because it establishes commercial agreed rates.
 * Atomically checks item availability to prevent double-booking.
 */
export async function createRental(req: Request, res: Response): Promise<void> {
  const parsed = createRentalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    return;
  }

  const { customer_id, site_id, start_date, expected_end, status, items } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify customer exists and is marked is_customer
    const customerCheck = await client.query(
      `SELECT id, name FROM parties WHERE id = $1 AND is_customer = true`,
      [customer_id]
    );
    if (customerCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Invalid customer ID or party is not registered as a customer' });
      return;
    }

    // 2. Verify site location exists
    const siteCheck = await client.query(
      `SELECT id, name, kind FROM locations WHERE id = $1`,
      [site_id]
    );
    if (siteCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Invalid delivery site location ID' });
      return;
    }

    // 3. Verify availability of every requested equipment item
    // WHY: Checking availability explicitly before inserting prevents cryptic foreign key or index crashes
    // and provides a clear 409 Conflict with the conflicting asset code.
    const equipmentIds = items.map(i => i.equipment_id);
    const conflictCheck = await client.query<{ equipment_id: number; asset_code: string; current_status: string }>(
      `SELECT e.id AS equipment_id, e.asset_code, v.status AS current_status
       FROM equipment e
       JOIN v_equipment_current v ON v.id = e.id
       WHERE e.id = ANY($1::int[]) AND (
         v.status = 'rented' OR v.status = 'under_repair' OR e.active = false
       )`,
      [equipmentIds]
    );

    if (conflictCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      const conflict = conflictCheck.rows[0];
      res.status(409).json({
        error: `Equipment '${conflict.asset_code}' is currently unavailable (Status: ${conflict.current_status})`,
        conflict_asset_code: conflict.asset_code,
        conflict_status: conflict.current_status
      });
      return;
    }

    // 4. Insert rental header
    const rentalInsert = await client.query<{ id: string }>(
      `INSERT INTO rentals (customer_id, site_id, status, start_date, expected_end)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [customer_id, site_id, status, start_date, expected_end]
    );
    const rentalId = rentalInsert.rows[0].id;

    // 5. Insert line items
    for (const item of items) {
      await client.query(
        `INSERT INTO rental_items (rental_id, equipment_id, applied_rate, rate_unit, discount_note)
         VALUES ($1, $2, $3, $4, $5)`,
        [rentalId, item.equipment_id, item.applied_rate, item.rate_unit, item.discount_note || null]
      );

      // If status is immediately 'picked_up', log movement to client site
      if (status === 'picked_up') {
        await client.query(
          `INSERT INTO location_log (equipment_id, location_id, moved_by, note)
           VALUES ($1, $2, $3, $4)`,
          [item.equipment_id, site_id, req.user!.id, `Dispatched for Rental #${rentalId}`]
        );
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Rental agreement created successfully',
      rental_id: parseInt(rentalId, 10),
      status
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    // Check if partial unique index uq_active_rental_item triggered
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('uq_active_rental_item')) {
      res.status(409).json({
        error: 'One or more equipment items are already assigned to an active rental contract'
      });
      return;
    }
    res.status(500).json({ error: 'Failed to create rental agreement', details: errorMsg });
  } finally {
    client.release();
  }
}

/**
 * Mark a rental agreement as picked up.
 * Accessible to Staff and Admin when machines depart the yard.
 * Atomically updates status to 'picked_up' and logs movement to the client site in location_log.
 */
export async function pickupRental(req: Request, res: Response): Promise<void> {
  const rentalId = parseInt(req.params.id, 10);
  if (isNaN(rentalId)) {
    res.status(400).json({ error: 'Invalid rental ID' });
    return;
  }

  const parsed = pickupRentalSchema.safeParse(req.body);
  const note = parsed.success && parsed.data.note ? parsed.data.note : 'Picked up and dispatched to client site';

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const rentalRes = await client.query<{ id: string; site_id: number; status: string }>(
      `SELECT id, site_id, status FROM rentals WHERE id = $1 FOR UPDATE`,
      [rentalId]
    );

    if (rentalRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Rental agreement not found' });
      return;
    }

    const rental = rentalRes.rows[0];
    if (rental.status === 'picked_up') {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Rental agreement is already picked up' });
      return;
    }

    if (rental.status === 'returned' || rental.status === 'cancelled') {
      await client.query('ROLLBACK');
      res.status(400).json({ error: `Cannot pick up a rental that is already ${rental.status}` });
      return;
    }

    // Update rental status
    await client.query(
      `UPDATE rentals SET status = 'picked_up' WHERE id = $1`,
      [rentalId]
    );

    // Fetch all active items on this rental and log their relocation to the site
    const itemsRes = await client.query<{ equipment_id: number }>(
      `SELECT equipment_id FROM rental_items WHERE rental_id = $1 AND returned_at IS NULL`,
      [rentalId]
    );

    for (const item of itemsRes.rows) {
      await client.query(
        `INSERT INTO location_log (equipment_id, location_id, moved_by, note)
         VALUES ($1, $2, $3, $4)`,
        [item.equipment_id, rental.site_id, req.user!.id, note]
      );
    }

    await client.query('COMMIT');

    res.json({
      message: 'Rental agreement marked as picked up. Equipment locations updated to client site.',
      rental_id: rentalId,
      dispatched_items_count: itemsRes.rows.length
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to process rental pickup', details: err instanceof Error ? err.message : String(err) });
  } finally {
    client.release();
  }
}

/**
 * Return all unreturned items on a rental agreement back to a yard location.
 * Accessible to Staff and Admin.
 * Atomically marks items returned, updates rental status to 'returned', and logs yard arrival.
 */
export async function returnRental(req: Request, res: Response): Promise<void> {
  const rentalId = parseInt(req.params.id, 10);
  if (isNaN(rentalId)) {
    res.status(400).json({ error: 'Invalid rental ID' });
    return;
  }

  const parsed = returnRentalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    return;
  }

  const { location_id, note } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify yard location
    const locCheck = await client.query(
      `SELECT id, name, kind FROM locations WHERE id = $1`,
      [location_id]
    );
    if (locCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Invalid yard location ID' });
      return;
    }

    // 2. Fetch rental
    const rentalRes = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM rentals WHERE id = $1 FOR UPDATE`,
      [rentalId]
    );

    if (rentalRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Rental agreement not found' });
      return;
    }

    const rental = rentalRes.rows[0];
    if (rental.status === 'returned' || rental.status === 'cancelled') {
      await client.query('ROLLBACK');
      res.status(400).json({ error: `Rental agreement is already ${rental.status}` });
      return;
    }

    // 3. Mark unreturned items as returned
    const unreturnedItems = await client.query<{ equipment_id: number }>(
      `SELECT equipment_id FROM rental_items WHERE rental_id = $1 AND returned_at IS NULL`,
      [rentalId]
    );

    const now = new Date();
    await client.query(
      `UPDATE rental_items SET returned_at = $1 WHERE rental_id = $2 AND returned_at IS NULL`,
      [now, rentalId]
    );

    // 4. Update rental header status
    await client.query(
      `UPDATE rentals SET status = 'returned' WHERE id = $1`,
      [rentalId]
    );

    // 5. Log return to yard in location_log for each returned item
    const movementNote = note || `Returned to ${locCheck.rows[0].name} from Rental #${rentalId}`;
    for (const item of unreturnedItems.rows) {
      await client.query(
        `INSERT INTO location_log (equipment_id, location_id, moved_by, moved_at, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [item.equipment_id, location_id, req.user!.id, now, movementNote]
      );
    }

    await client.query('COMMIT');

    res.json({
      message: 'Rental agreement successfully returned. All items freed and checked into yard.',
      rental_id: rentalId,
      returned_items_count: unreturnedItems.rows.length
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to return rental', details: err instanceof Error ? err.message : String(err) });
  } finally {
    client.release();
  }
}
