-- Up Migration
-- ============================================================================
-- INVOICE VOID AUDIT & 4-DECIMAL UNIT PRICE PRECISION
-- ============================================================================
-- WHY: Industrial rentals and high-volume material consumables often quote unit
-- prices with fractional halalas/cents (e.g. 0.1250 SAR per kg, 12.3750 SAR per liter).
-- Line unit_price must allow up to 4 decimal places (NUMERIC(14,4)).
-- Voided invoices require audit fields: voided_by, voided_at, void_reason.

ALTER TABLE invoice_lines ALTER COLUMN unit_price TYPE NUMERIC(14,4);

ALTER TABLE invoices ADD COLUMN voided_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN voided_at TIMESTAMPTZ NULL;
ALTER TABLE invoices ADD COLUMN void_reason TEXT NULL;

-- Down Migration
-- ============================================================================
-- REVERT TO 2-DECIMAL UNIT PRICE AND DROP VOID AUDIT FIELDS
-- ============================================================================

ALTER TABLE invoices DROP COLUMN IF EXISTS void_reason;
ALTER TABLE invoices DROP COLUMN IF EXISTS voided_at;
ALTER TABLE invoices DROP COLUMN IF EXISTS voided_by;

ALTER TABLE invoice_lines ALTER COLUMN unit_price TYPE NUMERIC(12,2);
