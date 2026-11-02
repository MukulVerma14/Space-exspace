# ADR 017: Arbitrary-Precision Decimal Money Math, 4-Decimal Unit Prices, Half-Up Rounding Rule, and Compensating Reversals for Voided Invoices

## Status
Accepted

## Context
Following the implementation of store-only issued customer invoices (ADR 016), commercial and inventory accounting requires addressing three mathematical, operational, and auditing challenges:

1. **IEEE-754 Binary Floating-Point Inaccuracies**:
   Standard JavaScript numbers are IEEE-754 double-precision floating-point values. Elementary decimal operations produce binary representation artifacts:
   - `0.1 + 0.2 === 0.30000000000000004`
   - `3 * 0.1 === 0.30000000000000004`
   Over large invoice line items (e.g. 100+ consumable lines of `0.07`), cumulative float drift produces incorrect cents differences ($7.000000000000007$ vs. $7.00$), triggering false-positive mathematical reconciliation failures between client and server.

2. **Bulk & Industrial Material Fractional Unit Pricing**:
   Industrial procurement (fuels, lubricants, welding wire, sheet metal, fasteners) frequently quotes prices per unit or per meter down to fractions of a cent (e.g., $1.2345/kg). Constraining `invoice_lines.unit_price` to 2 decimal places distorts pricing contracts and causes severe rounding errors on large quantities. However, accounting standards require line item totals and invoice grand totals to be settled in 2-decimal fiat currency (SAR/USD).

3. **Invoice Cancellation & Inventory Ledger Integrity**:
   Real-world commercial billing occasionally necessitates voiding invoices due to billing disputes, data entry errors, or cancelled contracts:
   - Invoices must **never** be hard-deleted (`DELETE FROM invoices`), as this destroys audit trails, creates illegal gaps in sequential numbering, and violates statutory bookkeeping standards.
   - For supplier invoices that generated warehouse stock receipts (`type = 'receipt'`), simply deleting stock movement records violates the append-only ledger invariant and erases warehouse custody history.
   - Reversing these receipts using `type = 'return'` creates semantic confusion because in warehouse operations, `return` specifically denotes physical goods returned to stock from a job site (positive quantity).
   - If received stock has already been consumed, dispatched, or issued to a job site, voiding the invoice without checking on-hand inventory would drive warehouse stock negative, violating physical reality.

---

## Decisions

### 1. Arbitrary-Precision Decimal Math Library (`decimal.js`)
All monetary calculations and reconciliation checks across the backend invoice lifecycle are migrated from native JavaScript floating-point arithmetic to `decimal.js`:
- Precision configured to 28 significant digits.
- Rounding mode configured to `Decimal.ROUND_HALF_UP`.
- In-memory line totals, subtotal summations, and tax calculations operate exclusively on `Decimal` instances before formatting back to strings or numbers for JSON serialization.

### 2. 4-Decimal Unit Prices & Database Precision Migration
We support fractional pricing up to 4 decimal places while enforcing 2 decimal places on header totals:
- **Database Schema**: Migration `1730000000005_invoice_void_and_unit_price_precision.sql` alters `invoice_lines.unit_price` from `NUMERIC(12,2)` to `NUMERIC(14,4)`.
- **Validation**:
  - `invoice_lines.unit_price`: allows up to 4 decimal places (`hasMaxDecimals(val, 4)`).
  - `subtotal`, `vat_amount`, and `total`: must have at most 2 decimal places (`hasMaxDecimals(val, 2)`). Values with $> 2$ decimal places are rejected with `400 Bad Request`.

### 3. Documented Commercial Rounding Rule (`ROUND_HALF_UP`)
To guarantee deterministic mathematical reconciliation across frontend clients and backend APIs:
1. **Line Total Calculation**:
   $$\text{line\_total}_i = \text{round\_half\_up}(\text{quantity}_i \times \text{unit\_price}_i, 2)$$
   Ties (half-cents) are rounded away from zero (half-up), conforming to standard commercial invoicing practice.
2. **Subtotal Calculation**:
   $$\text{subtotal} = \sum_{i=1}^{N} \text{line\_totals}_i$$
3. **Grand Total Calculation**:
   $$\text{total} = \text{subtotal} + \text{vat\_amount}$$
4. **Tolerance Validation**: Client-submitted totals must match server-computed totals within a $0.009$ delta (less than one cent) to account for harmless string-formatting differences while rejecting any actual penny discrepancies.

### 4. Admin-Only Invoice Voiding (`PATCH /api/invoices/:id/void`)
We introduce a voiding endpoint restricted to the `admin` role (`staff` receive 403 Forbidden):
- **Mandatory Reason**: Requires a non-empty `reason` string explaining why the invoice is being cancelled.
- **State Transition Guards**:
  - Rejects if `status === 'paid'` with `400 Bad Request` ("Cannot void an invoice that is already paid").
  - Rejects if `status === 'void'` with `400 Bad Request` ("Invoice is already void").
- **Audit Immutability**:
  - The invoice record and its line items are **never deleted**.
  - Sets `status = 'void'`.
  - Records `voided_by = req.user.id`, `voided_at = CURRENT_TIMESTAMP`, and `void_reason = reason`.

### 5. Compensating Reversals via Dedicated `void_reversal` Movement Type
When a received supplier invoice is voided:
- **Dedicated Movement Type**: Migration `1730000000006_stock_movements_void_reversal_type.sql` extends `stock_movements_type_check` to include `void_reversal`.
- **Semantic Separation**:
  - `return`: Reserved strictly for physical unused materials returned to the yard from a job site (signed positive quantity `+qty`).
  - `void_reversal`: System-generated reversal posted exclusively when voiding a received supplier invoice (signed negative quantity `-qty`).
- **Compensating Ledger Entry**: For every positive receipt linked to the invoice (`invoice_line_invoice_id = id AND type = 'receipt' AND qty > 0`), the server appends a compensating movement:
  - `type = 'void_reversal'`
  - `qty = -receipt.qty` (signed negative)
  - `unit_cost = receipt.unit_cost` (preserves historical purchase cost)
  - `moved_by = req.user.id`
  - `note = 'Void reversal for supplier invoice #{invoice_no}: {reason}'`
- **Concurrency & Negative Stock Trigger Guard**:
  Because `qty < 0`, PostgreSQL trigger `check_stock_movement_non_negative()` executes inside the transaction:
  - It acquires an exclusive row lock (`FOR UPDATE`) on the parent `items` record.
  - It validates that $\text{current\_stock} + \text{NEW.qty} \ge 0$.
  - If items were already consumed or dispatched and on-hand inventory is insufficient to cover the reversal, the trigger raises an exception:
    `Cannot issue X units of item Y: current stock is Z`.
  - The controller catches this exception, rolls back the entire transaction, and returns `400 Bad Request` ("Insufficient stock to void invoice: received items have already been consumed or issued").

### 6. Exclusion of Voided Receipts from Price History & Valuation
- Historical material price queries (`GET /api/materials/:id/price-history`) explicitly filter out voided invoice lines (`inv.status != 'void'`).
- Inventory valuation calculations strictly exclude receipts whose linked supplier invoice is voided (`(inv.id IS NULL OR inv.status != 'void')`), ensuring voided invoices do not corrupt average cost or total stock valuation.
- Physical ledger entries remain permanently visible in `stock_movements` and `GET /api/materials/:id/movements` to maintain complete traceability.

---

## Alternatives Considered & Rejected

1. **Native JavaScript `Math.round(val * 100) / 100`**:
   Rejected. Native float scaling still suffers from binary float inaccuracies (e.g. `1.005 * 100` becomes `100.49999999999999`, which incorrectly rounds down to `1.00` instead of `1.01`).

2. **Hard-Deleting Voided Invoices (`DELETE FROM invoices`)**:
   Rejected. Hard-deleting destroys corporate audit history, creates unexplainable gaps in invoice numbering sequences, and violates statutory tax regulations.

3. **Deleting Linked Stock Receipts on Supplier Invoice Void**:
   Rejected. Deleting ledger entries breaks the fundamental invariant of an append-only single-entry inventory ledger (ADR 002). Reversing entries (`type = 'void_reversal'`) provide complete provenance and explain inventory deductions.

4. **Reusing `type = 'return'` for Void Reversals**:
   Rejected. In yard operations, `return` means field workers returned unused materials back to stock (increasing inventory). Using a negative `return` to reverse a voided supplier invoice causes reporting confusion and audit errors. A dedicated `void_reversal` type makes the operational intent unambiguous.

5. **Allowing Stock to Go Negative on Void**:
   Rejected. Allowing negative inventory breaks physical reality in the warehouse and circumvents the concurrency-locked non-negative trigger established in ADR 002 & ADR 007. If stock was consumed, the operational team must reconcile the inventory discrepancy before the invoice can be cancelled (documented in `docs/ADMIN_GUIDE.md`).

---

## Consequences

### Positive
- Total elimination of IEEE-754 float drift across invoice calculations and reconciliations.
- Full support for precision 4-decimal unit pricing on bulk consumables and materials.
- Clean semantic separation between physical goods returns (`return`) and void reversals (`void_reversal`).
- Price history and valuation strictly exclude voided supplier billing while preserving complete physical movement history in the audit ledger.

### Negative / Trade-offs
- An invoice whose received materials have already been consumed cannot be voided directly via this endpoint until warehouse stock is reconciled. The admin procedure (adjust, then void) is documented in `docs/ADMIN_GUIDE.md`.
