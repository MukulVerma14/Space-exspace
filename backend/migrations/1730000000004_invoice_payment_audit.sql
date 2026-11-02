-- Up Migration
-- ============================================================================
-- INVOICE PAYMENT AUDIT & VOID STATUS (STEP 7: ISSUED INVOICES WORKFLOW)
-- ============================================================================
-- WHY: Invoices require recording which user marked them as paid (paid_by),
-- and status check constraint must include 'void' to support invoice cancellation.

ALTER TABLE invoices ADD COLUMN paid_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('unpaid', 'part_paid', 'paid', 'void'));

-- Down Migration
-- ============================================================================
-- REVERT PAYMENT AUDIT & RESTORE ORIGINAL STATUS CONSTRAINT
-- ============================================================================

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('unpaid', 'part_paid', 'paid'));
ALTER TABLE invoices DROP COLUMN IF EXISTS paid_by;
