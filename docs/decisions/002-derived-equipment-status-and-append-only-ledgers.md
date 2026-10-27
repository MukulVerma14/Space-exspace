# ADR 002: Derived Equipment Status (SQL View) and Append-Only Inventory Ledgers

## Context
In industrial equipment rental yards and materials warehouses, operational data is frequently corrupted by concurrent updates, race conditions, and out-of-order data entry:
1. **Physical Equipment Status**: If an equipment record contains a mutable `status` column (`'available'`, `'rented'`, `'under_repair'`), developers and operators must manually synchronize this field whenever a rental contract is signed, an asset is dispatched to a job site, a repair ticket is opened, or a machine is returned. When two users act simultaneously (e.g., an office clerk marks a crane returned while a field mechanic flags it for maintenance), the mutable status column inevitably gets out of sync with actual operational reality.
2. **Materials Stock on Hand**: If an inventory table stores an editable `quantity_on_hand` integer, any manual edit, forgotten transaction rollback, or concurrent issue immediately destroys the audit trail. Discrepancies between physical inventory and ledger balances cannot be debugged.

## Decision
1. **Derived Equipment State (`v_equipment_current`)**:
   - The `equipment` table contains NO mutable `status` or `current_location_id` column.
   - Physical location is derived dynamically from the most recent row in `location_log`.
   - Operational status is computed deterministically in a SQL view:
     ```sql
     CASE
       WHEN active_rental.rental_id IS NOT NULL THEN 'rented'
       WHEN active_maintenance.maintenance_id IS NOT NULL THEN 'under_repair'
       ELSE 'available'
     END AS status
     ```
   - Field staff and office users never edit a status column. They execute physical actions (dispatch, move, return, open repair), which insert immutable event records.
2. **Append-Only Inventory Ledger (`stock_movements`)**:
   - Stock on hand is never an editable column. It is computed as `COALESCE(SUM(qty), 0)`.
   - Every physical material event (supplier invoice receipt, project issue, damaged adjustment, yard return) inserts an immutable signed ledger row.
   - A database trigger (`trg_check_stock_movement_non_negative`) rejects any `issue` transaction that would cause the running sum of inventory to drop below zero.

## Alternatives Considered
1. **Mutable Status Columns with Application Synchronization**:
   - *Why rejected*: Highly vulnerable to concurrency bugs and distributed state drift. If an Express API server crashes mid-request after creating a rental but before updating `equipment.status = 'rented'`, the database is permanently inconsistent.
2. **Scheduled Cron Job / Status Synchronizer**:
   - *Why rejected*: Polling the database every minute to "reconcile" status columns introduces a window of stale data where staff could rent or dispatch an asset that is already under repair.
3. **Editable `stock.quantity` Table with Separate Audit Log**:
   - *Why rejected*: Storing both a balance and an audit log creates two sources of truth. If a database administrator or script updates `quantity` directly without logging, the audit trail is broken. In contrast, an append-only ledger makes the audit log the sole source of truth.

## Consequences
### Positive
- **Single Source of Truth**: Impossible for an asset's status to disagree with open rental agreements or open repair orders.
- **Flawless Auditability**: Complete historical chain of custody for every piece of machinery and every bolt or cable in stock.
- **Physical Safety & Compliance**: Partial unique indexes (`WHERE returned_at IS NULL` and `WHERE closed_at IS NULL`) physically forbid double-booking equipment at the database engine level.

### Negative / Trade-offs
- Reading current equipment status requires evaluating a SQL View with `DISTINCT ON` and `LEFT JOIN`s. For 145 items (current fleet), this query executes in < 2ms. If the fleet scales to 50,000+ items, a materialized view with refresh triggers or read-model caching can be introduced without changing client-facing API contracts.
