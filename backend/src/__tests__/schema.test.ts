import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../db/pool.js';

describe('Database Schema, Constraints, and Derived View', () => {
  let adminUserId: number;
  let testTypeId: number;
  let testModelId: number;
  let testEquipmentId: number;
  let testCustomerId: number;
  let testLocationYardId: number;
  let testLocationSiteId: number;
  let testItemId: number;

  const testEmail = 'tester_schema@spaceexspace.com';
  const testAssetCode = 'TEST-CRN-001';
  const testSku = 'TEST-CONDUIT-001';
  const testCustomerName = 'Fictional Industrial Contractor Ltd';

  async function cleanupTestData() {
    await pool.query(`DELETE FROM rental_items WHERE equipment_id IN (SELECT id FROM equipment WHERE asset_code = $1)`, [testAssetCode]);
    await pool.query(`DELETE FROM maintenance WHERE equipment_id IN (SELECT id FROM equipment WHERE asset_code = $1)`, [testAssetCode]);
    await pool.query(`DELETE FROM location_log WHERE equipment_id IN (SELECT id FROM equipment WHERE asset_code = $1)`, [testAssetCode]);
    await pool.query(`DELETE FROM location_log WHERE moved_by IN (SELECT id FROM users WHERE email = $1)`, [testEmail]);
    await pool.query(`DELETE FROM stock_movements WHERE moved_by IN (SELECT id FROM users WHERE email = $1)`, [testEmail]);
    await pool.query(`DELETE FROM stock_movements WHERE item_id IN (SELECT id FROM items WHERE sku = $1)`, [testSku]);
    await pool.query(`DELETE FROM equipment WHERE asset_code = $1`, [testAssetCode]);
    await pool.query(`DELETE FROM items WHERE sku = $1`, [testSku]);
    await pool.query(`DELETE FROM rentals WHERE customer_id IN (SELECT id FROM parties WHERE name = $1)`, [testCustomerName]);
    await pool.query(`DELETE FROM locations WHERE name IN ('Fictional Yard Alpha', 'Fictional Site Beta')`);
    await pool.query(`DELETE FROM parties WHERE name = $1`, [testCustomerName]);
    await pool.query(`DELETE FROM users WHERE email = $1`, [testEmail]);
  }

  beforeAll(async () => {
    // Clean up any stale test records from previous runs
    await cleanupTestData();

    // Create test user
    const userRes = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Schema Tester', $1, 'dummy_hash', 'admin')
       RETURNING id`,
      [testEmail]
    );
    adminUserId = userRes.rows[0].id;

    // Create test equipment type and model
    const typeRes = await pool.query(
      `INSERT INTO equipment_types (name, capacity_unit)
       VALUES ('Test Hydraulic Crane', 'ton')
       ON CONFLICT (name) DO UPDATE SET capacity_unit = EXCLUDED.capacity_unit
       RETURNING id`
    );
    testTypeId = typeRes.rows[0].id;

    const modelRes = await pool.query(
      `INSERT INTO equipment_models (type_id, make, model, capacity_value)
       VALUES ($1, 'Tadano', 'GR-500EX-TEST', 50.00)
       ON CONFLICT (type_id, make, model, capacity_value) DO UPDATE SET capacity_value = EXCLUDED.capacity_value
       RETURNING id`,
      [testTypeId]
    );
    testModelId = modelRes.rows[0].id;

    // Create test customer party with fictional name and mock VAT
    const partyRes = await pool.query(
      `INSERT INTO parties (name, vat_no, is_customer)
       VALUES ($1, '900000000000001', true)
       RETURNING id`,
      [testCustomerName]
    );
    testCustomerId = partyRes.rows[0].id;

    // Create locations
    const yardRes = await pool.query(
      `INSERT INTO locations (name, kind)
       VALUES ('Fictional Yard Alpha', 'yard')
       ON CONFLICT (name) DO UPDATE SET kind = EXCLUDED.kind
       RETURNING id`
    );
    testLocationYardId = yardRes.rows[0].id;

    const siteRes = await pool.query(
      `INSERT INTO locations (name, kind, party_id)
       VALUES ('Fictional Site Beta', 'client_site', $1)
       ON CONFLICT (name) DO UPDATE SET party_id = EXCLUDED.party_id
       RETURNING id`,
      [testCustomerId]
    );
    testLocationSiteId = siteRes.rows[0].id;

    // Create equipment item
    const equipRes = await pool.query(
      `INSERT INTO equipment (asset_code, model_id, serial_no, condition)
       VALUES ($1, $2, 'SN-TAD-99881', 'good')
       RETURNING id`,
      [testAssetCode, testModelId]
    );
    testEquipmentId = equipRes.rows[0].id;

    // Log initial location to yard
    await pool.query(
      `INSERT INTO location_log (equipment_id, location_id, moved_by, note)
       VALUES ($1, $2, $3, 'Initial yard reception')`,
      [testEquipmentId, testLocationYardId, adminUserId]
    );

    // Create unit, category, and item for stock testing
    const catRes = await pool.query(
      `INSERT INTO item_categories (name)
       VALUES ('Test Electrical Supplies')
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const unitRes = await pool.query(
      `INSERT INTO units (code, name)
       VALUES ('tmtr', 'Test Meter')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );

    const itemRes = await pool.query(
      `INSERT INTO items (sku, name, category_id, unit_id, reorder_level)
       VALUES ($1, 'Test Heavy Duty Flexible Conduit', $2, $3, 50.000)
       RETURNING id`,
      [testSku, catRes.rows[0].id, unitRes.rows[0].id]
    );
    testItemId = itemRes.rows[0].id;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('v_equipment_current correctly derives initial status as "available" at the Yard', async () => {
    const res = await pool.query(
      `SELECT * FROM v_equipment_current WHERE id = $1`,
      [testEquipmentId]
    );

    expect(res.rows.length).toBe(1);
    const item = res.rows[0];
    expect(item.asset_code).toBe(testAssetCode);
    expect(item.status).toBe('available');
    expect(item.current_location_name).toBe('Fictional Yard Alpha');
    expect(item.capacity_value).toBe('50.00');
    expect(item.capacity_unit).toBe('ton');
  });

  it('quotation status does NOT mark equipment as rented', async () => {
    // Create rental in 'quotation' status
    const quoteRes = await pool.query(
      `INSERT INTO rentals (customer_id, site_id, status, start_date, expected_end)
       VALUES ($1, $2, 'quotation', '2026-11-01', '2026-11-15')
       RETURNING id`,
      [testCustomerId, testLocationSiteId]
    );
    const quoteRentalId = quoteRes.rows[0].id;

    await pool.query(
      `INSERT INTO rental_items (rental_id, equipment_id, applied_rate, rate_unit)
       VALUES ($1, $2, 1200.00, 'daily')`,
      [quoteRentalId, testEquipmentId]
    );

    // v_equipment_current must still derive 'available' because quotation is not confirmed or picked_up
    const viewRes = await pool.query(
      `SELECT status FROM v_equipment_current WHERE id = $1`,
      [testEquipmentId]
    );
    expect(viewRes.rows[0].status).toBe('available');

    // Clean up quotation
    await pool.query(`DELETE FROM rental_items WHERE rental_id = $1`, [quoteRentalId]);
    await pool.query(`DELETE FROM rentals WHERE id = $1`, [quoteRentalId]);
  });

  it('enforces partial unique index and derives status as rented when confirmed, and cancelling frees items', async () => {
    // 1. Create first confirmed rental
    const rental1Res = await pool.query(
      `INSERT INTO rentals (customer_id, site_id, status, start_date, expected_end)
       VALUES ($1, $2, 'confirmed', '2026-11-01', '2026-11-15')
       RETURNING id`,
      [testCustomerId, testLocationSiteId]
    );
    const rental1Id = rental1Res.rows[0].id;

    // Attach equipment to confirmed rental
    await pool.query(
      `INSERT INTO rental_items (rental_id, equipment_id, applied_rate, rate_unit)
       VALUES ($1, $2, 1200.00, 'daily')`,
      [rental1Id, testEquipmentId]
    );

    // Verify v_equipment_current dynamically reflects 'rented' status
    const currentViewRes = await pool.query(
      `SELECT status, current_rental_id, current_customer_name FROM v_equipment_current WHERE id = $1`,
      [testEquipmentId]
    );
    expect(currentViewRes.rows[0].status).toBe('rented');
    expect(currentViewRes.rows[0].current_customer_name).toBe(testCustomerName);

    // 2. Create second confirmed rental - attempting to attach same equipment while active must FAIL
    const rental2Res = await pool.query(
      `INSERT INTO rentals (customer_id, site_id, status, start_date, expected_end)
       VALUES ($1, $2, 'confirmed', '2026-11-05', '2026-11-20')
       RETURNING id`,
      [testCustomerId, testLocationSiteId]
    );
    const rental2Id = rental2Res.rows[0].id;

    await expect(
      pool.query(
        `INSERT INTO rental_items (rental_id, equipment_id, applied_rate, rate_unit)
         VALUES ($1, $2, 1100.00, 'daily')`,
        [rental2Id, testEquipmentId]
      )
    ).rejects.toThrow(/uq_active_rental_item/);

    // 3. Cancelling rental 1 automatically triggers freeing items (sets returned_at)
    await pool.query(`UPDATE rentals SET status = 'cancelled' WHERE id = $1`, [rental1Id]);

    // Check that returned_at was set on rental_items by the trigger
    const itemCheckRes = await pool.query(
      `SELECT returned_at FROM rental_items WHERE rental_id = $1 AND equipment_id = $2`,
      [rental1Id, testEquipmentId]
    );
    expect(itemCheckRes.rows[0].returned_at).not.toBeNull();

    // Verify view now derives status as 'available'
    const cancelledViewRes = await pool.query(
      `SELECT status FROM v_equipment_current WHERE id = $1`,
      [testEquipmentId]
    );
    expect(cancelledViewRes.rows[0].status).toBe('available');

    // 4. Now rental 2 can successfully attach the equipment
    const assignRes = await pool.query(
      `INSERT INTO rental_items (rental_id, equipment_id, applied_rate, rate_unit)
       VALUES ($1, $2, 1100.00, 'daily')
       RETURNING *`,
      [rental2Id, testEquipmentId]
    );
    expect(assignRes.rows.length).toBe(1);

    // Clean up rental 2
    await pool.query(`UPDATE rentals SET status = 'cancelled' WHERE id = $1`, [rental2Id]);
  });

  it('enforces partial unique index on maintenance: only one active maintenance at a time', async () => {
    // Open maintenance 1
    const maint1Res = await pool.query(
      `INSERT INTO maintenance (equipment_id, kind, description, reported_by)
       VALUES ($1, 'repair', 'Hydraulic hose replacement', $2)
       RETURNING id`,
      [testEquipmentId, adminUserId]
    );
    const maint1Id = maint1Res.rows[0].id;

    // Check view reflects 'under_repair'
    const viewRes = await pool.query(
      `SELECT status, current_maintenance_desc FROM v_equipment_current WHERE id = $1`,
      [testEquipmentId]
    );
    expect(viewRes.rows[0].status).toBe('under_repair');
    expect(viewRes.rows[0].current_maintenance_desc).toBe('Hydraulic hose replacement');

    // Attempting to open a second maintenance without closing the first must FAIL
    await expect(
      pool.query(
        `INSERT INTO maintenance (equipment_id, kind, description, reported_by)
         VALUES ($1, 'modification', 'Boom reinforcement', $2)`,
        [testEquipmentId, adminUserId]
      )
    ).rejects.toThrow(/uq_open_maintenance/);

    // Close maintenance 1
    await pool.query(
      `UPDATE maintenance SET closed_at = NOW(), cost = 850.00 WHERE id = $1`,
      [maint1Id]
    );

    // Status returns to 'available'
    const restoredViewRes = await pool.query(
      `SELECT status FROM v_equipment_current WHERE id = $1`,
      [testEquipmentId]
    );
    expect(restoredViewRes.rows[0].status).toBe('available');
  });

  it('stock ledger trigger prevents negative stock on hand', async () => {
    // 1. Receive 100 meters
    await pool.query(
      `INSERT INTO stock_movements (item_id, qty, type, unit_cost, moved_by)
       VALUES ($1, 100.000, 'receipt', 14.50, $2)`,
      [testItemId, adminUserId]
    );

    // Check sum of stock
    const stockRes1 = await pool.query(
      `SELECT SUM(qty) AS total_stock FROM stock_movements WHERE item_id = $1`,
      [testItemId]
    );
    expect(Number(stockRes1.rows[0].total_stock)).toBe(100);

    // 2. Issue 30 meters (valid)
    await pool.query(
      `INSERT INTO stock_movements (item_id, qty, type, unit_cost, moved_by)
       VALUES ($1, -30.000, 'issue', 14.50, $2)`,
      [testItemId, adminUserId]
    );

    const stockRes2 = await pool.query(
      `SELECT SUM(qty) AS total_stock FROM stock_movements WHERE item_id = $1`,
      [testItemId]
    );
    expect(Number(stockRes2.rows[0].total_stock)).toBe(70);

    // 3. Attempt to issue 80 meters (which would drive stock to -10) -> MUST FAIL by trigger!
    await expect(
      pool.query(
        `INSERT INTO stock_movements (item_id, qty, type, unit_cost, moved_by)
         VALUES ($1, -80.000, 'issue', 14.50, $2)`,
        [testItemId, adminUserId]
      )
    ).rejects.toThrow(/Cannot issue 80(\.000)? units of item/);
  });
});
