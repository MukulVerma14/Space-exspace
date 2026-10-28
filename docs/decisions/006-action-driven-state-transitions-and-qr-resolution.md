# ADR 006: Action-Driven State Transitions and QR Code Natural Key Resolution

## Context
SPACE EXSPACE yard and field technicians operate mobile devices (PWA) to scan physical equipment in yards and customer sites across the Eastern Province. The business demands:
1. **Immediate State Visibility**: Scanning an asset QR code must instantly resolve the machine's model, technical specs, current location, custody chain, active rental contract (if rented), or active maintenance ticket (if broken).
2. **Elimination of Multi-Source Data Drift**: Equipment status must never become desynchronized from operational contracts or repair records.
3. **Auditability**: Every physical relocation or return must capture the user identity (`moved_by`), timestamp (`moved_at`), destination (`location_id`), and operational notes.
4. **Rate Confidentiality**: Technicians scanning machines in the yard must never see contract rental rates, rate card amounts, or repair expenditures.

## Decision
We implement **action-driven state transitions** combined with **natural key QR code resolution**:

1. **Natural Key (`asset_code`) QR Encoding**:
   - Physical QR labels printed and affixed to equipment encode the human-readable natural business key (e.g. `CRN-50-001`), NOT the database surrogate primary key integer (`id: 1`).
   - If database records are migrated, re-seeded, or re-indexed, existing physical QR labels on steel frames remain 100% valid.
   - Endpoint: `GET /api/equipment/:asset_code`.

2. **Zero Direct Status Mutation**:
   - The API strictly prohibits direct status updates (e.g. `PATCH /equipment/1` with `{ "status": "available" }`).
   - Status is exclusively derived by `v_equipment_current` from operational facts:
     - `rented` = an active rental item exists with `returned_at IS NULL` and rental status `'confirmed'` or `'picked_up'`.
     - `under_repair` = an open maintenance row exists with `closed_at IS NULL`.
     - `available` = neither exists.
   - Users transition state solely via explicit **domain actions**:
     - `POST /api/equipment/:asset_code/move`: Appends to `location_log`.
     - `POST /api/equipment/:asset_code/return`: Sets `rental_items.returned_at`, logs yard reception in `location_log`, optionally updates condition, and transitions rental status if all items are returned.
     - `POST /api/equipment/:asset_code/repair`: Verifies equipment is not actively rented, opens a `maintenance` order, logs relocation to workshop in `location_log`, and sets `condition = 'needs_repair'`.

3. **Atomic Multi-Table Transactions**:
   - Every action executes inside a database transaction (`BEGIN ... COMMIT / ROLLBACK`).
   - If any step fails (e.g. invalid location, constraint check, network partition), the entire operation rolls back, preventing corrupt partial state.

4. **Server-Side Financial Sanitization**:
   - While administrators retrieve full financial terms (active `applied_rate`, `discount_note`, standard `rates`, repair `cost`), staff responses pass through `sanitizeFinancials()` where all pricing fields are physically omitted before JSON serialization.

## Alternatives Considered

1. **Direct Status Mutation via REST (`PUT /api/equipment/:id` with `{ status: "available" }`)**:
   - *Why rejected*: Classic source-of-truth bug. If an operator sets `status = 'available'` while a rental agreement is still active in `rentals` and `rental_items`, the database contradicts itself. Double booking and ghost rentals inevitably occur.
2. **Surrogate Database ID in QR Code (`https://app.spaceexspace.com/scan/42`)**:
   - *Why rejected*: Surrogate integers are database implementation details. If the database is restored from a backup, exported/imported, or equipment records are re-seeded, IDs change while physical metal asset tags cannot be easily reprinted and restuck on 145 heavy machines across the desert. Natural business codes survive migrations.
3. **Single-Table Non-Transactional Execution**:
   - *Why rejected*: If a server crashes after setting `rental_items.returned_at` but before writing `location_log`, the crane would become available in the system without any record of which yard or site received it. Transactions ensure all writes succeed or none do.

## Consequences

### Positive
- **Guaranteed Single Source of Truth**: State cannot fall out of sync with rental contracts or work orders.
- **Durable QR Codes**: Asset code QR tags remain permanently valid across database resets and migrations.
- **Immutable Audit Trail**: Every movement or return records who did it, when, and where.
- **Enterprise Defense in Depth**: Rates remain strictly confidential even when staff scan rented equipment.

### Negative / Trade-offs
- Reading derived state from a view requires a relational join across `location_log`, `rental_items`, and `maintenance`. As verified in benchmarks, execution takes <1 ms for ~145 items, but will require materialized caching if fleet grows past 50,000 items.
