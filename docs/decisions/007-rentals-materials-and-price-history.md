# ADR 007: Rentals Lifecycle, Append-Only Materials Ledger, and Price History Tracking

## Status
Accepted

## Context
SPACE EXSPACE requires:
1. **Rental Agreements**: Commercial contracts for heavy equipment rental (cranes, generators, containers, portable offices) with customer-specific negotiated rates that may differ from standard rate cards. The system must prevent renting the same machine to two customers concurrently.
2. **Materials Inventory**: Consumable supplies (metal sheets, electrical conduits, cables, paint, hydraulic oils) tracked by quantity with physical protection against negative stock on hand.
3. **Supplier Invoice Storage & Price History**: Received invoices stored with detailed line items, providing historical price fluctuation tracking over time for materials.

## Decisions

### 1. Frozen Applied Rates & Two-Layer Double-Booking Guard
- **Frozen Contract Rates**: Standard rate cards in `rates` provide default guidance, but the contract-agreed rate is permanently stored in `rental_items.applied_rate`. Future revisions to standard rate cards never rewrite past or active contractual agreements.
- **Two-Layer Double-Booking Prevention**:
  1. *Application Layer*: Pre-flight check against `v_equipment_current` to ensure all requested machines are currently `'available'`, returning human-readable HTTP 409 Conflict with the conflicting asset code if unavailable.
  2. *Database Engine Layer*: Partial unique index `uq_active_rental_item ON rental_items (equipment_id) WHERE returned_at IS NULL`. Even in the event of high-concurrency race conditions, the database engine physically rejects duplicate active rentals.
- **Action-Driven Dispatch and Return**:
  - `POST /api/rentals/:id/pickup`: Atomically updates status to `'picked_up'` and writes append-only rows to `location_log` transferring all machines to the client job site.
  - `POST /api/rentals/:id/return`: Atomically sets `returned_at = CURRENT_TIMESTAMP`, writes return entries to `location_log` checking machines back into the yard, and transitions rental status to `'returned'`.

### 2. Single-Entry, Signed, Append-Only Materials Ledger
- **No Mutable Stock Columns**: The `items` table does not contain an editable `stock_quantity` column.
- **Derived Stock on Hand**: Stock is computed dynamically as `SUM(qty)` across `stock_movements`.
  - `receipt` and `return`: Positive delta (`+qty`).
  - `issue`: Negative delta (`-qty`).
  - `adjustment`: Signed delta.
- **Zero-Deficit Guarantee**: A PostgreSQL `BEFORE INSERT` trigger (`trg_check_stock_movement_non_negative`) calculates `current_stock + NEW.qty`. If negative, it aborts the transaction before any write occurs, returning HTTP 400 with `INSUFFICIENT_STOCK`.

### 3. Price History Derived from Received Supplier Invoices
- Instead of maintaining a separate mutable `price_history` table that could drift from accounting documents, historical material prices are derived directly from the immutable lines of received supplier invoices:
  ```sql
  SELECT il.unit_price, il.quantity, inv.invoice_no, inv.invoice_date, p.name AS supplier_name
  FROM invoice_lines il
  JOIN invoices inv ON inv.id = il.invoice_id
  JOIN parties p ON p.id = inv.party_id
  WHERE il.item_id = $1 AND inv.direction = 'received'
  ORDER BY inv.invoice_date DESC;
  ```
- When a supplier invoice is recorded via `POST /api/invoices/supplier`, the API optionally writes corresponding `receipt` movements into `stock_movements` linked to `invoice_line_invoice_id` and `invoice_line_no`, synchronizing accounting and physical yard inventory in a single atomic transaction.

## Alternatives Considered & Rejected

1. **Mutable `items.current_stock` column with direct updates (`UPDATE items SET current_stock = current_stock - 5`)**:
   - *Rejected*: In high-concurrency yard environments, direct updates suffer from race conditions and destroy auditability. If the count looks incorrect, there is no ledger to prove who moved what material, when, or why.
2. **Double-entry bookkeeping ledger (debits and credits across chart of accounts)**:
   - *Rejected*: While double-entry is essential for general financial ledgers, inventory stock for a prototype tracker is best modeled as a single-entry signed quantity ledger (`+` receipt, `-` issue). True double-entry adds unnecessary complexity without adding value for yard workers.
3. **Separate standalone price tracking table**:
   - *Rejected*: Creating a `material_prices` table decoupled from invoices risks data divergence where entered prices don't match actual signed supplier bills. Deriving price history from real invoice lines guarantees that pricing records are backed by legal commercial documents.

## Consequences
- Every inventory change has a non-repudiable audit trail with timestamps and user IDs.
- Double-booking an asset is physically prevented by the PostgreSQL engine.
- Yard staff can issue materials and dispatch rentals without seeing commercial rates, discounts, or purchase prices.
