# ADR 008: Client-Generated UUIDs and Occurred-Time Event Ordering for Offline Sync

## Status
Accepted

## Context
SPACE EXSPACE field staff operate in industrial yards, remote desert construction sites, and steel fabrication workshops in the Eastern Province where cellular connectivity is intermittent or non-existent. When workers scan QR codes on cranes, relocate generators, check in returned equipment, or record consumable material movements while offline, those operations must be captured locally on the mobile device and safely replayed to the central API when internet connectivity returns.

This presents two foundational distributed systems challenges:
1. **Network Retries and Duplicate Replays**: Unstable mobile connections often drop right after an HTTP request is sent or right before an HTTP response is received. Mobile clients retry failed requests automatically. Without a deduplication mechanism, a single physical relocation could be inserted multiple times or trigger duplicate database side-effects.
2. **Out-of-Order Synchronization & Stale Devices**: Field workers in different yards or with different connectivity levels will sync at different times. If Worker A moves Crane #10 at 10:00 AM while online, and Worker B moved Crane #10 at 08:00 AM while offline and only syncs at 11:00 AM, a server-clock or arrival-time ordering (`ORDER BY recorded_at DESC` or `ORDER BY id DESC`) would overwrite Worker A's newer move with Worker B's older move, corrupting physical reality.

## Decisions

### 1. Client-Generated UUIDs as Natural Event Primary Keys
- Every offline action generated on the client must be tagged with a cryptographically random UUID v4 (`client_event_id`) at the exact millisecond the user confirms the action.
- The `sync_events` table uses `client_event_id UUID PRIMARY KEY`.
- **Idempotent Replay Contract**:
  - When the server receives an event, it queries `sync_events WHERE client_event_id = $1`.
  - If the record already exists, the server short-circuits execution, performs zero writes or state mutations, and returns the exact pre-computed `status` and `result` payload.
  - If concurrent duplicate requests race each other, the database primary key constraint rejects the second insert, guaranteeing exactly-once execution semantics.

### 2. Physical Occurred-Time Ordering (`occurred_at`) over Arrival Time (`recorded_at`)
- `location_log` and `stock_movements` are augmented with `recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`.
- The column `moved_at` represents `occurred_at`: the physical real-world timestamp when the action was executed on the ground in Dammam.
- `v_equipment_current` is updated to order latest location movements by:
  ```sql
  ORDER BY ll.equipment_id, ll.moved_at DESC, ll.recorded_at DESC, ll.id DESC
  ```
- **Consequence for Stale Devices**: If a mobile phone remains offline for hours or days and syncs a batch of old movements, those movements are safely preserved in the audit log, but `v_equipment_current` evaluates current location based on the latest physical occurrence (`moved_at DESC`). Stale offline devices cannot retroactively displace newer location transitions.

## Alternatives Considered & Rejected

1. **Server-Generated Event IDs (Sequential Auto-increment ID or Server UUID)**:
   - *Rejected*: If the client does not assign the ID before transmission, it cannot prove to the server that a retry is the exact same event rather than an intentional second action. The server would treat retried HTTP requests as separate events, leading to duplicate writes in `location_log` and double-deductions in `stock_movements`.
2. **Ordering by Server Receipt Time (`recorded_at DESC` / `id DESC`)**:
   - *Rejected*: In distributed field operations, arrival time at the server does not reflect physical reality. A stale offline device syncing an event from two days ago would overwrite an online movement performed five minutes ago, misreporting a crane's physical yard location.
3. **Natural Composite Keys for Deduplication (e.g. `hash(user_id, equipment_id, moved_at)`)**:
   - *Rejected*: Fragile and prone to false conflicts. If a technician legitimately moves two different pieces of equipment within the same second, composite timestamps can collide. UUID v4 provides 122 bits of client-side entropy with near-zero collision probability across millions of devices.

## Consequences
- Every staff action has an immutable, unique, idempotent identity.
- Network retries are completely safe and idempotent.
- Audit logs maintain complete visibility into both physical occurrence time (`moved_at`) and central system recording time (`recorded_at`).
- Stale syncs are safely integrated without corrupting active fleet locations in `v_equipment_current`.
