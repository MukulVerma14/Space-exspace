import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import crypto from 'crypto';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { findSyncEventById, persistSyncEvent } from '../services/syncEventService.js';
import { sanitizeFinancials } from '../serializers/rateSerializer.js';
import { UserRole } from '../types/auth.js';

// Maximum allowed events in a single sync batch
const MAX_BATCH_SIZE = 50;

// Maximum acceptable future clock skew (5 minutes in milliseconds)
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface EventRejection {
  code: string;
  message: string;
}

export interface SyncPerEventResult {
  client_event_id: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  result?: Record<string, unknown> | null;
  error?: string;
  message?: string;
}

const singleEventSchema = z.object({
  client_event_id: z.string().uuid('client_event_id must be a valid UUID'),
  user_id: z.number().int().positive('user_id must be a positive integer'),
  type: z.string().min(1, 'type is required'),
  payload: z.record(z.any()),
  occurred_at: z.string().or(z.date()),
});

/**
 * Controller for GET /api/sync/snapshot
 * Returns cacheable operational data according to caller's role:
 * - Equipment list with current status and location
 * - Locations list (yards, client sites, workshops)
 * - Materials items list with current stock levels
 * Includes server_time and deterministic ETag header for conditional requests (If-None-Match).
 * Staff responses contain zero financial or money fields (rates, prices, costs).
 */
export async function getSyncSnapshot(req: Request, res: Response): Promise<void> {
  const currentUser = req.user!;
  const userRole: UserRole = currentUser.role;

  // 1. Fetch equipment list from derived state view
  const equipmentQuery = `
    SELECT
      id, asset_code, serial_no, condition, active, created_at,
      model_id, make, model, capacity_value, type_id, type_name, capacity_unit,
      current_location_id, current_location_name, current_location_kind,
      last_moved_at, last_moved_by, last_moved_by_name,
      status, current_rental_id, current_customer_id, current_customer_name,
      current_site_name, current_rental_expected_end,
      current_maintenance_id, current_maintenance_desc
    FROM v_equipment_current
    WHERE active = true
    ORDER BY asset_code ASC
  `;
  const equipmentRes = await pool.query(equipmentQuery);

  // 2. Fetch locations list
  const locationsQuery = `
    SELECT id, name, kind, party_id, created_at
    FROM locations
    ORDER BY id ASC
  `;
  const locationsRes = await pool.query(locationsQuery);

  // 3. Fetch materials inventory with stock on hand calculated from append-only ledger
  const itemsQuery = `
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
      COALESCE(SUM(sm.qty), 0)::numeric(12,3) AS stock_on_hand,
      (COALESCE(SUM(sm.qty), 0) <= i.reorder_level) AS is_low_stock
    FROM items i
    JOIN item_categories ic ON ic.id = i.category_id
    JOIN units u ON u.id = i.unit_id
    LEFT JOIN stock_movements sm ON sm.item_id = i.id
    WHERE i.active = true
    GROUP BY i.id, ic.name, u.code, u.name
    ORDER BY i.sku ASC
  `;
  const itemsRes = await pool.query(itemsQuery);

  // If admin, attach standard rate cards to snapshot for reference
  let standardRates: Record<string, unknown>[] | undefined = undefined;
  if (userRole === 'admin') {
    const ratesRes = await pool.query(`
      SELECT r.model_id, em.make, em.model, r.unit, r.amount, r.vat_included, r.valid_from
      FROM rates r
      JOIN equipment_models em ON em.id = r.model_id
      ORDER BY r.model_id, r.unit
    `);
    standardRates = ratesRes.rows;
  }

  const rawSnapshot: Record<string, unknown> = {
    role: userRole,
    equipment: equipmentRes.rows,
    locations: locationsRes.rows,
    materials: itemsRes.rows,
    ...(standardRates ? { standard_rates: standardRates } : {}),
  };

  // Crucial: sanitize financials server-side so staff responses never contain rate/price/cost fields
  const sanitizedSnapshot = sanitizeFinancials(rawSnapshot, userRole);

  // Compute deterministic ETag based on serialized data content and role
  const contentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(sanitizedSnapshot))
    .digest('hex');
  const etag = `W/"${contentHash.substring(0, 32)}"`;

  res.setHeader('ETag', etag);

  // Handle conditional request (If-None-Match)
  const clientEtag = req.headers['if-none-match'];
  if (clientEtag && clientEtag === etag) {
    res.status(304).end();
    return;
  }

  const serverTime = new Date().toISOString();

  res.status(200).json({
    server_time: serverTime,
    etag,
    ...sanitizedSnapshot,
  });
}

/**
 * Controller for POST /api/sync
 * Accepts batches up to 50 events, processes them in occurred_at order,
 * executes each in its own transaction, re-checks business preconditions,
 * enforces clock skew and user token matches, never drops rejected events,
 * and strips financial rates from staff responses.
 */
export async function processSyncBatch(req: Request, res: Response): Promise<void> {
  const rawEvents = Array.isArray(req.body) ? req.body : req.body?.events;

  if (!rawEvents || !Array.isArray(rawEvents)) {
    res.status(400).json({
      error: 'Invalid request body. Expected an array of events or an object with an events property.',
      code: 'INVALID_BATCH_FORMAT',
    });
    return;
  }

  if (rawEvents.length > MAX_BATCH_SIZE) {
    res.status(400).json({
      error: `Batch size exceeds maximum limit of ${MAX_BATCH_SIZE} events (received ${rawEvents.length}).`,
      code: 'BATCH_SIZE_EXCEEDED',
    });
    return;
  }

  if (rawEvents.length === 0) {
    res.status(200).json({
      processed: 0,
      results: [],
    });
    return;
  }

  const currentUser = req.user!;
  const userRole: UserRole = currentUser.role;

  // Validate each item with zod or catch schema errors per-event
  const validatedEvents: Array<z.infer<typeof singleEventSchema>> = [];
  const results: SyncPerEventResult[] = [];

  for (const raw of rawEvents) {
    const parse = singleEventSchema.safeParse(raw);
    if (!parse.success) {
      const clientEventId = typeof raw?.client_event_id === 'string' ? raw.client_event_id : 'unknown';
      results.push({
        client_event_id: clientEventId,
        status: 'rejected',
        error: 'SCHEMA_VALIDATION_ERROR',
        message: parse.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
      });
    } else {
      validatedEvents.push(parse.data);
    }
  }

  // Sort validated events in chronological occurred_at order
  validatedEvents.sort((a, b) => {
    const timeA = new Date(a.occurred_at).getTime();
    const timeB = new Date(b.occurred_at).getTime();
    return timeA - timeB;
  });

  const nowMs = Date.now();

  for (const event of validatedEvents) {
    const occurredTime = new Date(event.occurred_at).getTime();

    // 1. Clock skew check: reject if occurred_at is more than 5 minutes in the future
    if (isNaN(occurredTime) || occurredTime > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
      await recordRejectionOutside(
        event.client_event_id,
        currentUser.id,
        event.type,
        event.payload,
        event.occurred_at,
        'CLOCK_SKEW_EXCEEDED',
        'occurred_at is more than 5 minutes in the future'
      );

      results.push({
        client_event_id: event.client_event_id,
        status: 'rejected',
        error: 'CLOCK_SKEW_EXCEEDED',
        message: 'occurred_at is more than 5 minutes in the future',
      });
      continue;
    }

    // 2. User authorization check: event.user_id must equal the authenticated token user
    if (event.user_id !== currentUser.id) {
      await recordRejectionOutside(
        event.client_event_id,
        currentUser.id,
        event.type,
        event.payload,
        event.occurred_at,
        'USER_MISMATCH',
        `Event user_id (${event.user_id}) does not match authenticated user (${currentUser.id})`
      );

      results.push({
        client_event_id: event.client_event_id,
        status: 'rejected',
        error: 'USER_MISMATCH',
        message: `Event user_id (${event.user_id}) does not match authenticated user (${currentUser.id})`,
      });
      continue;
    }

    // 3. Process event inside its own isolated transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 3a. Idempotency check: see if client_event_id was already processed
      const existing = await findSyncEventById(client, event.client_event_id);
      if (existing) {
        await client.query('ROLLBACK');
        results.push({
          client_event_id: event.client_event_id,
          status: 'duplicate',
          result: sanitizeFinancials(existing.result, userRole),
        });
        continue;
      }

      // 3b. Dispatch event to type-specific business logic
      const handlerResult = await executeSyncAction(client, event, currentUser.id, userRole);

      // 3c. Persist success into sync_events
      await persistSyncEvent(client, {
        client_event_id: event.client_event_id,
        user_id: currentUser.id,
        type: event.type,
        payload: event.payload,
        status: 'accepted',
        result: handlerResult,
        occurred_at: event.occurred_at,
      });

      await client.query('COMMIT');

      results.push({
        client_event_id: event.client_event_id,
        status: 'accepted',
        result: sanitizeFinancials(handlerResult, userRole),
      });
    } catch (err: unknown) {
      await client.query('ROLLBACK');

      let rejection: EventRejection;
      if (isEventRejection(err)) {
        rejection = err;
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.includes('Stock cannot become negative') || errorMsg.includes('Cannot issue')) {
          rejection = { code: 'INSUFFICIENT_STOCK', message: 'Stock cannot become negative' };
        } else {
          rejection = { code: 'EXECUTION_ERROR', message: errorMsg };
        }
      }

      // NEVER silently drop a rejected event: record in sync_events
      await recordRejectionOutside(
        event.client_event_id,
        currentUser.id,
        event.type,
        event.payload,
        event.occurred_at,
        rejection.code,
        rejection.message
      );

      results.push({
        client_event_id: event.client_event_id,
        status: 'rejected',
        error: rejection.code,
        message: rejection.message,
      });
    } finally {
      client.release();
    }
  }

  res.status(200).json({
    processed: results.length,
    results: sanitizeFinancials(results, userRole),
  });
}

function isEventRejection(err: unknown): err is EventRejection {
  return typeof err === 'object' && err !== null && 'code' in err && 'message' in err;
}

/**
 * Persists a rejection into sync_events using a fresh client connection.
 * Guarantees that even when the business transaction rolls back, the rejection audit row is saved.
 */
async function recordRejectionOutside(
  clientEventId: string,
  userId: number,
  type: string,
  payload: Record<string, unknown>,
  occurredAt: string | Date,
  code: string,
  message: string
): Promise<void> {
  const client = await pool.connect();
  try {
    const existing = await findSyncEventById(client, clientEventId);
    if (!existing) {
      await persistSyncEvent(client, {
        client_event_id: clientEventId,
        user_id: userId,
        type,
        payload,
        status: 'rejected',
        result: { error: code, message },
        occurred_at: occurredAt,
      });
    }
  } catch (e) {
    console.error('Failed to persist sync event rejection:', e);
  } finally {
    client.release();
  }
}

/**
 * Dispatches an offline event to the appropriate domain logic.
 * Evaluates business preconditions at sync time and returns a descriptive result object.
 */
async function executeSyncAction(
  client: PoolClient,
  event: z.infer<typeof singleEventSchema>,
  userId: number,
  userRole: UserRole
): Promise<Record<string, unknown>> {
  const normalizedType = event.type.toLowerCase().trim();

  switch (normalizedType) {
    case 'equipment.move':
    case 'move':
      return await handleEquipmentMove(client, event.payload, userId, event.occurred_at);

    case 'equipment.return':
    case 'return':
      return await handleEquipmentReturn(client, event.payload, userId, event.occurred_at);

    case 'equipment.repair':
    case 'equipment.send_to_repair':
    case 'repair':
      return await handleEquipmentRepair(client, event.payload, userId, event.occurred_at);

    case 'material.goods_received':
    case 'material.receipt':
    case 'goods_received':
    case 'receipt':
      return await handleMaterialGoodsReceived(client, event.payload, userId, event.occurred_at);

    case 'material.issue':
    case 'issue':
      return await handleMaterialIssue(client, event.payload, userId, event.occurred_at);

    default:
      throw {
        code: 'UNSUPPORTED_EVENT_TYPE',
        message: `Event type '${event.type}' is not supported for offline replay`,
      } as EventRejection;
  }
}

/**
 * Replays an equipment relocation.
 * Appends to location_log with moved_at = occurred_at.
 */
async function handleEquipmentMove(
  client: PoolClient,
  payload: Record<string, any>,
  userId: number,
  occurredAt: string | Date
): Promise<Record<string, unknown>> {
  const assetCode = payload.asset_code?.toString().trim();
  const locationId = Number(payload.location_id);
  const note = payload.note ? String(payload.note) : null;

  if (!assetCode) {
    throw { code: 'INVALID_PAYLOAD', message: 'asset_code is required for equipment move' };
  }
  if (!locationId || isNaN(locationId)) {
    throw { code: 'INVALID_PAYLOAD', message: 'Valid location_id is required for equipment move' };
  }

  // Precondition: equipment exists and active
  const equipRes = await client.query(
    `SELECT id, asset_code FROM equipment WHERE LOWER(asset_code) = LOWER($1) AND active = true`,
    [assetCode]
  );
  if (equipRes.rows.length === 0) {
    throw { code: 'EQUIPMENT_NOT_FOUND', message: `Equipment with asset code '${assetCode}' was not found` };
  }
  const equipment = equipRes.rows[0];

  // Precondition: destination location exists
  const locRes = await client.query(`SELECT id, name FROM locations WHERE id = $1`, [locationId]);
  if (locRes.rows.length === 0) {
    throw { code: 'LOCATION_NOT_FOUND', message: `Destination location with id ${locationId} does not exist` };
  }

  // Append to location_log with moved_at set to physical occurred time
  await client.query(
    `INSERT INTO location_log (equipment_id, location_id, moved_by, note, moved_at, recorded_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
    [equipment.id, locationId, userId, note, occurredAt]
  );

  // Return derived state
  const updatedRes = await client.query(`SELECT * FROM v_equipment_current WHERE id = $1`, [equipment.id]);
  return {
    action: 'equipment.move',
    asset_code: equipment.asset_code,
    new_location_id: locationId,
    location_name: locRes.rows[0].name,
    equipment: updatedRes.rows[0],
  };
}

/**
 * Replays an equipment return from customer site.
 * Re-checks precondition: equipment MUST be actively rented.
 */
async function handleEquipmentReturn(
  client: PoolClient,
  payload: Record<string, any>,
  userId: number,
  occurredAt: string | Date
): Promise<Record<string, unknown>> {
  const assetCode = payload.asset_code?.toString().trim();
  const locationId = Number(payload.location_id);
  const condition = payload.condition ? String(payload.condition) : undefined;
  const note = payload.note ? String(payload.note) : null;

  if (!assetCode) {
    throw { code: 'INVALID_PAYLOAD', message: 'asset_code is required for equipment return' };
  }
  if (!locationId || isNaN(locationId)) {
    throw { code: 'INVALID_PAYLOAD', message: 'Valid location_id is required for equipment return' };
  }

  // 1. Verify equipment exists
  const equipRes = await client.query(
    `SELECT id, asset_code FROM equipment WHERE LOWER(asset_code) = LOWER($1) AND active = true`,
    [assetCode]
  );
  if (equipRes.rows.length === 0) {
    throw { code: 'EQUIPMENT_NOT_FOUND', message: `Equipment with asset code '${assetCode}' was not found` };
  }
  const equipment = equipRes.rows[0];

  // 2. Verify destination location exists
  const locRes = await client.query(`SELECT id, name FROM locations WHERE id = $1`, [locationId]);
  if (locRes.rows.length === 0) {
    throw { code: 'LOCATION_NOT_FOUND', message: `Destination location with id ${locationId} does not exist` };
  }

  // 3. Precondition: Equipment must have an active rental
  const activeRentalRes = await client.query(
    `SELECT ri.rental_id, ri.equipment_id, r.customer_id
     FROM rental_items ri
     JOIN rentals r ON r.id = ri.rental_id
     WHERE ri.equipment_id = $1 AND ri.returned_at IS NULL AND r.status IN ('confirmed', 'picked_up')`,
    [equipment.id]
  );

  if (activeRentalRes.rows.length === 0) {
    throw {
      code: 'NOT_RENTED',
      message: `Equipment ${equipment.asset_code} does not have an active rental to return`,
    };
  }

  const rentalId = activeRentalRes.rows[0].rental_id;

  // Mark rental item returned at occurred time
  await client.query(
    `UPDATE rental_items
     SET returned_at = $1
     WHERE rental_id = $2 AND equipment_id = $3 AND returned_at IS NULL`,
    [occurredAt, rentalId, equipment.id]
  );

  if (condition) {
    await client.query(`UPDATE equipment SET condition = $1 WHERE id = $2`, [condition, equipment.id]);
  }

  // Append receiving location log
  const returnNote = note ? `Returned from rental #${rentalId}: ${note}` : `Returned from rental #${rentalId}`;
  await client.query(
    `INSERT INTO location_log (equipment_id, location_id, moved_by, note, moved_at, recorded_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
    [equipment.id, locationId, userId, returnNote, occurredAt]
  );

  // If all items for this rental are returned, update rental status to 'returned'
  const unreturnedCheck = await client.query(
    `SELECT COUNT(*) AS remaining FROM rental_items WHERE rental_id = $1 AND returned_at IS NULL`,
    [rentalId]
  );
  if (parseInt(unreturnedCheck.rows[0].remaining, 10) === 0) {
    await client.query(`UPDATE rentals SET status = 'returned' WHERE id = $1`, [rentalId]);
  }

  const updatedRes = await client.query(`SELECT * FROM v_equipment_current WHERE id = $1`, [equipment.id]);
  return {
    action: 'equipment.return',
    asset_code: equipment.asset_code,
    rental_id: rentalId,
    location_name: locRes.rows[0].name,
    equipment: updatedRes.rows[0],
  };
}

/**
 * Replays sending equipment to repair / opening a maintenance work order.
 * Re-checks preconditions: cannot be currently rented or already under repair.
 */
async function handleEquipmentRepair(
  client: PoolClient,
  payload: Record<string, any>,
  userId: number,
  occurredAt: string | Date
): Promise<Record<string, unknown>> {
  const assetCode = payload.asset_code?.toString().trim();
  const kind = payload.kind ? String(payload.kind) : 'breakdown';
  const description = payload.description ? String(payload.description) : 'Offline repair request';
  const workshopLocationId = payload.workshop_location_id ? Number(payload.workshop_location_id) : undefined;
  const note = payload.note ? String(payload.note) : null;

  if (!assetCode) {
    throw { code: 'INVALID_PAYLOAD', message: 'asset_code is required for equipment repair' };
  }

  // 1. Verify equipment exists
  const equipRes = await client.query(
    `SELECT id, asset_code FROM equipment WHERE LOWER(asset_code) = LOWER($1) AND active = true`,
    [assetCode]
  );
  if (equipRes.rows.length === 0) {
    throw { code: 'EQUIPMENT_NOT_FOUND', message: `Equipment with asset code '${assetCode}' was not found` };
  }
  const equipment = equipRes.rows[0];

  // 2. Preconditions from current derived state
  const currentRes = await client.query(
    `SELECT status, current_location_id FROM v_equipment_current WHERE id = $1`,
    [equipment.id]
  );
  const currentRecord = currentRes.rows[0];

  if (currentRecord.status === 'rented') {
    throw {
      code: 'EQUIPMENT_RENTED',
      message: `Equipment ${equipment.asset_code} is actively rented. It must be returned to a yard before opening maintenance.`,
    };
  }

  if (currentRecord.status === 'under_repair') {
    throw {
      code: 'ALREADY_UNDER_REPAIR',
      message: `Equipment ${equipment.asset_code} already has an open maintenance work order.`,
    };
  }

  // 3. Resolve destination workshop location
  let targetLocationId = workshopLocationId;
  if (!targetLocationId) {
    const workshopRes = await client.query(`SELECT id FROM locations WHERE kind = 'workshop' LIMIT 1`);
    if (workshopRes.rows.length > 0) {
      targetLocationId = workshopRes.rows[0].id;
    } else {
      targetLocationId = currentRecord.current_location_id;
    }
  } else {
    const locCheck = await client.query(`SELECT id FROM locations WHERE id = $1`, [targetLocationId]);
    if (locCheck.rows.length === 0) {
      throw { code: 'LOCATION_NOT_FOUND', message: `Workshop location with id ${targetLocationId} does not exist` };
    }
  }

  // 4. Create maintenance record (cost = 0.00 for offline operations)
  const maintInsertRes = await client.query(
    `INSERT INTO maintenance (equipment_id, kind, description, cost, reported_by, opened_at)
     VALUES ($1, $2, $3, 0.00, $4, $5)
     RETURNING id`,
    [equipment.id, kind, description, userId, occurredAt]
  );
  const maintId = maintInsertRes.rows[0].id;

  // 5. Update equipment condition
  await client.query(`UPDATE equipment SET condition = 'needs_repair' WHERE id = $1`, [equipment.id]);

  // 6. Insert location log moving to workshop
  const maintNote = note ? `Sent to repair (WO #${maintId}): ${note}` : `Sent to repair (WO #${maintId}): ${description}`;
  await client.query(
    `INSERT INTO location_log (equipment_id, location_id, moved_by, note, moved_at, recorded_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
    [equipment.id, targetLocationId, userId, maintNote, occurredAt]
  );

  const updatedRes = await client.query(`SELECT * FROM v_equipment_current WHERE id = $1`, [equipment.id]);
  return {
    action: 'equipment.repair',
    asset_code: equipment.asset_code,
    maintenance_id: maintId,
    equipment: updatedRes.rows[0],
  };
}

/**
 * Replays goods received (materials).
 * Scope: Qty-only (no unit_costs or prices permitted in offline mode).
 */
async function handleMaterialGoodsReceived(
  client: PoolClient,
  payload: Record<string, any>,
  userId: number,
  occurredAt: string | Date
): Promise<Record<string, unknown>> {
  const itemId = Number(payload.item_id);
  const qty = Number(payload.qty);
  const note = payload.note ? String(payload.note) : null;

  if (!itemId || isNaN(itemId)) {
    throw { code: 'INVALID_PAYLOAD', message: 'Valid item_id is required' };
  }
  if (!qty || isNaN(qty) || qty <= 0) {
    throw { code: 'INVALID_QUANTITY', message: 'Quantity must be positive for goods received' };
  }

  // Precondition: item exists and active
  const itemCheck = await client.query(`SELECT id, name FROM items WHERE id = $1 AND active = true`, [itemId]);
  if (itemCheck.rows.length === 0) {
    throw { code: 'ITEM_NOT_FOUND', message: 'Material item not found or deactivated' };
  }

  const positiveQty = Math.abs(qty);

  // Insert stock movement with unit_cost = 0.00 (qty-only)
  const insertRes = await client.query(
    `INSERT INTO stock_movements (item_id, qty, type, unit_cost, moved_by, note, moved_at, recorded_at)
     VALUES ($1, $2, 'receipt', 0.00, $3, $4, $5, CURRENT_TIMESTAMP)
     RETURNING id`,
    [itemId, positiveQty, userId, note, occurredAt]
  );

  const stockRes = await client.query<{ current_stock: string }>(
    `SELECT COALESCE(SUM(qty), 0) AS current_stock FROM stock_movements WHERE item_id = $1`,
    [itemId]
  );

  return {
    action: 'material.goods_received',
    movement_id: parseInt(insertRes.rows[0].id, 10),
    item_id: itemId,
    delta_qty: positiveQty,
    current_stock: parseFloat(stockRes.rows[0].current_stock),
  };
}

/**
 * Replays material issue.
 * Precondition: Cannot issue stock below zero.
 */
async function handleMaterialIssue(
  client: PoolClient,
  payload: Record<string, any>,
  userId: number,
  occurredAt: string | Date
): Promise<Record<string, unknown>> {
  const itemId = Number(payload.item_id);
  const qty = Number(payload.qty);
  const maintenanceId = payload.maintenance_id ? Number(payload.maintenance_id) : null;
  const note = payload.note ? String(payload.note) : null;

  if (!itemId || isNaN(itemId)) {
    throw { code: 'INVALID_PAYLOAD', message: 'Valid item_id is required' };
  }
  if (!qty || isNaN(qty) || qty <= 0) {
    throw { code: 'INVALID_QUANTITY', message: 'Quantity must be positive for material issue' };
  }

  // Precondition: item exists and active
  const itemCheck = await client.query(`SELECT id, name FROM items WHERE id = $1 AND active = true`, [itemId]);
  if (itemCheck.rows.length === 0) {
    throw { code: 'ITEM_NOT_FOUND', message: 'Material item not found or deactivated' };
  }

  const signedQty = -Math.abs(qty);

  // Precondition check: cannot issue below zero
  const currentStockRes = await client.query<{ current_stock: string }>(
    `SELECT COALESCE(SUM(qty), 0) AS current_stock FROM stock_movements WHERE item_id = $1`,
    [itemId]
  );
  const currentStock = parseFloat(currentStockRes.rows[0].current_stock);
  if (currentStock + signedQty < 0) {
    throw {
      code: 'INSUFFICIENT_STOCK',
      message: `Stock cannot become negative. Available stock: ${currentStock}, requested: ${Math.abs(qty)}`,
    };
  }

  // Insert signed stock movement
  const insertRes = await client.query(
    `INSERT INTO stock_movements (item_id, qty, type, unit_cost, maintenance_id, moved_by, note, moved_at, recorded_at)
     VALUES ($1, $2, 'issue', 0.00, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     RETURNING id`,
    [itemId, signedQty, maintenanceId, userId, note, occurredAt]
  );

  const updatedStockRes = await client.query<{ current_stock: string }>(
    `SELECT COALESCE(SUM(qty), 0) AS current_stock FROM stock_movements WHERE item_id = $1`,
    [itemId]
  );

  return {
    action: 'material.issue',
    movement_id: parseInt(insertRes.rows[0].id, 10),
    item_id: itemId,
    delta_qty: signedQty,
    current_stock: parseFloat(updatedStockRes.rows[0].current_stock),
  };
}
