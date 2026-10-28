import { Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { sanitizeFinancials } from '../serializers/rateSerializer.js';

// Query schemas for filtering and pagination
const listEquipmentSchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(['available', 'rented', 'under_repair']).optional(),
  type_id: z.coerce.number().int().positive().optional(),
  location_id: z.coerce.number().int().positive().optional(),
  condition: z.enum(['good', 'fair', 'needs_repair']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// Action request schemas
const moveEquipmentSchema = z.object({
  location_id: z.number().int().positive('location_id is required and must be a positive integer'),
  note: z.string().trim().optional(),
});

const returnEquipmentSchema = z.object({
  location_id: z.number().int().positive('location_id is required and must be a positive integer'),
  condition: z.enum(['good', 'fair', 'needs_repair']).optional(),
  note: z.string().trim().optional(),
});

const repairEquipmentSchema = z.object({
  kind: z.enum(['repair', 'modification']).default('repair'),
  description: z.string().trim().min(3, 'Description must be at least 3 characters'),
  workshop_location_id: z.number().int().positive().optional(),
  cost: z.number().min(0).optional(),
  note: z.string().trim().optional(),
});

/**
 * List Equipment Controller.
 * WHY: Reads dynamically from `v_equipment_current` view, ensuring all filter criteria
 * (status, location, type) reflect real-time derived state with pagination.
 */
export async function listEquipment(req: Request, res: Response) {
  const parseResult = listEquipmentSchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid query parameters',
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { search, status, type_id, location_id, condition, page, limit } = parseResult.data;
  const offset = (page - 1) * limit;

  const conditions: string[] = ['active = true'];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (search) {
    conditions.push(
      `(asset_code ILIKE $${paramIdx} OR make ILIKE $${paramIdx} OR model ILIKE $${paramIdx} OR type_name ILIKE $${paramIdx} OR current_location_name ILIKE $${paramIdx})`
    );
    values.push(`%${search}%`);
    paramIdx++;
  }

  if (status) {
    conditions.push(`status = $${paramIdx}`);
    values.push(status);
    paramIdx++;
  }

  if (type_id) {
    conditions.push(`type_id = $${paramIdx}`);
    values.push(type_id);
    paramIdx++;
  }

  if (location_id) {
    conditions.push(`current_location_id = $${paramIdx}`);
    values.push(location_id);
    paramIdx++;
  }

  if (condition) {
    conditions.push(`condition = $${paramIdx}`);
    values.push(condition);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count matching filters
  const countQuery = `SELECT COUNT(*) AS total FROM v_equipment_current ${whereClause}`;
  const countRes = await pool.query(countQuery, values);
  const total = parseInt(countRes.rows[0].total, 10);

  // Get paginated rows
  const query = `
    SELECT *
    FROM v_equipment_current
    ${whereClause}
    ORDER BY asset_code ASC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `;
  values.push(limit, offset);

  const result = await pool.query(query, values);
  const totalPages = Math.ceil(total / limit);

  const sanitizedItems = sanitizeFinancials(result.rows, req.user!.role);

  return res.status(200).json({
    items: sanitizedItems,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  });
}

/**
 * Get Equipment by Asset Code (QR Scan Endpoint).
 * WHY: Technicians in the yard scan the physical QR code on an asset, which encodes its
 * natural `asset_code` (e.g. CRN-50-001). This endpoint returns the machine's current derived
 * status, physical location, recent location history, active repair tickets, and current rental.
 * Rate cards and financial terms are omitted for staff via `sanitizeFinancials`.
 */
export async function getEquipmentByAssetCode(req: Request, res: Response) {
  const assetCode = req.params.asset_code?.trim();
  if (!assetCode) {
    return res.status(400).json({ error: 'asset_code path parameter is required' });
  }

  // 1. Fetch current derived record from view
  const equipRes = await pool.query(
    `SELECT * FROM v_equipment_current WHERE LOWER(asset_code) = LOWER($1) AND active = true`,
    [assetCode]
  );

  if (equipRes.rows.length === 0) {
    return res.status(404).json({ error: `Equipment with asset code '${assetCode}' was not found` });
  }

  const equipment = equipRes.rows[0];

  // 2. Fetch recent location history (latest 10 movements)
  const historyRes = await pool.query(
    `SELECT
       ll.id,
       ll.location_id,
       loc.name AS location_name,
       loc.kind AS location_kind,
       ll.moved_at,
       ll.note,
       u.name AS moved_by_name
     FROM location_log ll
     JOIN locations loc ON loc.id = ll.location_id
     JOIN users u ON u.id = ll.moved_by
     WHERE ll.equipment_id = $1
     ORDER BY ll.moved_at DESC
     LIMIT 10`,
    [equipment.id]
  );

  // 3. Fetch active rental details if rented
  let activeRental = null;
  if (equipment.status === 'rented') {
    const rentalRes = await pool.query(
      `SELECT
         r.id AS rental_id,
         r.status AS rental_status,
         r.customer_id,
         p.name AS customer_name,
         p.phone AS customer_phone,
         p.contact_person AS customer_contact,
         r.site_id,
         loc.name AS site_name,
         r.start_date,
         r.expected_end,
         ri.applied_rate,
         ri.rate_unit,
         ri.discount_note
       FROM rental_items ri
       JOIN rentals r ON r.id = ri.rental_id
       JOIN parties p ON p.id = r.customer_id
       JOIN locations loc ON loc.id = r.site_id
       WHERE ri.equipment_id = $1 AND ri.returned_at IS NULL
       LIMIT 1`,
      [equipment.id]
    );
    if (rentalRes.rows.length > 0) {
      activeRental = rentalRes.rows[0];
    }
  }

  // 4. Fetch open maintenance record if under repair
  let openMaintenance = null;
  if (equipment.status === 'under_repair') {
    const maintRes = await pool.query(
      `SELECT
         m.id,
         m.kind,
         m.description,
         m.cost,
         m.opened_at,
         u.name AS reported_by_name
       FROM maintenance m
       JOIN users u ON u.id = m.reported_by
       WHERE m.equipment_id = $1 AND m.closed_at IS NULL
       LIMIT 1`,
      [equipment.id]
    );
    if (maintRes.rows.length > 0) {
      openMaintenance = maintRes.rows[0];
    }
  }

  // 5. If user is admin, attach standard rate cards for this model
  let standardRates = undefined;
  if (req.user!.role === 'admin') {
    const ratesRes = await pool.query(
      `SELECT unit, amount, vat_included, valid_from
       FROM rates
       WHERE model_id = $1
       ORDER BY valid_from DESC, unit`,
      [equipment.model_id]
    );
    standardRates = ratesRes.rows;
  }

  const responsePayload = {
    ...equipment,
    location_history: historyRes.rows,
    active_rental: activeRental,
    open_maintenance: openMaintenance,
    ...(standardRates && { standard_rates: standardRates }),
  };

  // WHY: Pass through server sanitizer so staff cannot see applied_rate, discount_note, cost, or rates
  const sanitized = sanitizeFinancials(responsePayload, req.user!.role);

  return res.status(200).json(sanitized);
}

/**
 * Move Equipment Action Controller.
 * WHY: Staff move equipment between yards, client sites, or workshops.
 * An asset's location is NEVER edited in place; instead, an append-only log entry
 * is inserted in `location_log`. `v_equipment_current` immediately reflects the new location.
 */
export async function moveEquipment(req: Request, res: Response) {
  const assetCode = req.params.asset_code?.trim();
  const parseResult = moveEquipmentSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { location_id, note } = parseResult.data;

  // Verify equipment exists
  const equipRes = await pool.query(
    `SELECT id, asset_code FROM equipment WHERE LOWER(asset_code) = LOWER($1) AND active = true`,
    [assetCode]
  );
  if (equipRes.rows.length === 0) {
    return res.status(404).json({ error: `Equipment with asset code '${assetCode}' was not found` });
  }
  const equipment = equipRes.rows[0];

  // Verify target location exists
  const locRes = await pool.query(`SELECT id, name, kind FROM locations WHERE id = $1`, [location_id]);
  if (locRes.rows.length === 0) {
    return res.status(400).json({ error: `Destination location with id ${location_id} does not exist` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Append to immutable location audit trail
    await client.query(
      `INSERT INTO location_log (equipment_id, location_id, moved_by, note)
       VALUES ($1, $2, $3, $4)`,
      [equipment.id, location_id, req.user!.id, note ?? null]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Fetch and return the updated derived record
  const updatedRes = await pool.query(
    `SELECT * FROM v_equipment_current WHERE id = $1`,
    [equipment.id]
  );
  const sanitized = sanitizeFinancials(updatedRes.rows[0], req.user!.role);

  return res.status(200).json({
    message: `Equipment ${equipment.asset_code} successfully moved to ${locRes.rows[0].name}`,
    equipment: sanitized,
  });
}

/**
 * Return Equipment Action Controller.
 * WHY: When a rented crane or generator returns from a customer site, this action
 * marks the rental item as returned (`returned_at = CURRENT_TIMESTAMP`), logs its new
 * physical location in `location_log`, and updates equipment condition if provided.
 * The derived view immediately recalculates status from 'rented' to 'available'.
 */
export async function returnEquipment(req: Request, res: Response) {
  const assetCode = req.params.asset_code?.trim();
  const parseResult = returnEquipmentSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { location_id, condition, note } = parseResult.data;

  // 1. Verify equipment exists
  const equipRes = await pool.query(
    `SELECT id, asset_code FROM equipment WHERE LOWER(asset_code) = LOWER($1) AND active = true`,
    [assetCode]
  );
  if (equipRes.rows.length === 0) {
    return res.status(404).json({ error: `Equipment with asset code '${assetCode}' was not found` });
  }
  const equipment = equipRes.rows[0];

  // 2. Verify target receiving location exists (yard, workshop)
  const locRes = await pool.query(`SELECT id, name, kind FROM locations WHERE id = $1`, [location_id]);
  if (locRes.rows.length === 0) {
    return res.status(400).json({ error: `Destination location with id ${location_id} does not exist` });
  }

  // 3. Verify equipment is currently rented
  const activeRentalRes = await pool.query(
    `SELECT ri.rental_id, ri.equipment_id, r.customer_id
     FROM rental_items ri
     JOIN rentals r ON r.id = ri.rental_id
     WHERE ri.equipment_id = $1 AND ri.returned_at IS NULL AND r.status IN ('confirmed', 'picked_up')`,
    [equipment.id]
  );

  if (activeRentalRes.rows.length === 0) {
    return res.status(400).json({
      error: `Equipment ${equipment.asset_code} does not have an active rental to return`,
    });
  }

  const rentalId = activeRentalRes.rows[0].rental_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mark rental item as returned
    await client.query(
      `UPDATE rental_items
       SET returned_at = CURRENT_TIMESTAMP
       WHERE rental_id = $1 AND equipment_id = $2 AND returned_at IS NULL`,
      [rentalId, equipment.id]
    );

    // Update condition if technician inspected and provided condition
    if (condition) {
      await client.query(
        `UPDATE equipment SET condition = $1 WHERE id = $2`,
        [condition, equipment.id]
      );
    }

    // Insert receiving location log
    const returnNote = note ? `Returned from rental #${rentalId}: ${note}` : `Returned from rental #${rentalId}`;
    await client.query(
      `INSERT INTO location_log (equipment_id, location_id, moved_by, note)
       VALUES ($1, $2, $3, $4)`,
      [equipment.id, location_id, req.user!.id, returnNote]
    );

    // If all items for this rental are returned, update rental header status to 'returned'
    const unreturnedCheck = await client.query(
      `SELECT COUNT(*) AS remaining
       FROM rental_items
       WHERE rental_id = $1 AND returned_at IS NULL`,
      [rentalId]
    );
    if (parseInt(unreturnedCheck.rows[0].remaining, 10) === 0) {
      await client.query(
        `UPDATE rentals SET status = 'returned' WHERE id = $1`,
        [rentalId]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Return updated derived view
  const updatedRes = await pool.query(
    `SELECT * FROM v_equipment_current WHERE id = $1`,
    [equipment.id]
  );
  const sanitized = sanitizeFinancials(updatedRes.rows[0], req.user!.role);

  return res.status(200).json({
    message: `Equipment ${equipment.asset_code} successfully returned from rental #${rentalId} to ${locRes.rows[0].name}`,
    equipment: sanitized,
  });
}

/**
 * Send to Repair Action Controller.
 * WHY: Technicians in the field or yard initiate repairs by filing a maintenance record.
 * This operation moves the asset to a workshop location, updates condition to 'needs_repair',
 * and opens a row in `maintenance`. The derived view immediately updates status to 'under_repair'.
 */
export async function sendToRepair(req: Request, res: Response) {
  const assetCode = req.params.asset_code?.trim();
  const parseResult = repairEquipmentSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { kind, description, workshop_location_id, cost, note } = parseResult.data;

  // 1. Verify equipment exists
  const equipRes = await pool.query(
    `SELECT id, asset_code FROM equipment WHERE LOWER(asset_code) = LOWER($1) AND active = true`,
    [assetCode]
  );
  if (equipRes.rows.length === 0) {
    return res.status(404).json({ error: `Equipment with asset code '${assetCode}' was not found` });
  }
  const equipment = equipRes.rows[0];

  // 2. Check current status from view
  const currentRes = await pool.query(
    `SELECT status, current_location_id FROM v_equipment_current WHERE id = $1`,
    [equipment.id]
  );
  const currentRecord = currentRes.rows[0];

  if (currentRecord.status === 'rented') {
    return res.status(400).json({
      error: `Equipment ${equipment.asset_code} is actively rented. It must be returned to a yard before opening maintenance.`,
    });
  }

  if (currentRecord.status === 'under_repair') {
    return res.status(400).json({
      error: `Equipment ${equipment.asset_code} already has an open maintenance work order.`,
    });
  }

  // 3. Resolve destination workshop location
  let targetLocationId = workshop_location_id;
  if (!targetLocationId) {
    // Default to fleet workshop
    const workshopRes = await pool.query(
      `SELECT id FROM locations WHERE kind = 'workshop' LIMIT 1`
    );
    if (workshopRes.rows.length > 0) {
      targetLocationId = workshopRes.rows[0].id;
    } else {
      targetLocationId = currentRecord.current_location_id;
    }
  } else {
    const locCheck = await pool.query(`SELECT id FROM locations WHERE id = $1`, [targetLocationId]);
    if (locCheck.rows.length === 0) {
      return res.status(400).json({ error: `Workshop location with id ${targetLocationId} does not exist` });
    }
  }

  // Cost security: Only admin can record a non-zero maintenance cost initially
  const actualCost = req.user!.role === 'admin' ? (cost ?? 0.0) : 0.0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create maintenance order
    const maintInsertRes = await client.query(
      `INSERT INTO maintenance (equipment_id, kind, description, cost, reported_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [equipment.id, kind, description, actualCost, req.user!.id]
    );
    const maintId = maintInsertRes.rows[0].id;

    // 2. Update equipment condition
    await client.query(
      `UPDATE equipment SET condition = 'needs_repair' WHERE id = $1`,
      [equipment.id]
    );

    // 3. Insert location log moving equipment to workshop
    const maintNote = note ? `Sent to repair (WO #${maintId}): ${note}` : `Sent to repair (WO #${maintId}): ${description}`;
    await client.query(
      `INSERT INTO location_log (equipment_id, location_id, moved_by, note)
       VALUES ($1, $2, $3, $4)`,
      [equipment.id, targetLocationId, req.user!.id, maintNote]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Return updated derived view
  const updatedRes = await pool.query(
    `SELECT * FROM v_equipment_current WHERE id = $1`,
    [equipment.id]
  );
  const sanitized = sanitizeFinancials(updatedRes.rows[0], req.user!.role);

  return res.status(200).json({
    message: `Equipment ${equipment.asset_code} successfully sent to maintenance`,
    equipment: sanitized,
  });
}
