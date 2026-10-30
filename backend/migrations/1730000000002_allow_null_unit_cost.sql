-- Up Migration
-- ============================================================================
-- ALLOW NULL UNIT COST FOR OFFLINE GOODS RECEIVED (STEP O1-O4 HARDENING)
-- ============================================================================
-- WHY: Field staff recording stock receipts offline do not know and must not enter
-- commercial unit costs or prices. The unit_cost column must permit NULL so that
-- offline receipts do not corrupt inventory valuation or price histories with 0.00.

ALTER TABLE stock_movements ALTER COLUMN unit_cost DROP NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN unit_cost DROP DEFAULT;

-- Down Migration
-- ============================================================================
-- RESTORE NOT NULL AND DEFAULT 0.00
-- ============================================================================

ALTER TABLE stock_movements ALTER COLUMN unit_cost SET DEFAULT 0.00;
UPDATE stock_movements SET unit_cost = 0.00 WHERE unit_cost IS NULL;
ALTER TABLE stock_movements ALTER COLUMN unit_cost SET NOT NULL;
