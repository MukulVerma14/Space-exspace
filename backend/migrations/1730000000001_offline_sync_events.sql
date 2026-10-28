-- Up Migration
-- ============================================================================
-- OFFLINE SYNC EVENTS & EVENT-ORDERED TIMELINES (STEP O1)
-- ============================================================================

-- 1. SYNC EVENTS TABLE
-- WHY: Stores offline events replayed by clients.
-- Using client-generated UUID as PK guarantees idempotency: re-sending the same
-- event returns the stored result without re-executing state changes.
CREATE TABLE sync_events (
    client_event_id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('accepted', 'rejected', 'duplicate')),
    result JSONB NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sync_events_user ON sync_events (user_id);
CREATE INDEX idx_sync_events_occurred ON sync_events (occurred_at);

-- 2. ADD recorded_at TO location_log & stock_movements
-- WHY: Distinguishes when an action physically occurred in the yard/field (moved_at)
-- from when the server actually recorded it (recorded_at).
ALTER TABLE location_log
    ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. UPDATE VIEW v_equipment_current
-- WHY: Orders location movements by occurred time (moved_at DESC) rather than server receipt time,
-- ensuring a stale offline device syncing an old movement cannot overwrite a newer movement.
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
    ORDER BY ll.equipment_id, ll.moved_at DESC, ll.recorded_at DESC, ll.id DESC
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
      AND r.status IN ('confirmed', 'picked_up')
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
-- Restore view without recorded_at in order clause
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
      AND r.status IN ('confirmed', 'picked_up')
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

ALTER TABLE stock_movements DROP COLUMN IF EXISTS recorded_at;
ALTER TABLE location_log DROP COLUMN IF EXISTS recorded_at;
DROP TABLE IF EXISTS sync_events;
