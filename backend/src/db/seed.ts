import bcrypt from 'bcrypt';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * SPACE EXSPACE Database Seeder
 * WHY IDEMPOTENT: In development, continuous integration, and demo resets,
 * developers and client presenters must be able to rerun the seed script repeatedly
 * without constraint errors, duplicate primary keys, or dirty data states.
 */
export async function seedDatabase() {
  const isProduction = env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';
  const allowDemoSeed = env.ALLOW_DEMO_SEED === 'true' || process.env.ALLOW_DEMO_SEED === 'true';

  // Production safety guard: Seeding refuses NODE_ENV=production unless ALLOW_DEMO_SEED=true is set
  if (isProduction && !allowDemoSeed) {
    logger.error('❌ Seeding is refused in production environment! Set ALLOW_DEMO_SEED=true to seed demo data in production.');
    throw new Error('Database seeding is strictly disabled in production mode (NODE_ENV=production) unless ALLOW_DEMO_SEED=true is set.');
  }

  const client = await pool.connect();

  try {
    logger.info('🌱 Starting idempotent database seed...');
    await client.query('BEGIN');

    // =========================================================================
    // 1. USERS & ROLES
    // Passwords come from environment variables in production, never hardcoded
    // =========================================================================
    const adminPassword = process.env.DEMO_ADMIN_PASSWORD || env.DEMO_ADMIN_PASSWORD || 'Admin#2026!Dev';
    const staffPassword = process.env.DEMO_STAFF_PASSWORD || env.DEMO_STAFF_PASSWORD || 'Staff#2026!Dev';

    const saltRounds = 10;
    const adminHash = await bcrypt.hash(adminPassword, saltRounds);
    const staffHash = await bcrypt.hash(staffPassword, saltRounds);

    const userAdminRes = await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Abdullah Al-Dosari (Operations Director)', 'admin@spaceexspace.com', $1, 'admin')
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role
       RETURNING id`,
      [adminHash]
    );
    const adminId = userAdminRes.rows[0].id;

    const userStaffRes = await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Tariq Mansour (Yard Lead)', 'staff@spaceexspace.com', $1, 'staff')
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role
       RETURNING id`,
      [staffHash]
    );
    const staffId = userStaffRes.rows[0].id;

    // =========================================================================
    // 2. EQUIPMENT TYPES
    // =========================================================================
    const typesData = [
      { name: 'Hydraulic Mobile Crane', unit: 'ton' },
      { name: 'Rough Terrain Crane', unit: 'ton' },
      { name: 'Diesel Generator', unit: 'kVA' },
      { name: 'Heavy Storage Container', unit: 'ft' },
      { name: 'Portable Site Office', unit: 'person' },
      { name: 'Portable Ablution Unit', unit: 'person' },
      { name: 'Industrial High-Pressure Cleaner', unit: 'bar' },
    ];

    const typeIdMap = new Map<string, number>();
    for (const t of typesData) {
      const res = await client.query(
        `INSERT INTO equipment_types (name, capacity_unit)
         VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET capacity_unit = EXCLUDED.capacity_unit
         RETURNING id`,
        [t.name, t.unit]
      );
      typeIdMap.set(t.name, res.rows[0].id);
    }

    // =========================================================================
    // 3. EQUIPMENT MODELS
    // =========================================================================
    const modelsData = [
      { type: 'Hydraulic Mobile Crane', make: 'Tadano', model: 'GR-500EX', capacity: 50.00 },
      { type: 'Hydraulic Mobile Crane', make: 'Kato', model: 'CR-350Ri', capacity: 35.00 },
      { type: 'Rough Terrain Crane', make: 'Grove', model: 'RT770E', capacity: 70.00 },
      { type: 'Rough Terrain Crane', make: 'Liebherr', model: 'LTM 1100', capacity: 100.00 },
      { type: 'Diesel Generator', make: 'Cummins', model: 'C250 D5', capacity: 250.00 },
      { type: 'Diesel Generator', make: 'Caterpillar', model: 'DE500 GC', capacity: 500.00 },
      { type: 'Heavy Storage Container', make: 'CIMC', model: 'Dry Van 20ft', capacity: 20.00 },
      { type: 'Heavy Storage Container', make: 'CIMC', model: 'High Cube 40ft', capacity: 40.00 },
      { type: 'Portable Site Office', make: 'Space Modular', model: 'Executive Office 40x10', capacity: 8.00 },
      { type: 'Portable Site Office', make: 'Space Modular', model: 'Meeting Unit 20x10', capacity: 12.00 },
      { type: 'Portable Ablution Unit', make: 'Sanitech', model: 'Ablution 4-Bay', capacity: 4.00 },
      { type: 'Industrial High-Pressure Cleaner', make: 'Kärcher', model: 'HDS 13/20-4 S', capacity: 500.00 },
    ];

    const modelIdMap = new Map<string, number>();
    for (const m of modelsData) {
      const typeId = typeIdMap.get(m.type)!;
      const key = `${m.make}-${m.model}`;
      const res = await client.query(
        `INSERT INTO equipment_models (type_id, make, model, capacity_value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (type_id, make, model, capacity_value) DO UPDATE SET capacity_value = EXCLUDED.capacity_value
         RETURNING id`,
        [typeId, m.make, m.model, m.capacity]
      );
      modelIdMap.set(key, res.rows[0].id);
    }

    // =========================================================================
    // 4. STANDARD RATE CARDS (SAR, vertical 1NF structure)
    // =========================================================================
    const rateCards = [
      // Tadano 50T
      { modelKey: 'Tadano-GR-500EX', unit: 'hourly', amount: 350.00 },
      { modelKey: 'Tadano-GR-500EX', unit: 'daily', amount: 2200.00 },
      { modelKey: 'Tadano-GR-500EX', unit: 'weekly', amount: 11000.00 },
      { modelKey: 'Tadano-GR-500EX', unit: 'monthly', amount: 38000.00 },
      // Kato 35T
      { modelKey: 'Kato-CR-350Ri', unit: 'daily', amount: 1600.00 },
      { modelKey: 'Kato-CR-350Ri', unit: 'monthly', amount: 29000.00 },
      // Grove 70T
      { modelKey: 'Grove-RT770E', unit: 'daily', amount: 3000.00 },
      { modelKey: 'Grove-RT770E', unit: 'monthly', amount: 52000.00 },
      // Liebherr 100T
      { modelKey: 'Liebherr-LTM 1100', unit: 'daily', amount: 5500.00 },
      { modelKey: 'Liebherr-LTM 1100', unit: 'monthly', amount: 95000.00 },
      // Cummins 250 kVA
      { modelKey: 'Cummins-C250 D5', unit: 'daily', amount: 450.00 },
      { modelKey: 'Cummins-C250 D5', unit: 'monthly', amount: 7800.00 },
      // CAT 500 kVA
      { modelKey: 'Caterpillar-DE500 GC', unit: 'daily', amount: 850.00 },
      { modelKey: 'Caterpillar-DE500 GC', unit: 'monthly', amount: 14500.00 },
      // 20ft Container
      { modelKey: 'CIMC-Dry Van 20ft', unit: 'monthly', amount: 1200.00 },
      // 40ft Container
      { modelKey: 'CIMC-High Cube 40ft', unit: 'monthly', amount: 2200.00 },
      // Site Office 40x10
      { modelKey: 'Space Modular-Executive Office 40x10', unit: 'monthly', amount: 4500.00 },
      // Ablution 4-Bay
      { modelKey: 'Sanitech-Ablution 4-Bay', unit: 'monthly', amount: 2800.00 },
      // Industrial Washer
      { modelKey: 'Kärcher-HDS 13/20-4 S', unit: 'daily', amount: 400.00 },
      { modelKey: 'Kärcher-HDS 13/20-4 S', unit: 'monthly', amount: 6500.00 },
    ];

    for (const r of rateCards) {
      const modelId = modelIdMap.get(r.modelKey)!;
      await client.query(
        `INSERT INTO rates (model_id, unit, amount, vat_included, valid_from)
         VALUES ($1, $2, $3, false, '2026-01-01 00:00:00+03')
         ON CONFLICT (model_id, unit, valid_from) DO UPDATE SET amount = EXCLUDED.amount`,
        [modelId, r.unit, r.amount]
      );
    }

    // =========================================================================
    // 5. PARTIES (3 FICTIONAL SUPPLIERS + 3 FICTIONAL CUSTOMERS)
    // Obvious mock names and fake tax numbers (no real company names used)
    // =========================================================================
    const partiesData = [
      // Fictional Suppliers
      {
        name: 'Gulf Heavy Metals Trading',
        contact: 'Tariq Al-Harbi',
        phone: '+966 13 800 0001',
        email: 'sales@gulf-heavymetals-fictional.sa',
        vat: '100000000000001',
        address: 'Jubail Support Industrial Zone, Sector 4',
        is_customer: false,
        is_supplier: true,
      },
      {
        name: 'Red Sea Industrial Hardware',
        contact: 'Majid Al-Ghamdi',
        phone: '+966 13 800 0002',
        email: 'orders@redsea-hardware-fictional.sa',
        vat: '100000000000002',
        address: 'Dammam Industrial Area Phase 1',
        is_customer: false,
        is_supplier: true,
      },
      {
        name: 'Eastern Coatings & Primers Co.',
        contact: 'Ziyad Al-Dossary',
        phone: '+966 13 800 0003',
        email: 'supply@eastern-coatings-fictional.sa',
        vat: '100000000000003',
        address: 'Khobar Light Industrial Park',
        is_customer: false,
        is_supplier: true,
      },
      // Fictional Customers
      {
        name: 'Apex Infrastructure Partners',
        contact: 'Eng. Omar Al-Fahad',
        phone: '+966 13 800 0004',
        email: 'projects@apex-partners-fictional.sa',
        vat: '200000000000001',
        address: 'Al-Khobar Commercial District',
        is_customer: true,
        is_supplier: false,
      },
      {
        name: 'Gulf Petrochemical Services Ltd',
        contact: 'Saad Al-Qarni',
        phone: '+966 13 800 0005',
        email: 'site.ops@gulf-petro-fictional.sa',
        vat: '200000000000002',
        address: 'Ras Tanura Coastal Industrial Area',
        is_customer: true,
        is_supplier: false,
      },
      {
        name: 'Al-Noor Commercial Contracting',
        contact: 'Hassan Al-Shehri',
        phone: '+966 13 800 0006',
        email: 'procurement@alnoor-contracting-fictional.sa',
        vat: '200000000000003',
        address: 'Dammam Coastal Road',
        is_customer: true,
        is_supplier: false,
      },
    ];

    const partyIdMap = new Map<string, number>();
    for (const p of partiesData) {
      let partyId: number;
      const existing = await client.query(`SELECT id FROM parties WHERE name = $1`, [p.name]);
      if (existing.rows.length > 0) {
        partyId = existing.rows[0].id;
        await client.query(
          `UPDATE parties SET
             contact_person = $2, phone = $3, email = $4,
             vat_no = $5, address = $6, is_customer = $7, is_supplier = $8
           WHERE id = $1`,
          [partyId, p.contact, p.phone, p.email, p.vat, p.address, p.is_customer, p.is_supplier]
        );
      } else {
        const res = await client.query(
          `INSERT INTO parties (name, contact_person, phone, email, vat_no, address, is_customer, is_supplier)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [p.name, p.contact, p.phone, p.email, p.vat, p.address, p.is_customer, p.is_supplier]
        );
        partyId = res.rows[0].id;
      }
      partyIdMap.set(p.name, partyId);
    }

    // =========================================================================
    // 6. LOCATIONS (YARDS, SITES, WORKSHOP)
    // =========================================================================
    const locationsData = [
      { name: 'SPACE Central Dammam Yard', kind: 'yard', partyName: null },
      { name: 'Jubail Storage Yard', kind: 'yard', partyName: null },
      { name: 'Dammam Heavy Fleet Workshop', kind: 'workshop', partyName: null },
      { name: 'Fleet Transit (Eastern Province)', kind: 'transit', partyName: null },
      { name: 'Ras Tanura Project Site', kind: 'client_site', partyName: 'Gulf Petrochemical Services Ltd' },
      { name: 'King Salman Port Terminal Site', kind: 'client_site', partyName: 'Apex Infrastructure Partners' },
      { name: 'Al-Khobar Commercial Tower Site', kind: 'client_site', partyName: 'Al-Noor Commercial Contracting' },
    ];

    const locationIdMap = new Map<string, number>();
    for (const l of locationsData) {
      const partyId = l.partyName ? partyIdMap.get(l.partyName) : null;
      const res = await client.query(
        `INSERT INTO locations (name, kind, party_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET kind = EXCLUDED.kind, party_id = EXCLUDED.party_id
         RETURNING id`,
        [l.name, l.kind, partyId]
      );
      locationIdMap.set(l.name, res.rows[0].id);
    }

    // =========================================================================
    // 7. REALISTIC EQUIPMENT ITEMS (~41 ITEMS ACROSS ALL CATEGORIES)
    // =========================================================================
    const equipmentItems: Array<{
      code: string;
      modelKey: string;
      serial: string;
      cond: 'good' | 'fair' | 'needs_repair';
      location: string;
    }> = [
      // 1-5: Tadano 50T Cranes
      { code: 'CRN-50-001', modelKey: 'Tadano-GR-500EX', serial: 'TAD-50-8812', cond: 'good', location: 'King Salman Port Terminal Site' },
      { code: 'CRN-50-002', modelKey: 'Tadano-GR-500EX', serial: 'TAD-50-8813', cond: 'good', location: 'King Salman Port Terminal Site' },
      { code: 'CRN-50-003', modelKey: 'Tadano-GR-500EX', serial: 'TAD-50-8901', cond: 'fair', location: 'SPACE Central Dammam Yard' },
      { code: 'CRN-50-004', modelKey: 'Tadano-GR-500EX', serial: 'TAD-50-8944', cond: 'needs_repair', location: 'Dammam Heavy Fleet Workshop' },
      { code: 'CRN-50-005', modelKey: 'Tadano-GR-500EX', serial: 'TAD-50-9011', cond: 'good', location: 'Jubail Storage Yard' },

      // 6-8: Kato 35T Cranes
      { code: 'CRN-35-001', modelKey: 'Kato-CR-350Ri', serial: 'KTO-35-1044', cond: 'good', location: 'SPACE Central Dammam Yard' },
      { code: 'CRN-35-002', modelKey: 'Kato-CR-350Ri', serial: 'KTO-35-1090', cond: 'fair', location: 'Al-Khobar Commercial Tower Site' },
      { code: 'CRN-35-003', modelKey: 'Kato-CR-350Ri', serial: 'KTO-35-1122', cond: 'good', location: 'SPACE Central Dammam Yard' },

      // 9-11: Grove 70T Cranes
      { code: 'CRN-70-001', modelKey: 'Grove-RT770E', serial: 'GRV-70-3341', cond: 'good', location: 'Ras Tanura Project Site' },
      { code: 'CRN-70-002', modelKey: 'Grove-RT770E', serial: 'GRV-70-3389', cond: 'good', location: 'SPACE Central Dammam Yard' },
      { code: 'CRN-70-003', modelKey: 'Grove-RT770E', serial: 'GRV-70-3410', cond: 'needs_repair', location: 'Dammam Heavy Fleet Workshop' },

      // 12-13: Liebherr 100T Cranes
      { code: 'CRN-100-001', modelKey: 'Liebherr-LTM 1100', serial: 'LBH-100-771', cond: 'good', location: 'SPACE Central Dammam Yard' },
      { code: 'CRN-100-002', modelKey: 'Liebherr-LTM 1100', serial: 'LBH-100-779', cond: 'good', location: 'Jubail Storage Yard' },

      // 14-19: Cummins 250 kVA Generators
      { code: 'GEN-250-001', modelKey: 'Cummins-C250 D5', serial: 'CUM-250-401', cond: 'good', location: 'King Salman Port Terminal Site' },
      { code: 'GEN-250-002', modelKey: 'Cummins-C250 D5', serial: 'CUM-250-402', cond: 'good', location: 'SPACE Central Dammam Yard' },
      { code: 'GEN-250-003', modelKey: 'Cummins-C250 D5', serial: 'CUM-250-403', cond: 'good', location: 'Jubail Storage Yard' },
      { code: 'GEN-250-004', modelKey: 'Cummins-C250 D5', serial: 'CUM-250-404', cond: 'fair', location: 'SPACE Central Dammam Yard' },
      { code: 'GEN-250-005', modelKey: 'Cummins-C250 D5', serial: 'CUM-250-405', cond: 'needs_repair', location: 'Dammam Heavy Fleet Workshop' },
      { code: 'GEN-250-006', modelKey: 'Cummins-C250 D5', serial: 'CUM-250-406', cond: 'good', location: 'SPACE Central Dammam Yard' },

      // 20-23: CAT 500 kVA Generators
      { code: 'GEN-500-001', modelKey: 'Caterpillar-DE500 GC', serial: 'CAT-500-112', cond: 'good', location: 'Ras Tanura Project Site' },
      { code: 'GEN-500-002', modelKey: 'Caterpillar-DE500 GC', serial: 'CAT-500-115', cond: 'good', location: 'SPACE Central Dammam Yard' },
      { code: 'GEN-500-003', modelKey: 'Caterpillar-DE500 GC', serial: 'CAT-500-119', cond: 'good', location: 'Jubail Storage Yard' },
      { code: 'GEN-500-004', modelKey: 'Caterpillar-DE500 GC', serial: 'CAT-500-124', cond: 'fair', location: 'SPACE Central Dammam Yard' },

      // 24-29: 20ft Storage Containers
      { code: 'CNT-20-001', modelKey: 'CIMC-Dry Van 20ft', serial: 'CIMC-20-9901', cond: 'good', location: 'SPACE Central Dammam Yard' },
      { code: 'CNT-20-002', modelKey: 'CIMC-Dry Van 20ft', serial: 'CIMC-20-9902', cond: 'good', location: 'Ras Tanura Project Site' },
      { code: 'CNT-20-003', modelKey: 'CIMC-Dry Van 20ft', serial: 'CIMC-20-9903', cond: 'good', location: 'Jubail Storage Yard' },
      { code: 'CNT-20-004', modelKey: 'CIMC-Dry Van 20ft', serial: 'CIMC-20-9904', cond: 'fair', location: 'SPACE Central Dammam Yard' },
      { code: 'CNT-20-005', modelKey: 'CIMC-Dry Van 20ft', serial: 'CIMC-20-9905', cond: 'good', location: 'King Salman Port Terminal Site' },
      { code: 'CNT-20-006', modelKey: 'CIMC-Dry Van 20ft', serial: 'CIMC-20-9906', cond: 'good', location: 'SPACE Central Dammam Yard' },

      // 30-33: 40ft High Cube Containers
      { code: 'CNT-40-001', modelKey: 'CIMC-High Cube 40ft', serial: 'CIMC-40-8801', cond: 'good', location: 'SPACE Central Dammam Yard' },
      { code: 'CNT-40-002', modelKey: 'CIMC-High Cube 40ft', serial: 'CIMC-40-8802', cond: 'good', location: 'King Salman Port Terminal Site' },
      { code: 'CNT-40-003', modelKey: 'CIMC-High Cube 40ft', serial: 'CIMC-40-8803', cond: 'good', location: 'Al-Khobar Commercial Tower Site' },
      { code: 'CNT-40-004', modelKey: 'CIMC-High Cube 40ft', serial: 'CIMC-40-8804', cond: 'fair', location: 'Jubail Storage Yard' },

      // 34-37: Portable Site Offices & Meeting Units
      { code: 'OFF-40-001', modelKey: 'Space Modular-Executive Office 40x10', serial: 'SM-OFF-401', cond: 'good', location: 'King Salman Port Terminal Site' },
      { code: 'OFF-40-002', modelKey: 'Space Modular-Executive Office 40x10', serial: 'SM-OFF-402', cond: 'good', location: 'SPACE Central Dammam Yard' },
      { code: 'OFF-20-001', modelKey: 'Space Modular-Meeting Unit 20x10', serial: 'SM-MTG-201', cond: 'good', location: 'Ras Tanura Project Site' },
      { code: 'OFF-20-002', modelKey: 'Space Modular-Meeting Unit 20x10', serial: 'SM-MTG-202', cond: 'good', location: 'SPACE Central Dammam Yard' },

      // 38-39: Ablution Units
      { code: 'WSH-04-001', modelKey: 'Sanitech-Ablution 4-Bay', serial: 'SAN-WSH-01', cond: 'good', location: 'King Salman Port Terminal Site' },
      { code: 'WSH-04-002', modelKey: 'Sanitech-Ablution 4-Bay', serial: 'SAN-WSH-02', cond: 'good', location: 'SPACE Central Dammam Yard' },

      // 40-41: Industrial Cleaning Machinery
      { code: 'CLN-500-001', modelKey: 'Kärcher-HDS 13/20-4 S', serial: 'KRC-500-71', cond: 'good', location: 'SPACE Central Dammam Yard' },
      { code: 'CLN-500-002', modelKey: 'Kärcher-HDS 13/20-4 S', serial: 'KRC-500-72', cond: 'good', location: 'Jubail Storage Yard' },
    ];

    const equipIdMap = new Map<string, number>();
    for (const eq of equipmentItems) {
      const modelId = modelIdMap.get(eq.modelKey)!;
      const res = await client.query(
        `INSERT INTO equipment (asset_code, model_id, serial_no, condition)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (asset_code) DO UPDATE SET
           condition = EXCLUDED.condition,
           serial_no = EXCLUDED.serial_no
         RETURNING id`,
        [eq.code, modelId, eq.serial, eq.cond]
      );
      const equipmentId = res.rows[0].id;
      equipIdMap.set(eq.code, equipmentId);

      // Log initial location into append-only location_log if not already logged
      const locId = locationIdMap.get(eq.location)!;
      const existingLog = await client.query(
        `SELECT id FROM location_log WHERE equipment_id = $1 LIMIT 1`,
        [equipmentId]
      );
      if (existingLog.rows.length === 0) {
        await client.query(
          `INSERT INTO location_log (equipment_id, location_id, moved_by, moved_at, note)
           VALUES ($1, $2, $3, '2026-02-01 08:00:00+03', 'Initial fleet deployment')`,
          [equipmentId, locId, adminId]
        );
      }
    }

    // =========================================================================
    // 8. RENTALS & RENTAL ITEMS
    // Total 3 rentals:
    // - Rental 1 (picked_up): 5 items (CRN-50-001, CRN-50-002, GEN-250-001, OFF-40-001, WSH-04-001)
    // - Rental 2 (returned): 1 item (CRN-35-001, returned)
    // - Rental 3 (picked_up): 2 items (CRN-35-002, CNT-40-003)
    // Result: exactly 2 active rentals containing 5 and 2 items respectively (total 7 items currently rented)
    // =========================================================================
    // Rental 1: Active rental with Apex Infrastructure Partners at King Salman Port Terminal
    const apexId = partyIdMap.get('Apex Infrastructure Partners')!;
    const portSiteId = locationIdMap.get('King Salman Port Terminal Site')!;

    let rental1Id: number;
    const r1Check = await client.query(
      `SELECT id FROM rentals WHERE customer_id = $1 AND site_id = $2 AND start_date = '2026-09-01'`,
      [apexId, portSiteId]
    );
    if (r1Check.rows.length > 0) {
      rental1Id = r1Check.rows[0].id;
    } else {
      const r1Res = await client.query(
        `INSERT INTO rentals (customer_id, site_id, status, start_date, expected_end)
         VALUES ($1, $2, 'picked_up', '2026-09-01', '2026-12-31')
         RETURNING id`,
        [apexId, portSiteId]
      );
      rental1Id = r1Res.rows[0].id;
    }

    const activeRentalItems1 = [
      { code: 'CRN-50-001', rate: 35000.00, unit: 'monthly', note: 'Contract volume discount applied' },
      { code: 'CRN-50-002', rate: 35000.00, unit: 'monthly', note: 'Contract volume discount applied' },
      { code: 'GEN-250-001', rate: 7000.00, unit: 'monthly', note: null },
      { code: 'OFF-40-001', rate: 4200.00, unit: 'monthly', note: null },
      { code: 'WSH-04-001', rate: 2500.00, unit: 'monthly', note: null },
    ];

    for (const item of activeRentalItems1) {
      const eqId = equipIdMap.get(item.code)!;
      const riCheck = await client.query(
        `SELECT rental_id FROM rental_items WHERE rental_id = $1 AND equipment_id = $2`,
        [rental1Id, eqId]
      );
      if (riCheck.rows.length > 0) {
        await client.query(
          `UPDATE rental_items SET applied_rate = $3, rate_unit = $4, discount_note = $5, returned_at = NULL
           WHERE rental_id = $1 AND equipment_id = $2`,
          [rental1Id, eqId, item.rate, item.unit, item.note]
        );
      } else {
        await client.query(
          `INSERT INTO rental_items (rental_id, equipment_id, applied_rate, rate_unit, discount_note, returned_at)
           VALUES ($1, $2, $3, $4, $5, NULL)`,
          [rental1Id, eqId, item.rate, item.unit, item.note]
        );
      }
    }

    // Rental 2: Historical / Returned rental with Gulf Petrochemical Services at Ras Tanura Site
    // Equipment: CRN-35-001 (was rented for 1 month, now returned)
    const gulfPetroId = partyIdMap.get('Gulf Petrochemical Services Ltd')!;
    const rasTanuraSiteId = locationIdMap.get('Ras Tanura Project Site')!;

    let rental2Id: number;
    const r2Check = await client.query(
      `SELECT id FROM rentals WHERE customer_id = $1 AND site_id = $2 AND start_date = '2026-08-01'`,
      [gulfPetroId, rasTanuraSiteId]
    );
    if (r2Check.rows.length > 0) {
      rental2Id = r2Check.rows[0].id;
    } else {
      const r2Res = await client.query(
        `INSERT INTO rentals (customer_id, site_id, status, start_date, expected_end)
         VALUES ($1, $2, 'returned', '2026-08-01', '2026-08-31')
         RETURNING id`,
        [gulfPetroId, rasTanuraSiteId]
      );
      rental2Id = r2Res.rows[0].id;
    }

    const returnedEqId = equipIdMap.get('CRN-35-001')!;
    const r2ItemCheck = await client.query(
      `SELECT rental_id FROM rental_items WHERE rental_id = $1 AND equipment_id = $2`,
      [rental2Id, returnedEqId]
    );
    if (r2ItemCheck.rows.length > 0) {
      await client.query(
        `UPDATE rental_items SET returned_at = '2026-08-31 16:00:00+03'
         WHERE rental_id = $1 AND equipment_id = $2`,
        [rental2Id, returnedEqId]
      );
    } else {
      await client.query(
        `INSERT INTO rental_items (rental_id, equipment_id, applied_rate, rate_unit, returned_at)
         VALUES ($1, $2, 28000.00, 'monthly', '2026-08-31 16:00:00+03')`,
        [rental2Id, returnedEqId]
      );
    }

    // Rental 3: Active rental with Al-Noor Commercial Contracting at Al-Khobar Commercial Tower
    // Equipment: CRN-35-002, CNT-40-003
    const alnoorId = partyIdMap.get('Al-Noor Commercial Contracting')!;
    const khobarSiteId = locationIdMap.get('Al-Khobar Commercial Tower Site')!;

    let rental3Id: number;
    const r3Check = await client.query(
      `SELECT id FROM rentals WHERE customer_id = $1 AND site_id = $2 AND start_date = '2026-10-01'`,
      [alnoorId, khobarSiteId]
    );
    if (r3Check.rows.length > 0) {
      rental3Id = r3Check.rows[0].id;
    } else {
      const r3Res = await client.query(
        `INSERT INTO rentals (customer_id, site_id, status, start_date, expected_end)
         VALUES ($1, $2, 'picked_up', '2026-10-01', '2026-11-30')
         RETURNING id`,
        [alnoorId, khobarSiteId]
      );
      rental3Id = r3Res.rows[0].id;
    }

    for (const code of ['CRN-35-002', 'CNT-40-003']) {
      const eqId = equipIdMap.get(code)!;
      const r3ItemCheck = await client.query(
        `SELECT rental_id FROM rental_items WHERE rental_id = $1 AND equipment_id = $2`,
        [rental3Id, eqId]
      );
      if (r3ItemCheck.rows.length > 0) {
        await client.query(
          `UPDATE rental_items SET applied_rate = 1600.00, rate_unit = 'daily', returned_at = NULL
           WHERE rental_id = $1 AND equipment_id = $2`,
          [rental3Id, eqId]
        );
      } else {
        await client.query(
          `INSERT INTO rental_items (rental_id, equipment_id, applied_rate, rate_unit, returned_at)
           VALUES ($1, $2, 1600.00, 'daily', NULL)`,
          [rental3Id, eqId]
        );
      }
    }

    // =========================================================================
    await client.query("DELETE FROM maintenance WHERE closed_at IS NULL AND equipment_id NOT IN ($1, $2)", [equipIdMap.get('CRN-50-004')!, equipIdMap.get('CRN-70-003')!]);
    // 9. MAINTENANCE (REPAIRS: OPEN WORK ORDERS & CLOSED HISTORICAL WORK)
    // =========================================================================
    // Open maintenance order 1: CRN-50-004 (Hydraulic pump overhaul) -> derives status 'under_repair'
    const brokenCraneId = equipIdMap.get('CRN-50-004')!;
    const openMaintCheck1 = await client.query(
      `SELECT id FROM maintenance WHERE equipment_id = $1 AND closed_at IS NULL`,
      [brokenCraneId]
    );
    if (openMaintCheck1.rows.length === 0) {
      await client.query(
        `INSERT INTO maintenance (equipment_id, kind, description, cost, opened_at, reported_by)
         VALUES ($1, 'repair', 'Main hydraulic winch pump seal rupture. Awaiting seal kit from parts supplier.', 0.00, '2026-10-15 09:30:00+03', $2)`,
        [brokenCraneId, staffId]
      );
    }

    // Open maintenance order 2: CRN-70-003 (Outrigger cylinder inspection) -> derives status 'under_repair'
    const brokenGroveId = equipIdMap.get('CRN-70-003')!;
    const openMaintCheck2 = await client.query(
      `SELECT id FROM maintenance WHERE equipment_id = $1 AND closed_at IS NULL`,
      [brokenGroveId]
    );
    if (openMaintCheck2.rows.length === 0) {
      await client.query(
        `INSERT INTO maintenance (equipment_id, kind, description, cost, opened_at, reported_by)
         VALUES ($1, 'repair', 'Left rear outrigger cylinder pressure loss. Seal replacement in progress in Dammam workshop.', 0.00, '2026-10-20 14:15:00+03', $2)`,
        [brokenGroveId, staffId]
      );
    }

    // Closed historical repair: GEN-250-004 (Oil filter and alternator replacement)
    const servicedGenId = equipIdMap.get('GEN-250-004')!;
    const closedMaintCheck = await client.query(
      `SELECT id FROM maintenance WHERE equipment_id = $1 AND closed_at IS NOT NULL LIMIT 1`,
      [servicedGenId]
    );
    if (closedMaintCheck.rows.length === 0) {
      await client.query(
        `INSERT INTO maintenance (equipment_id, kind, description, cost, opened_at, closed_at, reported_by)
         VALUES ($1, 'repair', '500-hour routine engine servicing, lube oil replacement, and fuel filter renewal.', 1450.00, '2026-09-10 08:00:00+03', '2026-09-11 17:00:00+03', $2)`,
        [servicedGenId, staffId]
      );
    }

    // =========================================================================
    // 10. MATERIALS INVENTORY (CATEGORIES, UNITS, ~15 SKUs)
    // =========================================================================
    const categoriesData = [
      'Structural Steel & Plates',
      'Electrical & Wiring',
      'Piping & Flexible Conduits',
      'Industrial Paints & Primers',
      'Welding & Hardware Consumables',
    ];

    const categoryIdMap = new Map<string, number>();
    for (const cat of categoriesData) {
      const res = await client.query(
        `INSERT INTO item_categories (name)
         VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [cat]
      );
      categoryIdMap.set(cat, res.rows[0].id);
    }

    const unitsData = [
      { code: 'pcs', name: 'Pieces' },
      { code: 'mtr', name: 'Meters' },
      { code: 'kg', name: 'Kilograms' },
      { code: 'ltr', name: 'Liters' },
      { code: 'roll', name: 'Rolls' },
      { code: 'sheet', name: 'Sheets' },
    ];

    const unitIdMap = new Map<string, number>();
    for (const u of unitsData) {
      const res = await client.query(
        `INSERT INTO units (code, name)
         VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [u.code, u.name]
      );
      unitIdMap.set(u.code, res.rows[0].id);
    }

    const materialsData = [
      { sku: 'STL-SHT-6MM', name: 'Mild Steel Plate Sheet 6mm x 2.4m x 1.2m', cat: 'Structural Steel & Plates', unit: 'sheet', reorder: 20 },
      { sku: 'STL-SHT-12MM', name: 'High-Tensile Steel Plate 12mm x 2.4m x 1.2m', cat: 'Structural Steel & Plates', unit: 'sheet', reorder: 10 },
      { sku: 'ELEC-WIR-4MM', name: 'Single Core Copper Wire 4mm² (100m roll)', cat: 'Electrical & Wiring', unit: 'roll', reorder: 15 },
      { sku: 'ELEC-WIR-10MM', name: 'Multi-Core Industrial Armoured Cable 10mm²', cat: 'Electrical & Wiring', unit: 'mtr', reorder: 100 },
      { sku: 'ELEC-CON-25MM', name: 'Galvanized Flexible Steel Conduit 25mm', cat: 'Piping & Flexible Conduits', unit: 'mtr', reorder: 150 },
      { sku: 'ELEC-CON-38MM', name: 'Heavy Duty PVC Electrical Conduit 38mm', cat: 'Piping & Flexible Conduits', unit: 'mtr', reorder: 80 },
      { sku: 'PNT-PRM-EPX', name: 'Epoxy Zinc Rich Primer Grey (20L Drum)', cat: 'Industrial Paints & Primers', unit: 'ltr', reorder: 100 },
      { sku: 'PNT-TOP-YEL', name: 'Safety Yellow Polyurethane Topcoat (20L Drum)', cat: 'Industrial Paints & Primers', unit: 'ltr', reorder: 80 },
      { sku: 'PNT-THN-IND', name: 'Industrial Polyurethane Thinner (18L Can)', cat: 'Industrial Paints & Primers', unit: 'ltr', reorder: 60 },
      { sku: 'WLD-ROD-7018', name: 'E7018 Low Hydrogen Welding Rods (5kg Pack)', cat: 'Welding & Hardware Consumables', unit: 'kg', reorder: 50 },
      { sku: 'WLD-WIR-MIG', name: 'ER70S-6 MIG Welding Solid Wire Spool (15kg)', cat: 'Welding & Hardware Consumables', unit: 'kg', reorder: 60 },
      { sku: 'HYD-OIL-46', name: 'Hydraulic Oil ISO VG 46 (209L Drum)', cat: 'Welding & Hardware Consumables', unit: 'ltr', reorder: 400 },
      { sku: 'ENG-OIL-15W40', name: 'Heavy Duty Diesel Engine Oil 15W-40 (208L)', cat: 'Welding & Hardware Consumables', unit: 'ltr', reorder: 300 },
      { sku: 'FAS-BLT-M16', name: 'Grade 8.8 High Strength Hex Bolts M16x60mm', cat: 'Welding & Hardware Consumables', unit: 'pcs', reorder: 500 },
      { sku: 'FAS-NUT-M16', name: 'Heavy Hex Nuts M16 Grade 8', cat: 'Welding & Hardware Consumables', unit: 'pcs', reorder: 500 },
    ];

    const itemIdMap = new Map<string, number>();
    for (const m of materialsData) {
      const catId = categoryIdMap.get(m.cat)!;
      const unitId = unitIdMap.get(m.unit)!;
      const res = await client.query(
        `INSERT INTO items (sku, name, category_id, unit_id, reorder_level)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (sku) DO UPDATE SET
           name = EXCLUDED.name,
           category_id = EXCLUDED.category_id,
           unit_id = EXCLUDED.unit_id,
           reorder_level = EXCLUDED.reorder_level
         RETURNING id`,
        [m.sku, m.name, catId, unitId, m.reorder]
      );
      itemIdMap.set(m.sku, res.rows[0].id);
    }

    // =========================================================================
    // 11. INVOICES & INVOICE LINES
    // Invoice 1: Received Supplier Invoice from Gulf Heavy Metals Trading
    // Invoice 2: Issued Customer Invoice to Apex Infrastructure Partners for Crane Rental
    // =========================================================================
    // 1. Supplier Invoice (Received)
    const gulfMetalsId = partyIdMap.get('Gulf Heavy Metals Trading')!;
    let suppInvoiceId: number;
    const inv1Check = await client.query(
      `SELECT id FROM invoices WHERE direction = 'received' AND party_id = $1 AND invoice_no = 'INV-GHM-2026-0891'`,
      [gulfMetalsId]
    );

    if (inv1Check.rows.length > 0) {
      suppInvoiceId = inv1Check.rows[0].id;
    } else {
      // Subtotal = 18,400 SAR, VAT 15% = 2,760 SAR, Total = 21,160 SAR
      const inv1Res = await client.query(
        `INSERT INTO invoices (
           direction, invoice_no, party_id, invoice_date, due_date,
           subtotal, vat_amount, total, status, notes
         ) VALUES (
           'received', 'INV-GHM-2026-0891', $1, '2026-09-15', '2026-10-15',
           18400.00, 2760.00, 21160.00, 'paid', 'Monthly batch of mild steel plates and consumables'
         ) RETURNING id`,
        [gulfMetalsId]
      );
      suppInvoiceId = inv1Res.rows[0].id;
    }

    const suppLines = [
      { lineNo: 1, sku: 'STL-SHT-6MM', desc: 'Mild Steel Plate Sheet 6mm', qty: 30, unit: 'sheet', unitPrice: 380.00 },
      { lineNo: 2, sku: 'STL-SHT-12MM', desc: 'High-Tensile Steel Plate 12mm', qty: 10, unit: 'sheet', unitPrice: 700.00 },
      { lineNo: 3, sku: 'HYD-OIL-46', desc: 'Hydraulic Oil ISO VG 46 (Drum)', qty: 4, unit: 'ltr', unitPrice: 0.00 },
    ];

    for (const l of suppLines) {
      const itemId = itemIdMap.get(l.sku)!;
      const unitId = unitIdMap.get(l.unit)!;
      await client.query(
        `INSERT INTO invoice_lines (invoice_id, line_no, description, item_id, quantity, unit_id, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (invoice_id, line_no) DO UPDATE SET unit_price = EXCLUDED.unit_price, quantity = EXCLUDED.quantity`,
        [suppInvoiceId, l.lineNo, l.desc, itemId, l.qty, unitId, l.unitPrice]
      );
    }

    // 2. Customer Invoice (Issued to Apex Infrastructure Partners)
    let custInvoiceId: number;
    const inv2Check = await client.query(
      `SELECT id FROM invoices WHERE direction = 'issued' AND party_id = $1 AND invoice_no = 'INV-SE-2026-0042'`,
      [apexId]
    );

    if (inv2Check.rows.length > 0) {
      custInvoiceId = inv2Check.rows[0].id;
    } else {
      // Rental for September 2026: Cranes (70,000) + Gen (7,000) + Office (4,200) + Ablution (2,500) = 83,700 SAR + 15% VAT
      const inv2Res = await client.query(
        `INSERT INTO invoices (
           direction, invoice_no, party_id, rental_id, invoice_date, due_date,
           subtotal, vat_amount, total, status, notes
         ) VALUES (
           'issued', 'INV-SE-2026-0042', $1, $2, '2026-10-01', '2026-10-31',
           83700.00, 12555.00, 96255.00, 'unpaid', 'Rental billing for September 2026 at King Salman Complex'
         ) RETURNING id`,
        [apexId, rental1Id]
      );
      custInvoiceId = inv2Res.rows[0].id;
    }

    const custLines = [
      { lineNo: 1, desc: 'Tadano 50T Mobile Crane (CRN-50-001) - Sept 2026 Rental', qty: 1, unit: 'pcs', unitPrice: 35000.00 },
      { lineNo: 2, desc: 'Tadano 50T Mobile Crane (CRN-50-002) - Sept 2026 Rental', qty: 1, unit: 'pcs', unitPrice: 35000.00 },
      { lineNo: 3, desc: 'Cummins 250 kVA Generator (GEN-250-001) - Sept 2026 Rental', qty: 1, unit: 'pcs', unitPrice: 7000.00 },
      { lineNo: 4, desc: 'Portable Executive Office 40x10 (OFF-40-001) - Sept 2026 Rental', qty: 1, unit: 'pcs', unitPrice: 4200.00 },
      { lineNo: 5, desc: 'Ablution 4-Bay Unit (WSH-04-001) - Sept 2026 Rental', qty: 1, unit: 'pcs', unitPrice: 2500.00 },
    ];

    for (const cl of custLines) {
      const unitId = unitIdMap.get(cl.unit)!;
      await client.query(
        `INSERT INTO invoice_lines (invoice_id, line_no, description, item_id, quantity, unit_id, unit_price)
         VALUES ($1, $2, $3, NULL, $4, $5, $6)
         ON CONFLICT (invoice_id, line_no) DO UPDATE SET unit_price = EXCLUDED.unit_price, quantity = EXCLUDED.quantity`,
        [custInvoiceId, cl.lineNo, cl.desc, cl.qty, unitId, cl.unitPrice]
      );
    }

    // =========================================================================
    // 12. INITIAL STOCK MOVEMENTS (SINGLE-ENTRY, SIGNED, APPEND-ONLY INVENTORY LEDGER)
    // =========================================================================
    const stockCount = await client.query(`SELECT COUNT(*) FROM stock_movements`);
    if (parseInt(stockCount.rows[0].count, 10) === 0) {
      const initialStockReceipts = [
        { sku: 'STL-SHT-6MM', qty: 50.000, cost: 380.00, note: 'Initial warehouse balance' },
        { sku: 'STL-SHT-12MM', qty: 25.000, cost: 700.00, note: 'Initial warehouse balance' },
        { sku: 'ELEC-WIR-4MM', qty: 40.000, cost: 120.00, note: 'Initial warehouse balance' },
        { sku: 'ELEC-WIR-10MM', qty: 350.000, cost: 28.50, note: 'Initial warehouse balance' },
        { sku: 'ELEC-CON-25MM', qty: 400.000, cost: 14.50, note: 'Initial warehouse balance' },
        { sku: 'ELEC-CON-38MM', qty: 200.000, cost: 22.00, note: 'Initial warehouse balance' },
        { sku: 'PNT-PRM-EPX', qty: 180.000, cost: 45.00, note: 'Initial warehouse balance' },
        { sku: 'PNT-TOP-YEL', qty: 150.000, cost: 55.00, note: 'Initial warehouse balance' },
        { sku: 'PNT-THN-IND', qty: 120.000, cost: 18.00, note: 'Initial warehouse balance' },
        { sku: 'WLD-ROD-7018', qty: 200.000, cost: 32.00, note: 'Initial warehouse balance' },
        { sku: 'WLD-WIR-MIG', qty: 150.000, cost: 42.00, note: 'Initial warehouse balance' },
        { sku: 'HYD-OIL-46', qty: 1200.000, cost: 12.00, note: 'Bulk storage tank initial fill' },
        { sku: 'ENG-OIL-15W40', qty: 800.000, cost: 14.00, note: 'Bulk storage tank initial fill' },
        { sku: 'FAS-BLT-M16', qty: 1200.000, cost: 3.50, note: 'Bin 4A initial stock' },
        { sku: 'FAS-NUT-M16', qty: 1200.000, cost: 1.50, note: 'Bin 4B initial stock' },
      ];

      for (const st of initialStockReceipts) {
        const itemId = itemIdMap.get(st.sku)!;
        await client.query(
          `INSERT INTO stock_movements (item_id, qty, type, unit_cost, moved_by, note)
           VALUES ($1, $2, 'receipt', $3, $4, $5)`,
          [itemId, st.qty, st.cost, adminId, st.note]
        );
      }

      // Record receipts linked to Supplier Invoice lines
      await client.query(
        `INSERT INTO stock_movements (item_id, qty, type, invoice_line_invoice_id, invoice_line_no, unit_cost, moved_by, note)
         VALUES ($1, 30.000, 'receipt', $2, 1, 380.00, $3, 'Received against GHM Inv INV-GHM-2026-0891')`,
        [itemIdMap.get('STL-SHT-6MM')!, suppInvoiceId, adminId]
      );

      // Record a valid issue of materials for routine maintenance
      await client.query(
        `INSERT INTO stock_movements (item_id, qty, type, unit_cost, moved_by, note)
         VALUES ($1, -15.000, 'issue', 14.50, $2, 'Issued for yard workshop lighting repair')`,
        [itemIdMap.get('ELEC-CON-25MM')!, staffId]
      );
    }

    await client.query('COMMIT');
    logger.info('✅ Database seeded successfully with realistic idempotent demo data!');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, '❌ Database seeding failed, transaction rolled back.');
    throw error;
  } finally {
    client.release();
  }
}

// Execute directly if run as a standalone script
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
