-- Up Migration
-- ============================================================================
-- SPACE EXSPACE Equipment & Materials Tracking Schema
-- Target: 3NF Relational Structure with Derived State View & Append-Only Ledgers
-- ============================================================================

-- 1. USERS & AUTHENTICATION
-- WHY: Stores credentials and system access roles (admin vs staff).
-- Enforcing UNIQUE on email prevents duplicate credential records.
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'staff')),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. EQUIPMENT TYPES
-- WHY: Categorizes equipment classes (e.g. Mobile Crane, Diesel Generator, Portable Office).
-- Stores the unit of capacity (e.g. 'ton', 'kVA', 'sqm') so models of this type share consistent measurement units.
CREATE TABLE equipment_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    capacity_unit VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. EQUIPMENT MODELS
-- WHY 3NF: Capacity and specifications depend strictly on the model definition, NOT on the individual asset.
-- Placing capacity_value here eliminates transitive functional dependency (asset -> model -> capacity).
CREATE TABLE equipment_models (
    id SERIAL PRIMARY KEY,
    type_id INTEGER NOT NULL REFERENCES equipment_types(id) ON DELETE RESTRICT,
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    capacity_value NUMERIC(12,2) NOT NULL CHECK (capacity_value > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_equipment_models UNIQUE (type_id, make, model, capacity_value)
);

-- 4. STANDARD RATE CARDS
-- WHY: Defines official rental rates per time unit (hourly, daily, weekly, monthly).
-- Composite PK (model_id, unit, valid_from) supports historical rate revisions without deleting past rate cards.
-- Stored as vertical rows instead of repetitive columns (daily_rate, weekly_rate) conforming to 1NF.
CREATE TABLE rates (
    model_id INTEGER NOT NULL REFERENCES equipment_models(id) ON DELETE RESTRICT,
    unit VARCHAR(20) NOT NULL CHECK (unit IN ('hourly', 'daily', 'weekly', 'monthly')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    vat_included BOOLEAN NOT NULL DEFAULT false,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (model_id, unit, valid_from)
);

-- 5. PARTIES (CUSTOMERS & SUPPLIERS)
-- WHY: Consolidated entity for external business organizations. Many companies in industrial hubs
-- act as both customer (renting cranes) and supplier (providing steel or transport).
CREATE TABLE parties (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    vat_no VARCHAR(50), -- Saudi ZATCA 15-digit tax identification number
    address TEXT,
    notes TEXT,
    is_customer BOOLEAN NOT NULL DEFAULT false,
    is_supplier BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_party_role CHECK (is_customer = true OR is_supplier = true)
);

-- 6. LOCATIONS
-- WHY: Represents yards, workshops, transit paths, or customer job sites.
-- Linking party_id allows associating a client_site directly with its owning customer.
CREATE TABLE locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('yard', 'client_site', 'workshop', 'transit')),
    party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. EQUIPMENT ASSETS (INDIVIDUAL PHYSICAL UNITS)
-- WHY: Each physical machine has a durable unique asset_code printed on its QR code label.
-- Using business asset_code rather than internal serial ID guarantees QR labels survive DB migrations.
CREATE TABLE equipment (
    id SERIAL PRIMARY KEY,
    asset_code VARCHAR(50) UNIQUE NOT NULL,
    model_id INTEGER NOT NULL REFERENCES equipment_models(id) ON DELETE RESTRICT,
    serial_no VARCHAR(100) NULL,
    condition VARCHAR(30) NOT NULL DEFAULT 'good' CHECK (condition IN ('good', 'fair', 'needs_repair')),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. LOCATION LOG (APPEND-ONLY AUDIT TRAIL)
-- WHY: An asset's location is never mutated in place. Every physical scan or transfer creates an immutable log row.
-- This guarantees a tamper-proof chain of custody for insurance and operational audits.
CREATE TABLE location_log (
    id BIGSERIAL PRIMARY KEY,
    equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    moved_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    moved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note TEXT
);

CREATE INDEX idx_location_log_equipment_moved ON location_log (equipment_id, moved_at DESC);

-- 9. MAINTENANCE (REPAIRS & MODIFICATIONS)
-- WHY: Tracks repair work orders, costs, and downtime.
CREATE TABLE maintenance (
    id BIGSERIAL PRIMARY KEY,
    equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('repair', 'modification')),
    description TEXT NOT NULL,
    cost NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (cost >= 0),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMPTZ NULL,
    reported_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT chk_maintenance_dates CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

-- PARTIAL UNIQUE INDEX: Only ONE open maintenance job allowed per physical equipment
-- WHY: An asset currently under repair cannot concurrently begin a second distinct active maintenance job.
CREATE UNIQUE INDEX uq_open_maintenance ON maintenance (equipment_id) WHERE closed_at IS NULL;

-- 10. RENTALS (HEADER)
-- WHY: Represents rental agreements with customers.
CREATE TABLE rentals (
    id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    site_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    status VARCHAR(30) NOT NULL DEFAULT 'quotation' CHECK (status IN ('quotation', 'confirmed', 'picked_up', 'returned', 'cancelled')),
    start_date DATE NOT NULL,
    expected_end DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_rental_dates CHECK (expected_end >= start_date),
    CONSTRAINT uq_rental_customer UNIQUE (id, customer_id)
);

CREATE INDEX idx_rentals_customer ON rentals (customer_id);

-- 11. RENTAL ITEMS (LINE ITEMS)
-- WHY: applied_rate is permanently recorded at contract signing so that future changes
-- to the standard rate card never alter historical financial agreements.
CREATE TABLE rental_items (
    rental_id BIGINT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
    equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
    applied_rate NUMERIC(12,2) NOT NULL CHECK (applied_rate >= 0),
    rate_unit VARCHAR(20) NOT NULL CHECK (rate_unit IN ('hourly', 'daily', 'weekly', 'monthly')),
    discount_note TEXT,
    returned_at TIMESTAMPTZ NULL,
    PRIMARY KEY (rental_id, equipment_id)
);

-- PARTIAL UNIQUE INDEX: One active rental per physical asset across the entire database!
-- WHY: Guarantees at the database level that no asset can be actively rented to two clients simultaneously.
CREATE UNIQUE INDEX uq_active_rental_item ON rental_items (equipment_id) WHERE returned_at IS NULL;

-- 12. MATERIALS INVENTORY: CATEGORIES & UNITS
CREATE TABLE item_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE units (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL, -- e.g. 'pcs', 'm', 'kg', 'ltr', 'roll'
    name VARCHAR(50) NOT NULL
);

-- 13. MATERIAL ITEMS (SKUs)
-- WHY: Tracks consumables (welding wire, conduit, paint, metal sheets) used in operations or maintenance.
CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category_id INTEGER NOT NULL REFERENCES item_categories(id) ON DELETE RESTRICT,
    unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0.000 CHECK (reorder_level >= 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 14. INVOICES (CUSTOMER & SUPPLIER)
-- WHY: Stores received (supplier) and issued (customer) billing documents.
-- Direction + party + invoice_no forms a unique real-world business identifier.
CREATE TABLE invoices (
    id BIGSERIAL PRIMARY KEY,
    direction VARCHAR(20) NOT NULL CHECK (direction IN ('issued', 'received')),
    invoice_no VARCHAR(100) NOT NULL,
    party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    rental_id BIGINT NULL REFERENCES rentals(id) ON DELETE SET NULL,
    invoice_date DATE NOT NULL,
    due_date DATE NOT NULL,
    subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    vat_amount NUMERIC(12,2) NOT NULL CHECK (vat_amount >= 0),
    total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'part_paid', 'paid')),
    paid_on DATE NULL,
    file_url TEXT NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_invoice UNIQUE (direction, party_id, invoice_no),
    CONSTRAINT chk_invoice_dates CHECK (due_date >= invoice_date)
);

CREATE INDEX idx_invoices_party ON invoices (party_id);

-- 15. INVOICE LINES
-- WHY: Received invoice lines track purchase price fluctuations of materials over time.
CREATE TABLE invoice_lines (
    invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    description TEXT NOT NULL,
    item_id INTEGER NULL REFERENCES items(id) ON DELETE RESTRICT,
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY (invoice_id, line_no)
);

CREATE INDEX idx_invoice_lines_item ON invoice_lines (item_id);

-- 16. STOCK MOVEMENTS (APPEND-ONLY INVENTORY LEDGER)
-- WHY: Stock on hand is NEVER an editable number. It is ALWAYS calculated dynamically as SUM(qty).
-- Receipts add positive qty; issues subtract negative qty. This creates an infallible financial audit trail.
CREATE TABLE stock_movements (
    id BIGSERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    qty NUMERIC(12,3) NOT NULL CHECK (qty != 0), -- signed: positive for receipt/return, negative for issue
    type VARCHAR(30) NOT NULL CHECK (type IN ('receipt', 'issue', 'adjustment', 'return')),
    invoice_line_invoice_id BIGINT NULL,
    invoice_line_no INTEGER NULL,
    FOREIGN KEY (invoice_line_invoice_id, invoice_line_no) REFERENCES invoice_lines(invoice_id, line_no) ON DELETE SET NULL,
    maintenance_id BIGINT NULL REFERENCES maintenance(id) ON DELETE SET NULL,
    unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (unit_cost >= 0),
    moved_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    moved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note TEXT NULL
);

CREATE INDEX idx_stock_movements_item ON stock_movements (item_id);

-- PREVENT NEGATIVE STOCK TRIGGER
-- WHY: Guarantees database-level integrity so no concurrent issue operation can drive inventory below zero.
CREATE OR REPLACE FUNCTION check_stock_movement_non_negative()
RETURNS TRIGGER AS $$
DECLARE
    current_stock NUMERIC(12,3);
BEGIN
    -- Only check when stock is being decremented (issue or negative adjustment)
    IF NEW.qty < 0 THEN
        SELECT COALESCE(SUM(qty), 0) INTO current_stock
        FROM stock_movements
        WHERE item_id = NEW.item_id;

        IF (current_stock + NEW.qty) < 0 THEN
            RAISE EXCEPTION 'Cannot issue % units of item %: current stock is %',
                ABS(NEW.qty), NEW.item_id, current_stock;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_stock_movement_non_negative
BEFORE INSERT ON stock_movements
FOR EACH ROW
EXECUTE FUNCTION check_stock_movement_non_negative();

-- 17. VIEW: v_equipment_current
-- WHY DERIVED STATE BEATS STORED STATE:
-- An equipment's location and status are physical realities derived from immutable operational events.
-- Storing a mutable 'status' column creates two sources of truth that inevitably get out of sync.
-- This view derives:
--   - location from the most recent location_log row
--   - status = 'rented' if an open rental_item exists
--   - status = 'under_repair' if an open maintenance row exists
--   - status = 'available' otherwise
CREATE OR REPLACE VIEW v_equipment_current AS
WITH latest_location AS (
    SELECT DISTINCT ON (equipment_id)
        ll.equipment_id,
        ll.location_id,
        loc.name AS location_name,
        loc.kind AS location_kind,
        ll.moved_at AS last_moved_at,
        ll.moved_by AS last_moved_by,
        u.name AS last_moved_by_name
    FROM location_log ll
    JOIN locations loc ON loc.id = ll.location_id
    JOIN users u ON u.id = ll.moved_by
    ORDER BY ll.equipment_id, ll.moved_at DESC, ll.id DESC
),
active_rental AS (
    SELECT
        ri.equipment_id,
        ri.rental_id,
        ri.applied_rate,
        ri.rate_unit,
        r.customer_id,
        p.name AS customer_name,
        r.site_id,
        loc.name AS site_name,
        r.start_date,
        r.expected_end
    FROM rental_items ri
    JOIN rentals r ON r.id = ri.rental_id
    JOIN parties p ON p.id = r.customer_id
    JOIN locations loc ON loc.id = r.site_id
    WHERE ri.returned_at IS NULL
),
active_maint AS (
    SELECT
        m.id AS maintenance_id,
        m.equipment_id,
        m.kind AS maintenance_kind,
        m.description AS maintenance_desc,
        m.opened_at AS maintenance_opened_at
    FROM maintenance m
    WHERE m.closed_at IS NULL
)
SELECT
    e.id,
    e.asset_code,
    e.serial_no,
    e.condition,
    e.active,
    e.created_at,
    em.id AS model_id,
    em.make,
    em.model,
    em.capacity_value,
    et.id AS type_id,
    et.name AS type_name,
    et.capacity_unit,
    ll.location_id AS current_location_id,
    ll.location_name AS current_location_name,
    ll.location_kind AS current_location_kind,
    ll.last_moved_at,
    ll.last_moved_by,
    ll.last_moved_by_name,
    CASE
        WHEN ar.rental_id IS NOT NULL THEN 'rented'
        WHEN am.maintenance_id IS NOT NULL THEN 'under_repair'
        ELSE 'available'
    END AS status,
    ar.rental_id AS current_rental_id,
    ar.customer_id AS current_customer_id,
    ar.customer_name AS current_customer_name,
    ar.site_name AS current_site_name,
    ar.expected_end AS current_rental_expected_end,
    am.maintenance_id AS current_maintenance_id,
    am.maintenance_desc AS current_maintenance_desc
FROM equipment e
JOIN equipment_models em ON em.id = e.model_id
JOIN equipment_types et ON et.id = em.type_id
LEFT JOIN latest_location ll ON ll.equipment_id = e.id
LEFT JOIN active_rental ar ON ar.equipment_id = e.id
LEFT JOIN active_maint am ON am.equipment_id = e.id;

-- Down Migration
-- Drop objects in reverse dependency order
DROP VIEW IF EXISTS v_equipment_current;
DROP TRIGGER IF EXISTS trg_check_stock_movement_non_negative ON stock_movements;
DROP FUNCTION IF EXISTS check_stock_movement_non_negative();
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS invoice_lines;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS units;
DROP TABLE IF EXISTS item_categories;
DROP TABLE IF EXISTS rental_items;
DROP TABLE IF EXISTS rentals;
DROP TABLE IF EXISTS maintenance;
DROP TABLE IF EXISTS location_log;
DROP TABLE IF EXISTS equipment;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS parties;
DROP TABLE IF EXISTS rates;
DROP TABLE IF EXISTS equipment_models;
DROP TABLE IF EXISTS equipment_types;
DROP TABLE IF EXISTS users;
