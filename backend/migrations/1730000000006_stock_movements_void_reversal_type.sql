-- Up Migration
-- ============================================================================
-- ADD 'void_reversal' TYPE TO STOCK MOVEMENTS
-- ============================================================================
-- WHY: Reversing positive stock receipts from voided supplier invoices requires
-- a distinct movement type ('void_reversal') with signed negative qty to offset
-- inventory without confusing it with physical goods 'return' to stock (positive).

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;

ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
    CHECK (type IN ('receipt', 'issue', 'adjustment', 'return', 'void_reversal'));

-- Down Migration
-- ============================================================================
-- REVERT CHECK CONSTRAINT TO ORIGINAL FOUR TYPES
-- ============================================================================

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;

ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
    CHECK (type IN ('receipt', 'issue', 'adjustment', 'return'));
