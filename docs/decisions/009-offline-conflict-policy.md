# ADR 009: Offline Conflict Resolution Policy & Batch Sync Architecture

## Status
Accepted

## Context
In field operations across Dammam, Jubail, and remote Eastern Province construction sites, multiple yard technicians operate on mobile devices that frequently lose cellular connectivity. Technicians scan QR codes to move cranes, return equipment from job sites, dispatch machines to workshops, or log consumables stock movements while completely offline.

This leads to distributed concurrency scenarios when connectivity is restored and batches are synced:
1. **Physical Relocation Conflict**: Worker A moves Crane #10 to Workshop at 08:30 AM while offline in Yard 1. Worker B moves Crane #10 to Yard 2 at 09:15 AM while offline in Yard 2. Both sync their batches later in the afternoon.
2. **Precondition Invalidation**: Worker A marks Crane #12 as returned at 10:00 AM while offline. Meanwhile, Worker B in the office had already processed the return or cancelled the rental at 09:45 AM.
3. **Consumable Inventory Depletion**: Worker A issues 10m of heavy cable while offline. Worker B issues 10m of the same cable online. When Worker A syncs, only 5m remains on hand in the central ledger.
4. **Malicious or Broken Device Clocks**: A device with a misconfigured clock in the year 2030 could emit movements that permanently dominate `v_equipment_current` due to `ORDER BY moved_at DESC`.

## Decisions

### 1. Last-Physical-Write-Wins (LWW) by `occurred_at` for Fleet Location
- When multiple offline moves for the same asset arrive at the server, all moves are preserved as immutable audit records in `location_log`.
- Current equipment status and location in `v_equipment_current` are derived using `ORDER BY ll.equipment_id, ll.moved_at DESC, ll.recorded_at DESC, ll.id DESC`.
- The physical action with the latest real-world occurrence time (`moved_at`) is authoritative. Physical reality in the yard trumps the time the device reached a cell tower.

### 2. Precondition Validation at Sync Time (No Blind Execution)
- Offline actions are intentions captured in the field, not unconditional database writes.
- Every event is re-validated against current system state at the millisecond of replay inside an isolated database transaction:
  - **`equipment.return`**: Re-verifies that an active rental exists (`returned_at IS NULL` and `status IN ('confirmed', 'picked_up')`). If the asset was already returned, the event is rejected with error code `NOT_RENTED`.
  - **`equipment.repair`**: Re-verifies that the asset is neither currently rented nor already under repair. If so, rejected with `EQUIPMENT_RENTED` or `ALREADY_UNDER_REPAIR`.
  - **`material.issue`**: Re-verifies that `current_stock + delta_qty >= 0`. If stock would go negative, rejected with `INSUFFICIENT_STOCK`.

### 3. Never Silently Drop a Rejected Event
- Silently ignoring failed offline events leads to lost technician work and untraceable inventory gaps.
- When an event is rejected, its failure reason and error code are permanently stored in `sync_events` with `status = 'rejected'` and `result = { error, message }`.
- The batch response returns an explicit per-event receipt (`status: 'rejected'`, `error`, `message`) so the mobile app can notify the worker and prompt appropriate physical reconciliation.

### 4. Per-Event Isolated Transactions in Occurred-Time Order
- Batches are capped at a maximum of 50 events (`MAX_BATCH_SIZE = 50`) to prevent transaction pool starvation.
- The server sorts incoming batch events by `occurred_at ASC` before processing.
- Each event runs in its own database transaction (`BEGIN ... COMMIT / ROLLBACK`). A failure in event #3 does NOT roll back valid events #1 and #2.

### 5. Clock-Skew Safeguard (5-Minute Threshold)
- Events with `occurred_at > NOW() + 5 minutes` are immediately rejected with error code `CLOCK_SKEW_EXCEEDED` and saved as rejected audit records.
- This prevents broken phone clocks or malicious tampering from poisoning the timeline in `v_equipment_current`.

### 6. User Identity Invariant
- The event's `user_id` must match the authenticated JWT token `req.user.id`. A staff worker cannot replay actions on behalf of another user account.

### 7. Server-Side Data Protection on Sync Responses
- All responses from `POST /api/sync` pass through `sanitizeFinancials(results, userRole)`. Staff workers replaying actions never receive commercial rental rates, invoice unit costs, or repair charges.

## Alternatives Considered & Rejected

1. **Rejecting the entire batch if one event fails (Atomic All-or-Nothing)**:
   - *Rejected*: In a batch of 20 physical moves performed over an 8-hour shift, one invalid return should not invalidate 19 legitimate physical relocations. Partial acceptance with per-event status is essential for field usability.
2. **Overwriting inventory to negative numbers and reconciling later**:
   - *Rejected*: Violates core client constraint: *\"prevent negative stock at all costs\"*. Physical inventory cannot be negative. Preconditions must block invalid deductions.
3. **First-Arrival-Wins (First to sync wins)**:
   - *Rejected*: Severely punishes technicians working in remote yards with worse cellular coverage. Real-world chronological order (`occurred_at`) must govern fleet status.

## Consequences
- Clean determinism: Event replay produces consistent state regardless of transmission order or retry frequency.
- Audit completeness: Both successful transitions and rejected attempts are immutably logged in `sync_events`.
- Conflict transparency: Yard staff are immediately alerted if an action failed preconditions rather than discovering discrepancies days later.
