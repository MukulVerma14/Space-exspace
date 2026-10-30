# ADR 011: Offline Client Lifecycle, Testing Strategy, and Initial Online Authentication Invariant

## Status
Accepted

## Context
As the Space Exspace platform expanded to support field operations in remote yards and construction sites with intermittent cellular coverage, architectural decisions were required regarding how mobile client sessions begin, how authentication is handled offline, and how developers and stakeholders verify offline resilience.

Three key architectural questions emerged:
1. **Can a user log in for the very first time without an internet connection?**
2. **How does the client maintain security and operational integrity while offline?**
3. **How can engineers and QA reliably simulate, test, and demonstrate offline synchronization without physical trips to desert cell dead zones?**

## Decisions

### 1. Invariant: First-Ever Login Strictly Requires Internet Connectivity
- **Server-Side Authentication Authority**: Passwords are encrypted with salt and hash algorithms (bcrypt) stored exclusively in the server PostgreSQL database (`users.password_hash`).
- **Cryptographic Token Issuance**: JWT access tokens are signed using the server's private secret key. A disconnected mobile client cannot authenticate plaintext credentials or forge a valid signed JWT token offline.
- **Decision**: The very first login on any device requires active network connectivity to reach `POST /api/auth/login`. Once authenticated:
  - The JWT token is securely cached in local storage.
  - The operational snapshot is fetched from `GET /api/sync/snapshot` and persisted to local IndexedDB or SQLite.
  - Subsequent field work can proceed entirely offline until the JWT token expires or is explicitly revoked.

### 2. Event Sourcing Outbox with Bi-Temporal Audit Ledgers
- While offline, staff actions (`equipment.move`, `equipment.return`, `equipment.repair`, `material.goods_received`, `material.issue`) are buffered locally in an indexed outbox queue.
- Every event carries:
  - A client-generated UUID primary key (`client_event_id: crypto.randomUUID()`).
  - An authenticated user ID (`user_id`).
  - The real physical timestamp (`occurred_at`).
- When connectivity resumes, the outbox is flushed via `POST /api/sync`.
- The database maintains bi-temporal tracking:
  - `moved_at` / `occurred_at`: When the event physically took place in the yard.
  - `recorded_at`: When the server received and committed the record.
- Derived state views (`v_equipment_current`) order strictly by `moved_at DESC, recorded_at DESC, id DESC`, ensuring stale devices syncing old moves can never overwrite newer physical relocations.

### 3. Developer & QA Simulation via Browser DevTools Network Emulation
- To eliminate the need for physical dead zones during testing and demonstration, the platform standardizes on browser DevTools Network Throttling (**Network > Throttling > Offline**).
- This faithfully simulates:
  - Immediate network request failures (`Failed to fetch` / `ERR_INTERNET_DISCONNECTED`).
  - Local client event buffering and UI optimistic updates.
  - Auto-reconnection detection via `window.addEventListener('online')` and batch replay flushing.
- Full demonstration steps are codified in `docs/DEMO.md`.

### 4. Comprehensive Automated Multi-Device Concurrency Test Suite
- Automated integration tests (`backend/src/__tests__/offline_events.test.ts`) programmatically execute:
  - Duplicate event replays (verifying idempotency and zero duplicate writes).
  - Out-of-order interleaved batch processing (verifying chronological ordering and independent transaction rollbacks).
  - Stale device synchronization conflicts (verifying `v_equipment_current` retention of newer moves).
  - Domain precondition validation at sync time (verifying rejection of unrented returns, negative stock overdraws, and double repair work orders).
  - Clock skew enforcement (rejecting events > 5 minutes in the future).
  - Server-side financial data stripping for staff roles.

## Alternatives Considered & Rejected

1. **Distributing User Password Hashes to Mobile Devices for Offline-First Login**:
   - *Rejected*: Distributing bcrypt hashes of corporate passwords to client mobile phones creates catastrophic credential vulnerability. If a device is lost, stolen, or extracted, password hashes could be subjected to offline dictionary and rainbow table attacks.
2. **Optimistic Local Stock Overwriting without Precondition Re-Verification**:
   - *Rejected*: Allowing a mobile device to unilaterally subtract inventory without server-side validation causes silent inventory drift and negative stock balances in central accounting.
3. **Dropping Rejected Events Silently**:
   - *Rejected*: Technicians must have visibility into why an action failed. Persisting rejection audit records in `sync_events` ensures full accountability and traceability.

## Consequences
- Uncompromising authentication security: Initial identity verification remains strictly server-bound.
- Complete audit transparency: Both accepted operations and rejected attempts are immutably preserved.
- Frictionless local testing: Engineers and product teams can verify offline workflows within seconds using standard browser DevTools.
