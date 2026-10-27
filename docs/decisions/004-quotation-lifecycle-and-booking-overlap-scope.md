# ADR 004: Quotation Lifecycle, Cancellation Item Freeing, and Future Booking Overlap Scope

## Context
In equipment rental operations:
1. **The Quotation Hole**: Clients frequently request price quotes before committing. If an item assigned to a draft quotation is marked as `'rented'` in the database view, or if a cancelled rental holds onto equipment indefinitely, available machinery is falsely reported as unavailable on the yard scanner and admin dashboard.
2. **Cancellation State Drift**: If an agreement is cancelled, application code might update `rentals.status = 'cancelled'`, but if it forgets to mark `rental_items.returned_at`, the database's partial unique index (`WHERE returned_at IS NULL`) continues to lock the equipment, preventing it from ever being assigned to another customer.
3. **Future Reservations vs Physical Yard Availability**: A prototype optimized for physical yard tracking tracks whether a machine is physically on site today. It does not necessarily manage a multi-week visual Gantt calendar preventing overlapping reservations in future months.

## Decision
1. **Strict Active Rental Status Derivation**:
   - `v_equipment_current` only considers a rental active if:
     ```sql
     ri.returned_at IS NULL AND r.status IN ('confirmed', 'picked_up')
     ```
   - Draft quotations (`status = 'quotation'`) and cancelled contracts (`status = 'cancelled'`) never cause equipment to derive `'rented'` status.
2. **Database-Level Cancellation Item Freeing**:
   - A PostgreSQL trigger (`trg_rental_status_change`) on `rentals` automatically sets `returned_at = CURRENT_TIMESTAMP` for all unreturned items whenever a rental transitions to `'cancelled'` or `'returned'`.
   - This atomically frees the partial unique index (`uq_active_rental_item`) and the derived view without requiring application-layer multi-step coordination.
3. **Explicit Scope on Overlapping Future Bookings**:
   - **Current Prototype Scope**: Enforces the business rule that a physical piece of equipment can have at most one concurrent active rental (`returned_at IS NULL`).
   - **Known Limitation**: Overlapping future bookings across different date ranges (e.g., booking Crane 1 for November 15-20 and another customer booking Crane 1 for November 18-25 while both are in status `'confirmed'`) are **NOT** prevented yet in this prototype.
   - **Production Roadmap**: Full calendar booking overlap prevention will be implemented using PostgreSQL's `btree_gist` extension with an exclusion constraint on `(equipment_id WITH =, daterange(start_date, expected_end, '[]') WITH &&)` where status is confirmed/picked_up.

## Alternatives Considered
1. **Allowing Quotations to Lock Equipment**:
   - *Why rejected*: Unconfirmed price inquiries would lock fleet machinery, preventing legitimate paying customers from renting available cranes.
2. **Application-Level Item Freeing on Rental Cancellation**:
   - *Why rejected*: If the application server fails between updating the rental header and updating child line items, the database is left in a corrupted state where a cancelled contract permanently locks the physical equipment. A database trigger guarantees atomicity.

## Consequences
### Positive
- Quotations can be prepared without artificially shrinking available yard inventory.
- Cancelling a rental immediately and reliably restores all of its equipment to `'available'`.
- Clear, honest architectural boundaries: we explicitly state what the prototype does (single active rental concurrency) and what is reserved for the future scheduling engine (calendar exclusion constraints).

### Negative / Trade-offs
- Multiple future confirmed rentals for the same asset at overlapping dates are not rejected at the database level in this prototype; conflict resolution must be checked at quotation confirmation time until exclusion constraints are added.
