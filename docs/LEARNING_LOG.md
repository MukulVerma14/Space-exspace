# Learning & Architectural Log

This document records every step of building the SPACE EXSPACE equipment and materials tracker. Each entry explains the technical choices, rejected alternatives, data flows, and interview-grade explanations.

---

## Corrections

- **Correction 1 (Fictionalized Entities & Mock Tax IDs)**: Renamed all seeded suppliers and customers to clearly fictional names (e.g., "Gulf Heavy Metals Trading", "Apex Infrastructure Partners"), replaced VAT IDs with obviously fake numbers (e.g., `100000000000001`, `200000000000001`), and removed all claims of real-world corporate or ZATCA-compliant registration across code, tests, and documentation.
- **Correction 2 (Ledger Terminology Precision)**: Replaced every occurrence of the term "double-entry ledger" with "single-entry, signed, append-only ledger" across documentation, code comments, and ADRs to accurately reflect that inventory transactions write a single signed numeric delta (`+` for receipt/return, `-` for issue) rather than debits and credits across multiple accounting accounts.
- **Correction 3 (Benchmark-Verified View Performance)**: Replaced the unverified "<2ms" claim in ADR 002 with empirical `EXPLAIN (ANALYZE, BUFFERS)` benchmarks measured on our PostgreSQL instance (cold planning: 43.8 ms, cold execution: 3.30 ms; warmed planning: 21.0 ms, warmed execution: 0.96 ms).
- **Correction 4 (Quotation Hole & Cancellation Item Freeing)**: Updated `v_equipment_current` so only rentals with `status IN ('confirmed', 'picked_up')` derive `'rented'` status (quotations no longer lock equipment), added a database trigger `trg_rental_status_change` that automatically sets `returned_at` upon rental cancellation/return to free items, created ADR 004, and documented that overlapping future calendar bookings are not prevented in this prototype.
- **Correction 5 (Scope Clarifications, Production Safeguard & Seed Alignment)**: Clarified that the 7 rented items belong to 2 active rentals containing 5 and 2 items respectively, added an explicit exception in `seed.ts` refusing execution when `NODE_ENV === 'production'`, and updated `OPEN_QUESTIONS.md` to document invoice store-vs-generate, PWA vs native app, staff-only vs customer portal, domain hosting, and rewrote the Odoo question as "which Odoo features should it resemble?".

---

## Step 0: Monorepo Scaffolding, Environment Validation, and Health Monitoring

### What we built:
- **Monorepo setup**: Structured `/backend`, `/frontend`, and `/docs` under an npm workspaces configuration.
- **PostgreSQL 16 container definition**: `docker-compose.yml` with healthchecks and persistent volume storage.
- **Fail-fast environment validation**: `backend/src/config/env.ts` using Zod to validate all required ports, database credentials, and security secrets at startup.
- **Observability & Logging**: Structured JSON logging using `pino` and `pino-http`, with human-readable formatting in development.
- **Health check endpoint**: `GET /health` in `backend/src/app.ts` verifying application uptime and live PostgreSQL connectivity.
- **Automated test suite**: Vitest and Supertest testing the `/health` endpoint under both healthy (200 OK) and degraded (503 Service Unavailable) database conditions.
- **Documentation skeleton**: Initialized `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md`, and `docs/decisions/001-no-orm-and-sql-migrations.md`.

### Why it exists:
- **Client Requirement**: Node.js + PostgreSQL + REST API foundation (**CONFIRMED**).
- **Production Readiness**: Field technicians and office staff rely on high system availability; a fail-fast startup and live `/health` probe ensure misconfigurations or database outages are caught instantly rather than failing during a yard operation.

### Why this way:
- **Direct SQL + `pg` driver instead of an ORM**: The core data model relies on partial unique indexes, database CHECK constraints, and derived SQL views (`v_equipment_current`). An ORM obscures these mechanisms or requires non-standard escape hatches (see [ADR 001](decisions/001-no-orm-and-sql-migrations.md)).
  - *Alternative 1 Rejected (Prisma ORM)*: Limited native support for PostgreSQL partial unique indexes (`WHERE returned_at IS NULL`) and dynamic SQL views without manual raw queries.
  - *Alternative 2 Rejected (Unvalidated `process.env`)*: Relying on raw `process.env.DB_PASSWORD` causes silent runtime errors hours or days later inside obscure request handlers instead of crashing immediately on boot.

### How it works:
1. When the backend starts (`npm run dev`), Node.js executes `src/server.ts`.
2. `src/server.ts` immediately imports `src/config/env.ts`, which reads `.env` and passes all variables through the Zod schema. If any variable is missing or malformed, the process halts immediately with exit code 1.\n3. Express configures Helmet security headers, CORS permissions, body parsers, and Pino HTTP logging.
4. When a monitoring agent or user requests `GET /health`, `app.ts` calls `checkDbHealth()`, which borrows a client from `pg.Pool` and executes `SELECT 1`.
5. If the database responds, `GET /health` responds with HTTP 200 and latency metrics; if unreachable, it returns HTTP 503 Service Unavailable.

### Concepts used:
- **Monorepo**: A single repository containing multiple related packages/projects (`backend`, `frontend`, `docs`) sharing root tooling and scripts.
- **Fail-fast system design**: Halting execution immediately at the earliest possible moment upon detecting an invalid state or missing configuration.
- **Connection pooling**: Maintaining a cache of reusable database connections to eliminate the latency and overhead of establishing new TCP/TLS connections on every HTTP request.
- **Health probe (`/health`)**: An HTTP endpoint queried periodically by orchestrators (like Docker or Kubernetes) to determine if a service is alive and ready to handle traffic.
- **Graceful shutdown**: Intercepting termination signals (`SIGTERM`, `SIGINT`) to finish inflight requests and close database connections cleanly before exiting.

### Risks and assumptions:
- **Assumption**: A PostgreSQL 16 instance is available locally or via Docker on port 5432 with default development credentials.
- **Risk**: If the client's network environment restricts Docker usage, running the local Windows PostgreSQL service or a cloud-hosted PostgreSQL instance will be required.

### 30-second explanation:
> *\"Before writing any business logic, we built a sturdy foundation. We set up an automated health check and strict startup checks. If a database password or key configuration is missing, the system catches it instantly and refuses to start with a clear error, instead of failing midway while a worker is trying to scan equipment in the yard.\"*

### Likely questions:
1. **\"Why use Zod for environment variables instead of just reading `process.env`?\"**
   *Answer*: `process.env` provides raw strings without type guarantees or presence validation. If an essential variable like `DB_PASSWORD` or `JWT_SECRET` is missing or misspelled, raw `process.env` produces `undefined`, which silently propagates until a user makes a request that triggers an obscure runtime crash. Zod guarantees that if the server boots, every single required configuration is present and structurally valid.
2. **\"Why did you choose raw PostgreSQL with `pg` instead of an ORM like Prisma or TypeORM?\"**
   *Answer*: SPACE EXSPACE's business rules rely heavily on PostgreSQL-specific features: partial unique indexes (ensuring an asset is only rented once concurrently), CHECK constraints (disallowing negative stock or backwards dates), and SQL views for derived asset status. ORMs abstract away these exact primitives, making the system harder to tune, explain, and audit.
3. **\"What happens to inflight user requests if the server process receives a restart or shutdown signal?\"**
   *Answer*: We implemented a graceful shutdown handler listening for `SIGTERM` and `SIGINT`. It stops accepting new connections, allows active HTTP requests to complete, safely drains and closes the PostgreSQL connection pool, and only then exits.

### How to verify:
1. Run backend tests:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: Vitest passes all tests for `GET /health` (both 200 OK and 503 degraded scenarios) and 404 handling.
2. Run TypeScript type checks:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: Clean compilation with 0 errors.

---

## Step 1: Relational Database Migrations, 3NF Normalization, Constraints, and Derived View

### What we built:
- **Comprehensive SQL migration (`1730000000000_initial_schema.sql`)**: 17 relational tables, partial unique indexes, check constraints, foreign keys with restrict/cascade rules, and rollback script.
- **Derived State SQL View (`v_equipment_current`)**: Unifies physical equipment metadata, latest location from immutable `location_log`, and derived status (`rented` if an active rental item exists in confirmed/picked_up status, `under_repair` if an open maintenance work order exists, otherwise `available`).
- **Inventory Ledger Non-Negative Trigger (`check_stock_movement_non_negative`)**: Prevents negative stock on hand at the database engine level before an `issue` movement can be inserted.
- **Automated Schema Verification Suite (`src/__tests__/schema.test.ts`)**: Rigorous Vitest tests verifying:
  1. Initial status derivation in `v_equipment_current`
  2. Quotations do not lock equipment or derive 'rented' status
  3. Cancelling a rental triggers automatic freeing of items
  4. Partial unique index enforcing that a crane cannot be rented to two clients simultaneously
  5. Partial unique index enforcing only one concurrent open repair per machine
  6. Non-negative inventory trigger rejecting stock deficits
- **Documentation**: Updated `docs/ARCHITECTURE.md` with a complete Mermaid Entity-Relationship (ER) diagram and created `docs/decisions/002-derived-equipment-status-and-append-only-ledgers.md`.

### Why it exists:
- **Client Requirements**:
  - Track ~145 equipment assets across yards and client sites (**CONFIRMED**).
  - Track materials inventory by quantity and prevent negative stock (**CONFIRMED**).
  - Allow standard rate cards but preserve negotiated applied rates per rental (**CONFIRMED**).
  - Store supplier and customer invoices and track purchase price history over time (**CONFIRMED**).
  - Two distinct roles (admin and staff) where staff scan QR codes and update status by physical action (**CONFIRMED**).

### Normalization Table by Table (Target: Third Normal Form / 3NF):
1. **`users` (3NF)**:
   - Primary Key: `id`. All attributes (`name`, `email`, `password_hash`, `role`, `active`) depend directly and solely on the primary key `id`.
   - No transitive dependencies.
2. **`equipment_types` (3NF)**:
   - Defines the broad category (e.g. "Hydraulic Rough-Terrain Crane") and standard `capacity_unit` ("ton").
   - Isolated from models to avoid repeating capacity units across hundreds of models.
3. **`equipment_models` (3NF — Transitive Dependency Elimination)**:
   - Contains `make`, `model`, and `capacity_value` (e.g. 50.00 tons).
   - *Why this is 3NF*: Capacity is a physical property of the *model*, not the individual physical asset. If capacity were stored on `equipment`, there would be a transitive dependency (`equipment_id` -> `model_id` -> `capacity_value`). If the manufacturer specs need correction, updating one model record fixes all 20 cranes of that model instantly without anomalies.
4. **`rates` (1NF & 3NF)**:
   - Composite PK: `(model_id, unit, valid_from)`.
   - *1NF compliance*: Instead of a repeating group of columns (`daily_rate`, `weekly_rate`, `monthly_rate`), rates are stored vertically with an atomic `unit` attribute.
   - *Historical auditability*: Old rates are never overwritten; new rates take effect via `valid_from`.
5. **`parties` (3NF — Generalization)**:
   - Single consolidated table for customers and suppliers. Avoids duplicating identical schema structures for contact person, phone, email, VAT registration number, and address. Flags `is_customer` and `is_supplier` allow one company (e.g., a subcontractor who also rents cranes) to be both.
6. **`locations` (3NF)**:
   - Represents physical yards, workshops, or client job sites.
   - Foreign key `party_id` optionally connects a `client_site` to its customer, ensuring site address normalization.
7. **`equipment` (3NF)**:
   - Primary Key: `id`. Natural business key: `asset_code` (unique).
   - Only physical asset-specific attributes are stored here: `model_id`, `serial_no`, `condition`, and `active`.
   - *Crucial*: Contains NO mutable `status` or `current_location_id` column, eliminating multi-source update anomalies.
8. **`location_log` (3NF & Append-Only Ledger)**:
   - PK: `id`. Stores every discrete movement event: `(equipment_id, location_id, moved_by, moved_at, note)`.
   - Never updated or deleted. Full tamper-proof audit trail for customer billing and operational disputes.
9. **`maintenance` (3NF)**:
   - PK: `id`. Tracks repair orders with `cost`, `description`, `opened_at`, and `closed_at`.
   - Partial unique index on `equipment_id WHERE closed_at IS NULL` guarantees an asset cannot have two simultaneous open repairs.
10. **`rentals` & `rental_items` (3NF & Financial Integrity)**:
    - Master-detail decomposition. `rentals` holds agreement-level attributes (`customer_id`, `site_id`, `dates`).
    - `rental_items` holds line items with `applied_rate` permanently frozen at contract creation.
    - *Why `applied_rate` is stored here*: If `rental_items` joined dynamically with the `rates` table to compute invoices, any future rate card adjustment would retroactively alter the financial records of past closed rentals.
    - Partial unique index on `rental_items(equipment_id) WHERE returned_at IS NULL` physically prevents double-booking an asset.
11. **`item_categories` & `units` (3NF)**:
    - Reference tables eliminating string duplication and measurement unit discrepancies (e.g., standardizing "mtr", "pcs", "kg").
12. **`items` (3NF)**:
    - Master SKU definitions for consumables (wires, conduits, paint, sheet metal). Contains `sku`, `name`, `category_id`, `unit_id`, `reorder_level`.
13. **`invoices` & `invoice_lines` (3NF)**:
    - Supports both issued (customer) and received (supplier) invoices.
    - `invoice_lines` records `quantity`, `unit_id`, and `unit_price`. Lines from supplier invoices provide an automated, immutable record of material price fluctuations over time.
14. **`stock_movements` (Single-Entry, Signed, Append-Only Ledger Pattern)**:
    - Stock is NEVER stored as a static, mutable number in `items`.
    - Every transaction (receipt from supplier, issue to workshop, adjustment, return) writes a signed row. Stock on hand is always `SUM(qty)`.
    - Database trigger ensures `SUM(qty)` can never drop below zero.

### Why this way:
- **Derived SQL View (`v_equipment_current`) instead of mutable status columns**:
  - *Alternative 1 Rejected (Mutable `equipment.status` column)*: If a server crashes or an unhandled exception occurs after a rental is recorded but before `equipment.status = 'rented'` is written, the database falls out of sync with reality. Derived state eliminates this failure mode entirely.
  - *Alternative 2 Rejected (Scheduled Cron Job Synchronizer)*: Polling every minute leaves a 60-second window where two users can dispatch the same crane.
  - *Alternative 3 Rejected (Prisma/ORM migrations)*: Cannot express partial unique indexes (`WHERE returned_at IS NULL`) natively, forcing clunky workarounds.

### How it works:
1. `npm run migrate:up` executes `1730000000000_initial_schema.sql` inside a single atomic PostgreSQL transaction.
2. When field staff scan an asset code `CRN-50-001`, the API queries `SELECT * FROM v_equipment_current WHERE asset_code = $1`.
3. The SQL view performs a `DISTINCT ON (equipment_id) ORDER BY moved_at DESC` subquery on `location_log` to fetch the current physical yard or site.
4. The view joins against `rental_items` where `returned_at IS NULL` and `r.status IN ('confirmed', 'picked_up')`, and `maintenance` where `closed_at IS NULL`.
5. If an open rental exists, `status` resolves to `'rented'`. If open maintenance exists, it resolves to `'under_repair'`. Otherwise, it resolves to `'available'`.
6. When an item of consumable material is issued, `BEFORE INSERT ON stock_movements` fires. The trigger calculates `current_stock + NEW.qty`. If negative, PostgreSQL raises an exception and aborts the transaction before any write occurs.

### Concepts used:
- **3NF (Third Normal Form)**: A database design standard where every non-key column is non-transitively dependent solely on the primary key ("the key, the whole key, and nothing but the key").
- **Partial Unique Index**: An index with a `WHERE` filter that enforces uniqueness only across rows matching that condition (e.g. only one active row where `returned_at IS NULL`).
- **Single-entry, signed, append-only ledger**: A data structure where records are only inserted and never updated or deleted, recording signed deltas (+ for receipt, - for issue) to provide complete historical traceability.
- **Derived state**: Dynamic computation of an entity's current condition from historical facts, avoiding duplicate sources of truth.
- **Database trigger**: Procedural code automatically executed by the database engine in response to specific data modification events (e.g. `BEFORE INSERT`).

### Risks and assumptions:
- **Assumption**: The active equipment fleet is ~145 items as confirmed by preliminary data. Evaluating `v_equipment_current` on 41 items takes ~0.96 ms warmed (3.30 ms cold) on local testing.
- **Risk**: If the fleet actually grows to 50,000+ items with millions of location log rows, querying `DISTINCT ON` on every request will eventually require a materialized view with refresh triggers. For the prototype and client demo, a standard view is optimal and free of cache-invalidation bugs.

### 30-second explanation:
> *\"Instead of having workers manually type whether a machine is 'available' or 'rented'—which causes human errors and double bookings—the database figures out the status automatically. If there is an active rental agreement that is confirmed or picked up, it is rented. If a repair ticket is open, it is under repair. If neither, it is available. And at the database level, it is physically impossible to rent a crane that is already checked out to another client.\"*

### Likely questions:
1. **\"Why didn't you put the equipment's current location and current status directly into the `equipment` table?\"**
   *Answer*: That would create two sources of truth. If someone updates the rental table or moves a crane, but the application crashes before updating the status column on the equipment table, the two records contradict each other. By deriving status and location dynamically from the audit logs and active rental contracts in `v_equipment_current`, the status is always mathematically guaranteed to match operational reality.
2. **\"Why do we store `applied_rate` on `rental_items` if we already have a `rates` table?\"**
   *Answer*: Standard rates change over time due to inflation or management decisions. If a customer signs a contract today for 1,200 SAR/day, and six months from now SPACE EXSPACE raises standard crane rates to 1,500 SAR/day, past rental contracts and customer invoices must still reflect the agreed 1,200 SAR. Storing `applied_rate` on the line item permanently seals the agreed financial transaction.
3. **\"How does the database prevent someone from issuing material when there isn't enough in the yard?\"**
   *Answer*: Materials are tracked in a single-entry, signed, append-only ledger (`stock_movements`), where stock on hand is `SUM(qty)`. We attached a PostgreSQL `BEFORE INSERT` trigger to `stock_movements`. If a technician attempts to issue 50 meters of conduit when only 20 are available, the trigger calculates the deficit and raises an immediate SQL error, rolling back the transaction before any bad data can be written.

### How to verify:
1. Run migration rollback and re-apply:
   ```bash
   npm --workspace=backend run migrate:down
   npm --workspace=backend run migrate:up
   ```
   *Expected Result*: Output confirms all 17 tables, indexes, triggers, and view are dropped and cleanly re-created.
2. Run automated test suite:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: All tests pass across `health.test.ts`, `schema.test.ts`, and `seed.test.ts`.
3. Run TypeScript type checks:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: `tsc --noEmit` exits with 0 errors.

---

## Step 2: Idempotent Realistic Database Seeding

### What we built:
- **Idempotent Seeding Engine (`backend/src/db/seed.ts`)**:
  - Production guard: Refuses to run if `NODE_ENV === 'production'`.
  - 2 seeded users (`admin@spaceexspace.com` with role `admin`, `staff@spaceexspace.com` with role `staff`), with real `bcrypt` password hashing (10 salt rounds).
  - 7 equipment types and 12 equipment models with realistic specifications (Tadano, Kato, Grove, Liebherr, Cummins, Caterpillar, CIMC, Space Modular, Kärcher).
  - Standard rate cards for hourly, daily, weekly, and monthly units in SAR.
  - 3 fictional suppliers (Gulf Heavy Metals Trading, Red Sea Industrial Hardware, Eastern Coatings & Primers) and 3 fictional customers (Apex Infrastructure Partners, Gulf Petrochemical Services, Al-Noor Commercial Contracting) with mock VAT numbers.
  - 7 operational locations (Central Dammam Yard, Jubail Yard, Dammam Fleet Workshop, Fleet Transit, and 3 project sites).
  - 41 individual equipment assets with unique asset codes (`CRN-50-001`, `GEN-250-001`, `CNT-20-001`, `OFF-40-001`, etc.) and initial location logs.
  - 3 rental scenarios: 2 active rentals containing 5 and 2 items respectively (total 7 items currently rented), and 1 historical returned rental.
  - Maintenance work orders: 2 open repair tickets (hydraulic winch seal rupture, outrigger cylinder loss) deriving `status = 'under_repair'`, and 1 closed historical repair.
  - 15 materials inventory SKUs (mild steel plates, armoured cables, flexible conduits, epoxy primers, welding rods, hydraulic oil) across 5 categories and 6 measurement units.
  - 2 full invoices with line items: 1 received supplier invoice with material purchase prices, and 1 issued customer invoice for crane rentals.
  - Initial stock ledger movements for all 15 materials, plus an issue movement, maintaining positive stock on hand.
- **Root and Backend npm Scripts**: Added `npm run seed` callable from anywhere in the monorepo.
- **Automated Verification Suite (`backend/src/__tests__/seed.test.ts`)**: Vitest tests proving end-to-end idempotency, production mode rejection, bcrypt authentication, status distribution in `v_equipment_current`, mock VAT compliance, and inventory balances.
- **Architectural Decision Records**: Created `docs/decisions/003-idempotent-seed-strategy-and-credential-security.md` and `docs/decisions/004-quotation-lifecycle-and-booking-overlap-scope.md`.

### Why it exists:
- **Client Requirement**: Realistic demonstration prototype representing actual Dammam/Eastern Province operations (**CONFIRMED**).
- **Two Roles**: Admin and staff users with segregated privileges (**CONFIRMED**).
- **Rate Cards & Frozen Applied Rates**: Standard rates with contract-specific applied rates (**CONFIRMED**).
- **Materials Inventory & Invoices**: Consumables ledger with supplier invoice line price tracking (**CONFIRMED**).

### Why this way:
- **Upsert / Natural Key Seeding instead of `TRUNCATE CASCADE`**:
  - *Alternative 1 Rejected (`TRUNCATE CASCADE` before insert)*: Wipes the entire database on every run. If an API server or developer has open database connections or is testing an in-progress flow, truncation destroys foreign keys and causes abrupt crashes. Upsert-based idempotency tests production-style write and update paths.
  - *Alternative 2 Rejected (Raw SQL dump / `.sql` file)*: Does not test runtime bcrypt hashing, Zod schemas, or dynamic foreign key resolution across dependent tables.
  - *Alternative 3 Rejected (Hardcoded plaintext passwords in Git)*: Pushing plaintext passwords into version control is an unacceptable security violation. Hashing with `bcrypt` in code and documenting the dev credentials only in `README.md` reflects industry-standard security.

### How it works:
1. `npm run seed` executes `src/db/seed.ts` inside a single PostgreSQL transaction (`BEGIN ... COMMIT`), verifying that `NODE_ENV !== 'production'`.
2. The seeder hashes development passwords with `bcrypt.hash('...', 10)` and upserts the two users.
3. Master reference data (types, models, rates, parties, locations, categories, units, items) is inserted using `ON CONFLICT (...) DO UPDATE` or natural key checks.
4. Equipment assets are inserted with unique `asset_code`s, and each receives an initial `location_log` record placing it in its initial yard or site.
5. The 3 rental agreements and rental items are linked. Because active rental items have `returned_at IS NULL` and status `'picked_up'`, the SQL view `v_equipment_current` immediately derives their status as `'rented'`.
6. Open maintenance records are inserted with `closed_at IS NULL`. For those specific machines, `v_equipment_current` immediately derives status as `'under_repair'`.
7. All remaining machines automatically evaluate to `'available'`.
8. Invoices and stock movements are written. If any error occurs anywhere during execution, `ROLLBACK` runs, leaving the database completely uncorrupted.

### Concepts used:
- **Idempotency**: An operation that produces the exact same outcome whether executed once or a hundred times consecutively, without error or side effects.
- **Bcrypt**: A salted, adaptive cryptographic hash function designed specifically for secure password storage.
- **Upsert**: A database operation that atomically inserts a new row or updates existing attributes if a unique constraint conflict is detected (`INSERT ... ON CONFLICT DO UPDATE`).
- **Natural key**: A real-world business identifier (such as `asset_code`, `email`, or `sku`) as opposed to a surrogate autoincrement ID.
- **Single-entry, signed, append-only ledger**: Inventory accounting where stock on hand is `SUM(qty)` of signed transaction rows.

### Risks and assumptions:
- **Assumption**: The prototype uses local development bcrypt hashing. In a production deployment, passwords will not be seeded via static strings; staff will be invited via email tokens or single sign-on (SSO).
- **Risk**: Overlapping future calendar reservations are not prevented at the database level in this prototype; only concurrent active rentals are enforced via `returned_at IS NULL`.

### 30-second explanation:
> *\"We built an idempotent demo seed script that loads the entire system with realistic industrial data from Dammam—crane models from Tadano and Liebherr, generators from Cummins, fictional industrial client sites, and mock tax IDs. Best of all, it's completely safe: you can run it as many times as you want before a client meeting or interview, and it will never crash, duplicate records, or run in production by mistake.\"*

### Likely questions:
1. **\"What does 'idempotent' mean in the context of a seed script, and why is it crucial?\"**
   *Answer*: Idempotency means running the script multiple times produces the exact same clean database state without crashing with unique constraint errors or creating duplicate records. In client demos or test pipelines, developers frequently need to reset or refresh sample data; an idempotent script guarantees that running `npm run seed` is always 100% safe.
2. **\"Why do we see 7 rented items, 2 under repair, and 32 available in `v_equipment_current` when the seed script never wrote the word 'available' or 'rented' into an equipment table?\"**
   *Answer*: That demonstrates our derived state architecture. The seed script created 2 active rentals containing 5 and 2 items respectively (7 items currently rented), and 2 open repair tickets with no close date at the Dammam workshop. The view joined these immutable events and mathematically derived the status on the fly. No two sources of truth exist.
3. **\"Where are the passwords for the admin and staff users stored, and how does the server authenticate them?\"**
   *Answer*: Plaintext passwords are never stored in the database. The seed script hashes them using `bcrypt` with 10 salt rounds and stores only the 60-character cryptographic hash in `users.password_hash`. When a user logs in, `bcrypt.compare` compares the supplied password with the hash. The dev passwords are documented solely in `README.md` for local testing.

### How to verify:
1. Run the seed script twice consecutively:
   ```bash
   npm run seed
   npm run seed
   ```
   *Expected Result*: Both runs log `✅ Database seeded successfully with realistic idempotent demo data!` with 0 errors.
2. Verify fleet status distribution:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: All 16 tests pass across `health.test.ts`, `schema.test.ts`, and `seed.test.ts`.
3. Verify TypeScript type checking:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: `tsc --noEmit` exits with code 0.

---

## Step 3: Auth, RBAC, and Server-Side Rate Serialization

### What we built:
- **Authentication Types (`backend/src/types/auth.ts`)**: Defined `UserRole` (`'admin' | 'staff'`), `AuthenticatedUser`, and `JwtTokenPayload`, while augmenting the Express `Request` interface with an optional `user` attribute.
- **Brute-Force Rate Limiting (`backend/src/middleware/rateLimiter.ts`)**: Throttles repeated failed requests to `POST /api/auth/login` to 10 attempts per 15 minutes per IP address (relaxed to 100 in test mode) using standard RFC headers.
- **Authentication & RBAC Middleware (`backend/src/middleware/auth.ts`)**:
  - `authenticate`: Validates the JWT Bearer token and verifies in PostgreSQL that the user account is active (`users.active = true`), enabling instant session revocation.
  - `requireRole(...roles)`: Restricts routes to authorized roles, returning HTTP 403 Forbidden for unauthorized requests.
- **Server-Side Financial Serializer (`backend/src/serializers/rateSerializer.ts`)**:
  - Recursive sanitizer function `sanitizeFinancials(data, userRole)`.
  - For any non-admin role (`staff`), it strips all sensitive financial and pricing keys (`applied_rate`, `rates`, `rate_card`, `amount`, `unit_price`, `unit_cost`, `subtotal`, `vat_amount`, `total`, `discount_note`, `cost`) directly from the JavaScript response object before serialization to JSON.
- **Auth & Rates Controllers & Routes**:
  - `POST /api/auth/login`: Zod-validated endpoint issuing an 8-hour JWT and user profile upon valid bcrypt password verification.
  - `GET /api/auth/me`: Authenticated endpoint returning current user claims.
  - `GET /api/rates`: Admin-only endpoint returning standard commercial rate cards (returns 403 Forbidden for staff).
  - `GET /api/rates/rental-quote-demo`: Endpoint accessible by both roles, demonstrating server-side sanitization where staff can view operational assignment details but rates and discounts are physically omitted.
- **Route Integration in App (`backend/src/app.ts`)**: Mounted `/api/auth` and `/api/rates`.
- **Architectural Decision Record**: Documented in `docs/decisions/005-server-side-rate-serialization-and-jwt-auth.md`.
- **Comprehensive Automated Test Suite (`backend/src/__tests__/auth.test.ts`)**: 14 tests verifying login, password comparison, deactivated account rejection, token validation, 403 role guards, server-side rate omission for staff, and unit tests on the serializer.

### Why it exists:
- **Client Requirement**: Two distinct roles: admin (full access incl. rates, rentals, invoices) and staff (scan + update location/status only) (**CONFIRMED**).
- **Confidential Commercial Terms**: Rental standard rates and client-negotiated applied rates are proprietary business secrets; staff in the yard must never see commercial rates (**CONFIRMED**).
- **Server-Enforced Security**: Client-side UI toggling (e.g. React `if (role === 'admin')`) is insecure because browser DevTools expose JSON network payloads. Defense in depth requires server-side serialization (**CONFIRMED**).

### Why this way:
- **Stateless JWTs with Database Active Verification + Server-Side Serializer**:
  - *Alternative 1 Rejected (Frontend-only conditional rendering)*: A client-side `v-if` or `{isAdmin && <Rate />}` leaves sensitive financial data visible in Chrome DevTools Network payloads or React component props.
  - *Alternative 2 Rejected (Separate database views for admin and staff)*: Creating `v_equipment_admin` and `v_equipment_staff` doubles view maintenance, risks synchronization drift, and clutters the database schema.
  - *Alternative 3 Rejected (Stateful server sessions with Redis)*: Adds infrastructure complexity (a Redis cache server) without justification for an early prototype with ~145 equipment assets.
  - *Alternative 4 Rejected (Pure stateless JWT without DB check)*: If a yard staff member is terminated or reassigned, a pure stateless JWT remains valid for its entire duration. By validating `users.active` on each request, deactivation takes effect instantly.

### How it works:
1. **Login Flow**:
   - Client sends `POST /api/auth/login` with `{ email, password }`.
   - `loginRateLimiter` ensures the IP has not exceeded the attempt threshold.
   - `login` controller parses credentials with Zod and retrieves the user from PostgreSQL.
   - `bcrypt.compare(password, user.password_hash)` verifies the password.
   - If valid and `user.active === true`, the server signs an 8-hour JWT (`HS256`) containing `{ sub: user.id, email, role, name }` and returns it alongside the user profile.
2. **Authenticated Request Flow**:
   - Client sends an HTTP request with `Authorization: Bearer <token>`.
   - `authenticate` middleware verifies the JWT cryptographic signature with `env.JWT_SECRET`.
   - `authenticate` executes an indexed query `SELECT active FROM users WHERE id = $1` to guarantee the account has not been deactivated.
   - Populates `req.user` with authenticated identity details and passes control to the next handler.
3. **Role Guard Flow**:
   - `requireRole('admin')` checks `req.user.role`.
   - If `'staff'`, it aborts the request immediately with HTTP 403 Forbidden.
4. **Server-Side Sanitization Flow**:
   - When an endpoint returning equipment or rental contracts is accessed (e.g. `GET /api/rates/rental-quote-demo`), the controller queries the full relational record.
   - Before calling `res.json()`, the data passes through `sanitizeFinancials(data, req.user.role)`.
   - If `role !== 'admin'`, a recursive traversal strips all keys present in `RESTRICTED_RATE_KEYS`.
   - The resulting JSON sent over the wire contains zero rate or monetary fields for staff users.

### Concepts used:
- **JWT (JSON Web Token)**: A compact, URL-safe means of representing signed claims between two parties.
- **RBAC (Role-Based Access Control)**: Restricting system access to authorized users based on their assigned organizational role.
- **Server-side serialization**: Filtering or restructuring data in the application backend before transmitting it over the network to prevent data leakage.
- **Rate limiting**: Restricting the frequency of requests to an endpoint within a given time window to protect against denial-of-service and brute-force attacks.
- **User enumeration prevention**: Returning uniform error messages (`Invalid email or password`) for both non-existent accounts and wrong passwords to prevent attackers from discovering valid usernames.

### Risks and assumptions:
- **Assumption**: 8-hour JWT token expiration matches standard yard shifts; users re-authenticate once per day.
- **Risk**: If new financial columns (e.g., `deposit_amount`, `insurance_fee`) are added to future tables, they must be registered in `RESTRICTED_RATE_KEYS` to avoid unintentional exposure to staff.
- **Performance Trade-off**: The database check in `authenticate` adds an indexed primary key lookup (~0.5ms) per authenticated request. This is intentional and necessary for immediate account revocation in this prototype.

### 30-second explanation:
> *\"We built a secure authentication system that gives office admins full control over equipment rates while physically preventing yard staff from seeing any financial figures. And unlike systems that just hide prices with CSS or JavaScript in the browser—where any curious worker can open browser Developer Tools and read the prices—our backend server strips all rates and prices from the network response before sending it. Even if staff inspect the raw network packets, the rates do not exist.\"*

### Likely questions:
1. **\"Why can't we just hide the rates in the React frontend using `{user.role === 'admin' && <RateDisplay />}`?\"**
   *Answer*: Hiding data in the frontend is cosmetic, not security. If the backend sends `{ asset_code: 'CRN-50-001', applied_rate: 1200.00 }`, anyone using Chrome DevTools or inspecting the network response can see the rate regardless of what the UI renders. True security requires server-side serialization so that sensitive financial keys are physically omitted before the JSON payload is transmitted over the network.
2. **\"Why does your JWT authentication middleware query PostgreSQL on every request if JWTs are supposed to be stateless?\"**
   *Answer*: While JWTs carry claims statelessly, pure stateless tokens have a serious flaw: if an employee is terminated and their access needs to be revoked immediately, the token remains valid until it expires. By doing a single indexed primary key query (`WHERE id = $1 AND active = true`), we achieve instant account revocation without losing the simplicity of JWT tokens.
3. **\"How does your system prevent brute-force password guessing attacks on the login endpoint?\"**
   *Answer*: We implemented IP-based rate limiting via `express-rate-limit` on `POST /api/auth/login`. It allows a maximum of 10 login attempts per 15-minute window per IP. If exceeded, it halts further attempts with HTTP 429 Too Many Requests. Additionally, login failures return an identical generic error message (`Invalid email or password`) to prevent username enumeration.

### How to verify:
1. Run all backend test suites:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: All 30 tests pass across `health.test.ts`, `schema.test.ts`, `seed.test.ts`, and `auth.test.ts`.
2. Run TypeScript compilation check:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: `tsc --noEmit` exits with 0 errors.

---

## Step 4: Equipment API, QR Code Resolution, and Action-Driven State Transitions

### What we built:
- **Equipment Controller (`backend/src/controllers/equipmentController.ts`)**:
  - `listEquipment`: Paginated fleet catalog with multi-facet filtering (`status`, `type_id`, `location_id`, `condition`) and case-insensitive substring search (`q`) across make, model, and asset code.
  - `getEquipmentByAssetCode`: Natural key QR scan resolution endpoint resolving `asset_code` (e.g. `CRN-50-001`) to complete physical specs, latest 10 movements from `location_log`, active rental agreement details (if rented), open maintenance order (if under repair), and commercial rate cards (scrubbed for staff via `sanitizeFinancials`).
  - `moveEquipment`: Physical relocation action recording a new immutable entry in `location_log`.
  - `returnEquipment`: Yard return action setting `rental_items.returned_at = NOW()`, logging a yard arrival in `location_log`, recording machine condition, and auto-updating rental status to `'returned'` when all items are checked in.
  - `sendToRepair`: Workshop dispatch action creating a new open row in `maintenance` (`closed_at IS NULL`), logging relocation to workshop in `location_log`, and setting condition to `'needs_repair'`.
- **Equipment Routing (`backend/src/routes/equipmentRoutes.ts`)**:
  - Mounted at `/api/equipment` in `backend/src/app.ts`.
  - Secured with JWT `authenticate` middleware. Staff role has permission to browse equipment, resolve QR scans, and trigger physical actions (`move`, `return`, `repair`).
- **Comprehensive Automated Test Suite (`backend/src/__tests__/equipment.test.ts`)**:
  - 14 integration tests covering listing, search, filtering, pagination, QR scan resolution, staff financial scrubbing, relocation, return with rental completion, maintenance opening, and 409 conflict checks.
- **Architectural Decision Record**: Documented in `docs/decisions/006-action-driven-state-transitions-and-qr-resolution.md`.
- **API Reference**: Updated `docs/API.md` with complete request/response schemas for `/api/equipment` endpoints.

### Why it exists:
- **Client Requirement**: Mobile access for yard staff to scan a QR code on an item, view details, and update location/status (**CONFIRMED**).
- **Client Requirement**: Web dashboard for office staff to search, filter, and inspect fleet inventory (**CONFIRMED**).
- **Client Requirement**: Staff must never see commercial rates or prices (**CONFIRMED**).
- **Architectural Principle**: Status is derived by physical actions, never by editing a status string (**CONFIRMED**).

### Why this way:
- **Action-Driven Endpoints instead of Generic CRUD / Status Mutation**:
  - *Alternative 1 Rejected (Generic `PATCH /api/equipment/:id` with `{ status: 'available' }`)*: Allowing direct mutation of a `status` field bypasses domain rules, breaks audit trails, and creates duplicate sources of truth. If a staff member marks a rented crane as "available" without returning the rental item, the rental contract still claims the crane is out, corrupting both billing and dispatch.
  - *Alternative 2 Rejected (Encoding Database Autoincrement ID in QR Codes e.g. `qr://equipment/42`)*: Surrogate integer IDs are internal database implementation details. If equipment data is re-seeded or migrated to another database cluster, surrogate IDs change and all physical stickers printed on 145 cranes and containers become useless. Natural keys (`asset_code` like `CRN-50-001`) survive database migrations and match the painted stencils on the machines.
  - *Alternative 3 Rejected (Separate non-transactional database updates)*: Returning equipment requires updating `rental_items`, inserting a `location_log` row, and updating equipment condition. If these are executed as separate queries without a transaction, a crash midway leaves an item in a broken, half-returned state. We execute all multi-table mutations inside atomic `BEGIN ... COMMIT` transactions.

### How it works:
1. **QR Scan & Resolution**:
   - Field worker scans the physical QR sticker on a crane with their phone camera.
   - The scanner decodes the natural string `CRN-50-001`.
   - The mobile PWA sends `GET /api/equipment/code/CRN-50-001`.
   - The server queries `v_equipment_current` to fetch specs, current yard/site, and derived status (`rented`, `available`, or `under_repair`).
   - The server concurrently fetches the last 10 location movements from `location_log`.
   - If the machine is rented, active rental contract details are attached. If under repair, open maintenance ticket details are attached.
   - If the requester is an admin, standard rate cards are included. If staff, `sanitizeFinancials` scrubs all rates and pricing before JSON transmission.
2. **Move Equipment**:
   - Staff selects a new location and submits `POST /api/equipment/:id/move` with `{ location_id, note }`.
   - The controller inserts a new row into `location_log(equipment_id, location_id, moved_by, moved_at, note)`.
   - The next query to `v_equipment_current` immediately reflects the new location because its `DISTINCT ON` subquery finds this latest movement row.
3. **Return Equipment**:
   - Staff returns a rented generator to a yard via `POST /api/equipment/:id/return` with `{ location_id, condition, note }`.
   - Inside an atomic transaction (`BEGIN`):
     - Sets `rental_items.returned_at = NOW()`.
     - Appends a return event in `location_log`.
     - Updates `equipment.condition`.
     - Checks if all items on the parent rental agreement have now returned; if so, updates `rentals.status = 'returned'`.
     - Commits the transaction (`COMMIT`).
   - When `v_equipment_current` is queried, `rental_items WHERE returned_at IS NULL` no longer matches this item, so its status immediately transitions from `'rented'` to `'available'` (or `'under_repair'` if damaged).
4. **Send to Repair**:
   - Staff flags a damaged machine via `POST /api/equipment/:id/repair` with `{ description, workshop_location_id, kind }`.
   - Inside a transaction:
     - Rejects the request if the machine already has an active repair (`409 Conflict`).
     - Inserts a new row in `maintenance(equipment_id, kind, description, opened_at, reported_by)`.
     - Inserts a relocation record in `location_log` moving the machine to the workshop.
     - Updates `equipment.condition = 'needs_repair'`.
   - `v_equipment_current` now sees an open maintenance record (`closed_at IS NULL`) and instantly derives `status = 'under_repair'`.

### Concepts used:
- **Action-driven architecture (Task-based API)**: Exposing intent-specific endpoints (`/move`, `/return`, `/repair`) representing real-world business actions rather than generic data-manipulation endpoints (`PUT /equipment/:id`).
- **Natural key resolution**: Looking up resources by permanent real-world identifiers (`asset_code`) rather than arbitrary internal database auto-increment IDs.
- **Atomic transaction**: A database sequence (`BEGIN ... COMMIT`) that guarantees all operations execute successfully together, or none execute at all (`ROLLBACK`), preventing corrupt partial states.
- **Single source of truth**: Architectural principle that state is stored in only one canonical place or derived from underlying events, eliminating conflicting records.
- **Paginated querying**: Returning subsets of large result sets using `LIMIT` and `OFFSET` (alongside `total` counts) to conserve memory and network bandwidth.

### Risks and assumptions:
- **Assumption**: QR stickers encode plain text natural keys (`CRN-50-001`) rather than complete URLs (`https://app.spaceexspace.com/equipment/CRN-50-001`). This keeps QR codes smaller, denser, and easier to scan with mobile cameras in bright Saudi sunlight or dusty yard conditions.
- **Risk**: Returning an item updates `rental_items.returned_at`, but doesn't calculate late return penalty fees or diesel refills. Those are handled at invoice generation time in office operations.

### 30-second explanation:
> *\"In our system, workers never edit a dropdown to say a crane is 'available' or 'rented'—because someone always forgets or picks the wrong option. Instead, the system mirrors reality: when a worker scans a crane's QR code and clicks 'Return to Yard', the server marks the rental agreement as returned and logs the machine's arrival at the Dammam yard. The database instantly recognizes the crane is back and marks it available for the next client automatically.\"*

### Likely questions:
1. **\"Why did you create separate endpoints for `/move`, `/return`, and `/repair` instead of a single `PATCH /api/equipment/:id` endpoint?\"**
   *Answer*: A generic `PATCH` endpoint allows clients to modify internal columns directly, which invites data corruption. If a client sends `PATCH /equipment/1` with `{ status: 'available' }`, the equipment status changes, but the rental item record still says it is on rent to a customer, creating a contradiction. Task-based action endpoints enforce real-world business workflows inside atomic transactions, guaranteeing that audit logs, rental lines, and maintenance tickets are updated in complete synchronization.
2. **\"Why does the QR code store the `asset_code` string rather than the database primary key `id`?\"**
   *Answer*: Primary keys (`id`) are internal surrogate integers generated by the database sequence. If we migrate data to a new database or re-seed the system, surrogate IDs can shift, which would invalidate all printed plastic QR stickers on 145 cranes and containers. Natural business keys like `CRN-50-001` are permanent, visible on physical stencils, and completely decoupled from database internals.
3. **\"What happens if a worker tries to send a crane to repair when it is already marked under repair?\"**
   *Answer*: The `sendToRepair` endpoint checks for an active maintenance ticket where `closed_at IS NULL` and returns HTTP 409 Conflict with the active ticket ID. Furthermore, our database schema enforces a partial unique index `idx_maintenance_active_unique` on `maintenance(equipment_id) WHERE closed_at IS NULL`, making it mathematically impossible to open duplicate concurrent repair tickets even under race conditions.

### How to verify:
1. Run all backend test suites:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: All 5 test suites pass cleanly (**44 tests passed**), including all 14 tests in `equipment.test.ts`.
2. Test QR code resolution directly via cURL or API client:
   ```bash
   # Log in as staff
   curl -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"staff@spaceexspace.com\",\"password\":\"Staff@12345\"}"
   # Scan equipment CRN-50-001 using the returned Bearer token
   curl -X GET http://localhost:5000/api/equipment/code/CRN-50-001 -H "Authorization: Bearer <TOKEN>"
   ```
   *Expected Result*: Returns complete equipment details, location history, and rental/repair status, with commercial rates stripped.

---

## Step 5: Rentals Lifecycle, Append-Only Materials Ledger, and Price History Tracking

### What we built:
- **Rentals Controller & Routes (`backend/src/controllers/rentalsController.ts`, `backend/src/routes/rentalsRoutes.ts`)**:
  - `listRentals`: Paginated list of rental contracts with status (`quotation`, `confirmed`, `picked_up`, `returned`, `cancelled`) and customer party details.
  - `getRentalById`: Detailed rental contract fetcher joining customer party, destination site, line items with physical equipment specs, and contract applied rates. Automatically scrubs pricing fields for staff callers via `sanitizeFinancials`.
  - `createRental`: Admin-only rental contract creation with multi-item equipment reservation. Enforces a two-layer double-booking prevention check: pre-flight validation against `v_equipment_current` and engine-level constraint enforcement. Freezes contract-agreed rates on `rental_items.applied_rate`.
  - `pickupRental`: Action-driven dispatch endpoint transitioning rental status to `'picked_up'` and writing append-only `location_log` entries moving all reserved equipment to the client job site.
  - `returnRental`: Action-driven yard return endpoint updating `rental_items.returned_at = CURRENT_TIMESTAMP`, logging return entries into `location_log` back into the yard, and updating rental status to `'returned'`.
- **Materials Controller & Routes (`backend/src/controllers/materialsController.ts`, `backend/src/routes/materialsRoutes.ts`)**:
  - `listMaterials`: Consumables catalog computing live stock on hand dynamically via `COALESCE(SUM(sm.qty), 0)` from `stock_movements`, with low-stock filtering (`low_stock=true`) comparing on-hand balance against `reorder_level`.
  - `getMaterialById`: Detailed SKU information with real-time stock balance.
  - `getMaterialMovements`: Paginated immutable transaction log of all receipts, issues, adjustments, and returns for a material item.
  - `recordStockMovement`: Endpoint allowing staff and admin to record physical stock transactions (`receipt`, `issue`, `adjustment`, `return`). Enforces signed numeric deltas and relies on PostgreSQL `BEFORE INSERT` trigger to reject any issue that would result in negative inventory (`INSUFFICIENT_STOCK`).
  - `getMaterialPriceHistory`: Admin-only endpoint returning purchase price trends and chronological unit costs directly derived from received supplier invoice lines. Staff callers are rejected with HTTP 403 Forbidden.
- **Invoices Controller & Routes (`backend/src/controllers/invoicesController.ts`, `backend/src/routes/invoicesRoutes.ts`)**:
  - `listInvoices`: Filterable list of commercial invoices by direction (`issued` or `received`) and payment status (`unpaid`, `part_paid`, `paid`).
  - `getInvoiceById`: Full invoice details with line items and party information.
  - `createSupplierInvoice`: Admin-only atomic invoice recorder that stores received supplier bills, creates invoice line items with purchase unit prices, and atomically logs corresponding positive `receipt` stock movements in `stock_movements`.
- **Express App Mount (`backend/src/app.ts`)**: Mounted `/api/rentals`, `/api/materials`, and `/api/invoices`.
- **Comprehensive Integration Test Suite (`backend/src/__tests__/rentals_materials.test.ts`)**: 11 integration tests covering rental creation, pre-flight and constraint double-booking prevention, equipment dispatch/return, staff financial redaction, dynamic material stock aggregation, negative inventory rejection (HTTP 400), supplier invoice creation with stock linkage, and price history derivation. Includes automated cleanup in `afterAll` to protect database isolation.
- **Architectural Decision Record**: Documented in `docs/decisions/007-rentals-materials-and-price-history.md`.
- **API Reference**: Updated `docs/API.md` with request/response schemas for all 13 new endpoints (23 total endpoints).

### Why it exists:
- **Client Requirement**: Rental standard rates exist (hourly/daily/weekly/monthly, SAR) but the agreed rate per rental can differ (**CONFIRMED**).
- **Client Requirement**: Materials tracked by quantity with protection against negative stock (**CONFIRMED**).
- **Client Requirement**: Invoices stored, and material prices tracked over time (**CONFIRMED**).
- **Client Requirement**: Admin full access (rates, rentals, invoices) vs Staff operational access only (**CONFIRMED**).
- **Assumed Requirement**: Both supplier invoices (received) and customer invoices (issued) exist; store invoices only, do not generate them (**ASSUMED**).

### Why this way:
- **Derived Stock on Hand (`SUM(qty)`) & Trigger Defense instead of Mutable Counters**:
  - *Alternative 1 Rejected (Mutable `items.current_stock` column)*: Updating a static counter (`UPDATE items SET current_stock = current_stock - 5`) destroys auditability. If the yard count disagrees with the screen, there is no immutable ledger to prove who moved what, when, or against which invoice. In our design, `SUM(qty)` guarantees 100% mathematical traceability.
  - *Alternative 2 Rejected (Separate Standalone `material_prices` Table)*: Maintaining a detached table for price tracking risks divergence from actual legal accounts payable documents. Deriving price history from `invoice_lines` where `direction = 'received'` ensures all recorded historical price points are backed by actual supplier invoices.
  - *Alternative 3 Rejected (Application-Only Stock Validation)*: Validating available quantity only in Node.js before issuing material creates race conditions: two yard technicians issuing 10 meters of cable concurrently when only 15 exist would both pass the JavaScript check. The PostgreSQL `BEFORE INSERT` trigger evaluates inside the database engine's lock, eliminating race conditions.

### How it works:
1. **Rental Contract Creation & Rate Freezing**:
   - Admin sends `POST /api/rentals` with customer ID, destination site, dates, and equipment line items with `applied_rate`.
   - Node.js queries `v_equipment_current` to ensure all machines are `'available'`. If any machine is rented or in repair, it returns HTTP 409 Conflict.
   - Inside an atomic transaction (`BEGIN`):
     - Inserts the master record into `rentals`.
     - Inserts line items into `rental_items`, storing the agreed `applied_rate`.
     - If concurrent requests attempt to book the same asset, the PostgreSQL partial unique index `uq_active_rental_item` rejects the second insert at the engine level.
2. **Equipment Dispatch (`/pickup`) & Yard Check-in (`/return`)**:
   - When cranes leave the yard, staff or admin calls `POST /api/rentals/:id/pickup`.
   - The transaction updates `rentals.status = 'picked_up'` and appends relocation rows to `location_log` placing each machine at the client site.
   - When the rental ends, calling `POST /api/rentals/:id/return` sets `rental_items.returned_at = CURRENT_TIMESTAMP`, writes return entries to `location_log` returning the machines to the yard, and updates rental status to `'returned'`.
   - `v_equipment_current` immediately reflects the items as `'available'`.
3. **Consumables Stock Movement & Zero-Deficit Trigger**:
   - User posts `POST /api/materials/:id/movements` with `{ qty: 10, type: 'issue' }`.
   - The controller converts `'issue'` to a signed negative number (`-10.000`) and issues `INSERT INTO stock_movements`.
   - The PostgreSQL `BEFORE INSERT` trigger calculates `current_stock + NEW.qty`. If less than zero, it raises an exception with message `Stock cannot become negative`.
   - The controller catches the trigger error and returns HTTP 400 Bad Request with code `INSUFFICIENT_STOCK`.
4. **Supplier Invoice Recording & Automatic Material Receipt**:
   - Admin sends `POST /api/invoices/supplier` with supplier ID, invoice number, totals, and lines.
   - In a single transaction:
     - The invoice and its `invoice_lines` are inserted.
     - For each line linked to an inventory `item_id`, an automatic `receipt` is logged in `stock_movements(item_id, qty, type, invoice_line_invoice_id, invoice_line_no, unit_cost)`.
     - Stock on hand increases automatically, and purchase price history is established immediately.

### Concepts used:
- **Two-layer concurrency guard**: Validating availability at the application layer for clear error messages, backed by a database unique constraint to prevent race conditions.
- **Frozen contractual rate**: Storing the negotiated price directly on the transaction line item so future master rate changes cannot rewrite accounting history.
- **Single-entry, signed, append-only ledger**: A data structure where records are only inserted and never updated or deleted, providing complete historical auditability.
- **Database trigger constraint**: A stored procedure executed by the database engine immediately before or after a data modification event to enforce complex invariants.
- **Derived price history**: Computing historical trends directly from primary transaction documents (supplier invoices) rather than a secondary cache.

### Risks and assumptions:
- **Assumption**: Rental agreements are stored for physical tracking and commercial documentation; generating customer PDF invoices or ZATCA XML e-invoices is out of scope for this prototype (**CONFIRMED**).
- **Risk**: Overlapping future reservations (e.g. reserving crane A for next month while crane A is rented this week) are not scheduled or calendar-blocked in this prototype; only concurrent physical rentals are prevented via `returned_at IS NULL`.
- **Performance Trade-off**: Aggregating `SUM(sm.qty)` across `stock_movements` on every material catalog query is fast for prototype volumes (<10,000 movements). At enterprise scale (millions of movements), this would require periodic balance snapshots or a materialized view.

### 30-second explanation:
> *"We built the complete rental lifecycle and materials inventory system. When a crane goes on rent, the agreed price is locked permanently so future rate increases never change old contracts. An asset can never be double-booked because the database physically blocks it. For materials like cables and paints, there is no editable stock counter that workers can tamper with; every single receipt and issue is logged, and the database makes it physically impossible to issue more material than what is physically in the yard."*

### Likely questions:
1. **"Why do we calculate stock on hand using `SUM(qty)` on `stock_movements` instead of an `items.current_stock` column?"**
   *Answer*: A mutable `current_stock` column creates audit black holes and concurrency bugs. If an inventory count drops by 20, nobody knows whether it was issued to a job, stolen, or accidentally updated by a user. By using a single-entry, signed, append-only ledger, the current balance is simply the mathematical sum of every physical movement. Every screw, cable, and drum of paint has an immutable audit trail showing who moved it, when, and against which invoice or work order.
2. **"How does the system prevent renting the same 50-ton crane to two different clients at the same time?"**
   *Answer*: We implement two layers of defense. First, the application queries `v_equipment_current` before creating a rental to return a friendly HTTP 409 Conflict if an asset is unavailable. Second, the database has a partial unique index: `CREATE UNIQUE INDEX uq_active_rental_item ON rental_items (equipment_id) WHERE returned_at IS NULL`. Even if two dispatchers click 'Confirm Rental' on the exact same millisecond, the database engine accepts the first and strictly aborts the second.
3. **"Where does material price tracking come from, and why didn't you build a separate price history table?"**
   *Answer*: Material price history is derived directly from the line items of received supplier invoices (`direction = 'received'`). If we created a separate `material_prices` table, someone could type in a price that doesn't match the actual bill received from the supplier. Deriving price history directly from registered supplier invoices guarantees that every price point displayed to management is backed by an actual legal purchase invoice.

### How to verify:
1. Run the entire automated test suite:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: All 6 test suites pass cleanly (**55 tests passed**), including all 11 tests in `rentals_materials.test.ts`.
2. Verify TypeScript type checking:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: `tsc --noEmit` exits with 0 errors.
3. Verify negative inventory rejection via API:
   - Attempting to issue more material than available in `stock_movements` returns HTTP 400 Bad Request with:
     ```json
     {
       "error": "INSUFFICIENT_STOCK",
       "message": "Stock cannot become negative"
     }
     ```

---

## Step O1: Idempotent Events, Client-Generated UUIDs, and Occurred-Time Ordering

### What we built:
- **Offline Events Ledger Migration (`backend/migrations/1730000000001_offline_sync_events.sql`)**:
  - `sync_events` table with client-generated UUID primary key (`client_event_id`), `user_id`, `type`, `payload` (JSONB), `status` (`accepted`, `rejected`, `duplicate`), `result` (JSONB), `occurred_at`, and `recorded_at`.
  - Added `recorded_at` column (`TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`) to both `location_log` and `stock_movements`.
  - Updated derived state view `v_equipment_current` to order location movements strictly by physical occurred time (`moved_at DESC, recorded_at DESC, id DESC`), ensuring a stale device syncing an old movement cannot overwrite a newer movement.
- **Sync Event Service (`backend/src/services/syncEventService.ts`)**:
  - `findSyncEventById`: Queries `sync_events` by `client_event_id` to detect previously processed events.
  - `persistSyncEvent`: Atomically writes the processed event and its outcome into `sync_events`.
- **Automated Verification Suite (`backend/src/__tests__/offline_events.test.ts`)**:
  - Integration tests verifying table schema, UUID primary key, status check constraints, presence of `recorded_at` in audit ledgers, event replay idempotency, and proof that a stale device syncing an old move at 08:00 AM does not displace a newer move at 10:00 AM in `v_equipment_current`.
- **Architectural Decision Record**: Documented in `docs/decisions/008-client-generated-uuids-and-offline-event-ordering.md`.

### Why it exists:
- **Client Requirement**: Mobile access for yard staff to scan a QR code and update location/status, functioning even in remote yards or basement workshops with intermittent or zero cellular connectivity (**CONFIRMED**).
- **Core Reliability**: Field staff will send actions when disconnected; when reconnected, network retries and duplicate transmissions must not create duplicate equipment movements or duplicate stock deductions (**CONFIRMED**).
- **Audit & Timeline Integrity**: Audit ledgers must track both when an event physically happened in the yard (`moved_at`) and when the server received and recorded it (`recorded_at`) (**CONFIRMED**).

### Why this way:
- **Client-Generated UUIDs & Occurred-Time Ordering instead of Server Timestamps**:
  - *Alternative 1 Rejected (Server-Assigned Sequential IDs)*: If the server generates IDs, the mobile device cannot tag its retried HTTP requests with an immutable identifier before sending them. A dropped TCP connection midway through an HTTP response would cause the phone to retry, creating two identical moves or double-deducting stock.
  - *Alternative 2 Rejected (Ordering by Server Arrival Time `recorded_at DESC` or `id DESC`)*: In field operations across Dammam and Jubail, workers go offline for hours. If Worker A relocates a crane at 10:00 AM while online, and Worker B moved it at 08:00 AM while offline and syncs at 11:00 AM, server-arrival ordering would overwrite Worker A's newer move with Worker B's older move.
  - *Alternative 3 Rejected (Natural Composite Keys e.g. `hash(user_id, equipment_id, timestamp)`)*: Easily collides if a worker moves multiple items within the same second or if clocks have coarse granularity. UUID v4 provides 122 bits of cryptographic randomness generated entirely on the device.

### How it works:
1. **Offline Capture**:
   - The field technician's device detects an offline state and saves the action locally.
   - The device assigns a fresh UUID v4 as `client_event_id` and records the current local device time as `occurred_at`.
2. **Sync / Replay**:
   - When connection is restored, the device posts the event with its `client_event_id`.
   - The server inspects `sync_events WHERE client_event_id = $1`.
   - If found, the server immediately returns the previously persisted `status` and `result`, performing zero writes to `location_log` or `stock_movements`.
   - If not found, the server processes the event, writes `location_log` with `moved_at = occurred_at` and `recorded_at = NOW()`, and records the result in `sync_events`.
3. **Timeline Resolution in `v_equipment_current`**:
   - The view executes `DISTINCT ON (equipment_id) ... ORDER BY ll.equipment_id, ll.moved_at DESC, ll.recorded_at DESC, ll.id DESC`.
   - Physical reality is preserved: the movement with the latest `moved_at` wins, regardless of when it arrived at the server.

### Concepts used:
- **Idempotency**: A property of an operation whereby it can be applied multiple times without changing the result beyond the initial application.
- **Client-generated UUID**: A unique identifier generated on the client prior to network transmission, allowing retries to reference the identical logical intent.
- **Bi-temporal data modeling**: Tracking two separate time dimensions for an event: business time (when it occurred in the real world: `moved_at`) and system time (when the database recorded it: `recorded_at`).
- **Last-Write-Wins (LWW) by physical occurrence**: Resolving conflicting state updates by selecting the event with the latest physical timestamp rather than server arrival time.
- **Idempotent replay ledger**: A database table storing the execution outcomes of previous requests to short-circuit repeated attempts.

### Risks and assumptions:
- **Assumption**: Device clocks on yard workers' mobile phones are reasonably accurate (synchronized via NTP or cellular networks). Step O2 introduces a 5-minute future clock skew safeguard.
- **Risk**: If two workers physically relocate the same machine while both are offline in different yards, the one with the later physical timestamp wins in `v_equipment_current`. This conflict resolution policy will be formally addressed in ADR 009 in Step O2.

### 30-second explanation:
> *"When a yard worker moves a crane while their phone has no signal, their phone assigns a unique fingerprint (a UUID) and marks the exact time the move happened. When they get back into Wi-Fi range and upload their work, the server checks if that fingerprint was already processed—so bad cellular connections never accidentally move a crane twice. And even if an old move from two hours ago uploads late, the database knows it's an old move and won't let it overwrite a newer move made by someone else."*

### Likely questions:
1. **"Why does the mobile app generate the event UUID instead of letting the PostgreSQL database generate it with `gen_random_uuid()`?"**
   *Answer*: If the server generates the ID, the client has no way to prove that a re-sent network request is a retry of the same action. If a mobile network connection drops right after the server processes an insert but before the phone receives the HTTP 200 response, the phone must retry. If the phone generates the UUID before transmitting, both attempts send the exact same UUID. The server recognizes the UUID on the second attempt, skips inserting, and returns the cached success response.
2. **"Why did we add `recorded_at` to `location_log` when we already had `moved_at`?"**
   *Answer*: This is the bi-temporal modeling pattern. `moved_at` represents real-world physical time—when the crane was unhooked and driven to the new yard. `recorded_at` represents database transaction time—when the central server actually found out about it. Having both is essential for operational audits: we can see that a crane was moved at 8:00 AM in the yard, but only synced to the office at 11:30 AM when the driver reached Wi-Fi.
3. **"What stops a phone with an incorrectly set future date (e.g. year 2030) from permanently locking an equipment's location in `v_equipment_current`?"**
   *Answer*: Because `v_equipment_current` orders by `moved_at DESC`, an event with a malicious or broken future timestamp would dominate the view. In Step O2, the sync endpoint enforces a clock-skew validation rule: any event with `occurred_at` more than 5 minutes in the future relative to server time is strictly rejected.

### How to verify:
1. Run all backend test suites:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: All 7 test suites pass cleanly (**59 tests passed**), including all 4 tests in `offline_events.test.ts`.
2. Verify TypeScript type checking:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: `tsc --noEmit` exits with 0 errors.


---

## Step O2: Batch Sync Endpoint, Precondition Guards, and Conflict Policy

### What we built:
- **Batch Sync Controller & Routes (`backend/src/controllers/syncController.ts`, `backend/src/routes/syncRoutes.ts`)**:
  - `POST /api/sync`: Accepts a batch of up to 50 offline events.
  - Sorts events strictly by physical timestamp (`occurred_at ASC`) before processing.
  - Processes each event inside an isolated database transaction (`BEGIN ... COMMIT / ROLLBACK`), ensuring that a failure in one event never rolls back other valid events.
  - Evaluates domain preconditions at sync time:
    - `equipment.move`: Validates asset and destination location exist; records move with `moved_at = occurred_at`.
    - `equipment.return`: Verifies the machine is actively rented; updates `rental_items.returned_at = occurred_at`, updates condition, records return location, and updates rental status.
    - `equipment.repair`: Checks that machine is not currently rented and not already under repair; creates `maintenance` record and workshop relocation.
    - `material.goods_received`: Replays quantity-only receipt into the single-entry append-only ledger with zero unit cost.
    - `material.issue`: Re-checks that stock on hand will not drop below zero before inserting negative delta.
  - Enforces authorization invariants: Event `user_id` must equal authenticated token `req.user.id` (rejects with `USER_MISMATCH`).
  - Enforces clock skew limit: Rejects any event with `occurred_at > NOW() + 5 minutes` (rejects with `CLOCK_SKEW_EXCEEDED`).
  - Idempotency check: If `client_event_id` was already processed, returns cached status `duplicate` with original result payload.
  - Non-dropping audit contract: Rejections are immediately persisted in `sync_events` with `status = 'rejected'` and descriptive error metadata.
  - Data protection: Passes all batch responses through `sanitizeFinancials(results, userRole)` so staff never receive commercial rates or costs.
- **Architectural Decision Record**: Documented in `docs/decisions/009-offline-conflict-policy.md`.
- **Automated Verification Suite (`backend/src/__tests__/offline_events.test.ts`)**: 10 comprehensive integration tests verifying unauthenticated 401, batch limits (>50 rejected), out-of-order replay, idempotent duplicate resends, user token mismatch rejection, clock skew rejection, unrented return rejection, negative stock rejection, staff rate stripping, and mixed success/failure batches.

### Why it exists:
- **Client Requirement**: Mobile access for yard staff to scan a QR code and update location/status, functioning even in remote yards or basement workshops with intermittent or zero cellular connectivity (**CONFIRMED**).
- **Client Requirement**: Two distinct roles (admin and staff) where staff scan QR codes and update status by physical action, without access to rates or prices (**CONFIRMED**).
- **Core Distributed Reliability**: Mobile devices can collect dozens of actions across an 8-hour shift. When re-connected, the server must process the batch deterministically, preserve audit history, and prevent invalid business transitions.

### Why this way:
- **Per-Event Isolated Transactions instead of Single Batch Transaction**:
  - *Alternative 1 Rejected (All-or-Nothing Batch Transaction)*: If a worker performs 25 equipment relocations and 1 invalid return, aborting all 25 valid relocations forces workers to re-scan equipment across the entire yard. Isolated per-event transactions maximize operational resilience in the field.
- **Precondition Verification at Sync Time instead of Blind Upsert**:
  - *Alternative 2 Rejected (Blindly Overwriting State)*: If another user already returned an item or issued all remaining cable while a device was offline, blindly applying the offline action would violate database constraints or corrupt inventory ledgers into negative numbers.
- **Explicit Rejection Audit instead of Silent Dropping**:
  - *Alternative 3 Rejected (Silent Drop / Ignore)*: If an event is rejected silently, workers have no visibility into why their screen doesn't match the physical yard. Persisting the rejection in `sync_events` guarantees full auditability for administrators.

### How it works:
1. Mobile device sends `POST /api/sync` with `{ events: [...] }` and Bearer JWT token.
2. The endpoint verifies authentication, checks that `events.length <= 50`, and validates individual schemas.
3. The server sorts events by `occurred_at ASC`.
4. For each event:
   - Validates that `event.user_id === req.user.id` and `occurred_at <= NOW() + 5m`.
   - Starts transaction `BEGIN`.
   - Queries `sync_events` for existing `client_event_id`. If found, rolls back and marks as `duplicate`.
   - Validates business preconditions (active rental check, non-negative stock check).
   - Executes the domain action (writing `location_log` or `stock_movements` with `moved_at = occurred_at`).
   - Persists the success record into `sync_events` and commits `COMMIT`.
   - If an error occurs, rolls back `ROLLBACK`, persists the rejection audit row into `sync_events`, and records `status: 'rejected'`.
5. The endpoint sanitizes financial fields for staff users and returns HTTP 200 with per-event receipts.

### Concepts used:
- **Event Sourcing / CQRS Inspiration**: Treating offline actions as a stream of immutable historical domain events applied in business occurrence order.
- **Fail-Partial Architecture**: Allowing valid batch operations to succeed while cleanly capturing and reporting individual failures.
- **Clock Skew Tolerance**: Accepting reasonable device clock drift (up to 5 minutes into the future) while rejecting egregiously erroneous timestamps.
- **Server-Side Sanitization**: Stripping confidential commercial rates before sending responses to staff clients.

### Risks and assumptions:
- **Assumption**: Network connection is restored at least once per work shift to prevent unbounded event backlogs.
- **Risk**: If two staff members attempt to issue the last remaining drum of hydraulic oil while both are offline, the first one to sync will succeed; the second will be rejected with `INSUFFICIENT_STOCK`. The field team must perform physical stock reconciliation for rejected movements.

### 30-second explanation:
> *"We built the batch sync endpoint that receives up to 50 offline worker actions at once. The server sorts them so they execute in the exact order they happened in the yard, each inside its own safety box. If an action fails—like trying to return equipment that was already returned or issuing material that ran out—the server doesn't crash or throw away the rest of the worker's shift. It executes every valid move, records why the invalid one failed, and never reveals confidential commercial prices to staff."*

### Likely questions:
1. **"What happens if two yard workers move the same crane to different yards while both are offline?"**
   *Answer*: Both movements are saved permanently in `location_log` as an audit trail. However, `v_equipment_current` orders movements strictly by `moved_at DESC` (when the action physically occurred). Whichever worker physically moved the crane later in real time will be reflected as the machine's current location once synced.
2. **"Why does the server reject events with an `occurred_at` timestamp more than 5 minutes in the future?"**
   *Answer*: Because `v_equipment_current` chooses the latest location based on `moved_at DESC`, a phone with a faulty clock set to the year 2030 would insert a record that permanently locks the crane's location for the next four years. The 5-minute future skew limit prevents clock drifts or tampering from poisoning the derived view.
3. **"Why does `POST /api/sync` run each event in its own transaction instead of wrapping all 50 events in one big transaction?"**
   *Answer*: If a technician scans 40 pieces of equipment during an 8-hour shift and makes a mistake on the 41st, wrapping the entire batch in one transaction would roll back all 40 successful scans. Isolated per-event transactions guarantee that valid physical work is never discarded due to an isolated precondition error.

### How to verify:
1. Run all backend test suites:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: All 7 test suites pass cleanly (**69 tests passed**, including all 14 tests in `offline_events.test.ts`).
2. Run TypeScript compiler checks:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: `tsc --noEmit` exits with 0 errors.

---

## Step O3: Role-Based Read Snapshots and ETag Caching

### What we built:
- **Read Snapshot Endpoint (`GET /api/sync/snapshot`)**:
  - Implemented `getSyncSnapshot` in `backend/src/controllers/syncController.ts` and mounted in `backend/src/routes/syncRoutes.ts`.
  - Accessible to authenticated Staff and Admin roles.
  - Returns unified operational data needed for offline field operation:
    - `equipment`: Derived fleet status and current location directly from `v_equipment_current`.
    - `locations`: Active operational sites (yards, client sites, workshops).
    - `materials`: Items catalog with real-time `stock_on_hand` calculated from the append-only `stock_movements` ledger.
    - `server_time`: UTC ISO 8601 server timestamp allowing mobile devices to calculate and compensate for local clock drift.
    - `etag`: Deterministic SHA-256 content hash of the role-sanitized data payload.
- **HTTP 304 Not Modified Caching**:
  - Evaluates standard `If-None-Match` HTTP request header against the calculated snapshot ETag.
  - When operational data has not changed, immediately returns HTTP `304 Not Modified` with zero response body, minimizing cellular bandwidth consumption and mobile battery usage.
  - Emits fresh HTTP 200 responses with an updated ETag as soon as equipment relocates, status transitions, or inventory movements occur.
- **Strict Role-Based Data Minimization (Defense-in-Depth)**:
  - Enforces `sanitizeFinancials(rawSnapshot, userRole)` on all snapshot responses.
  - Staff responses physically strip all commercial rate cards, rental rates, unit costs, invoice prices, and repair costs (`applied_rate`, `unit_cost`, `unit_price`, `cost`, `standard_rates`, `vat_included`).
  - Admin responses include `standard_rates` for reference during quotations and rate management.
- **Architectural Decision Record**: Documented in `docs/decisions/010-role-based-read-snapshots-and-etag-caching.md`.
- **Automated Verification Suite (`backend/src/__tests__/offline_events.test.ts`)**:
  - 6 new automated integration tests verifying:
    1. Unauthenticated requests return HTTP 401.
    2. Staff snapshot includes active equipment, locations, materials with current stock, server timestamp, and ETag header.
    3. Staff snapshot contains zero financial or rate fields anywhere in the serialized JSON.
    4. Admin snapshot contains `standard_rates` table.
    5. Conditional GET with matching `If-None-Match` header returns HTTP 304 with empty body.
    6. Database state mutations (inventory stock movements) cause the server to emit a fresh HTTP 200 with an updated ETag.

### Why it exists:
- **Client Requirement**: Mobile access for yard staff to scan a QR code and update location/status, functioning even in remote yards or basement workshops with intermittent or zero cellular connectivity (**CONFIRMED**).
- **Client Requirement**: Two distinct roles (admin and staff) where staff scan QR codes and update status by physical action, without access to rates or prices (**CONFIRMED**).
- **Core Mobile Offline Performance**: Before heading into dead zones, field devices must download an authoritative, lightweight baseline of available machines and consumable stock. Re-fetching full datasets every few minutes drains mobile battery and cellular data quotas; conditional ETag caching ensures instant validation with near-zero data transfer.

### Why this way:
- **Consolidated Snapshot instead of Multiple REST Queries**:
  - *Alternative 1 Rejected (Separate Endpoints for /equipment, /locations, /materials)*: Making multiple HTTP roundtrips over spotty 3G/LTE connections increases connection latency, risks partial downloads, and complicates cache invalidation across interdependent entities. A single consolidated snapshot provides atomic state synchronization.
- **Server-Side Financial Stripping instead of Client-Side Masking**:
  - *Alternative 2 Rejected (Hiding Rates via Frontend CSS/UI)*: Storing sensitive commercial hire rates or vendor purchase prices on staff mobile devices creates massive security exposure. Server-side stripping guarantees that even if a technician's device is decompiled or inspected offline, commercial rate cards are not present.
- **Deterministic Content Hash ETag instead of Server Modification Timestamps**:
  - *Alternative 3 Rejected (Last-Modified Header)*: PostgreSQL rows across multiple tables (`equipment`, `location_log`, `rentals`, `items`, `stock_movements`) have distinct timestamps. A SHA-256 hash of the sanitized JSON structure produces an unambiguous, collision-resistant ETag that changes only when meaningful data changes.

### How it works:
1. Mobile device connects and sends `GET /api/sync/snapshot` with Bearer JWT token.
2. The server verifies caller role (`staff` or `admin`).
3. The server concurrently executes:
   - Query to `v_equipment_current` for active fleet status and locations.
   - Query to `locations` for active operational sites.
   - Query to `items` joined with `stock_movements` to aggregate `stock_on_hand`.
   - If admin, queries `rates` table for standard rate cards.
4. The server passes the aggregated object through `sanitizeFinancials()`.
5. The server computes `sha256(JSON.stringify(sanitizedSnapshot)).substring(0, 32)` and formats it as `W/"<hash>"`.
6. If the client sent `If-None-Match` matching this hash:
   - Server returns HTTP 304 Not Modified immediately.
7. Otherwise:
   - Server returns HTTP 200 with `server_time`, `etag`, and the sanitized snapshot payload.

### Concepts used:
- **HTTP Conditional Requests & Cache Validation**: Standard RFC 7232 ETag and `If-None-Match` protocol for efficient bandwidth conservation.
- **Server-Side Data Minimization**: Enforcing security boundaries at the API layer so sensitive commercial numbers never travel to unauthorized tiers.
- **Authoritative Clock Synchronization**: Providing server UTC time in read snapshots so clients can calculate skew deltas before logging field actions.
- **Single-Source Aggregated Derived State**: Sourcing equipment locations from `v_equipment_current` and inventory balances from `stock_movements` ledgers rather than separate caching tables.

### Risks and assumptions:
- **Assumption**: Field technicians perform initial login and initial snapshot synchronization while they have internet access before leaving the office or yard dispatch area.
- **Scale Consideration**: For thousands of assets, downloading the snapshot payload takes <150KB of JSON. At enterprise scale (tens of thousands of assets), snapshots can be scoped by assigned geographic yard or division.

### 30-second explanation:
> *"We built the read snapshot system that field phones use to download their offline toolkit. When a yard worker opens the app, it pulls the current status and location of all equipment, yards, and available materials without downloading a single commercial price or rental rate. If the worker's phone already has the latest data, the server answers with a 304 Not Modified code that transfers zero bytes, preserving battery and mobile data."*

### Likely questions:
1. **"Can a staff member inspect the local storage or network packets on their phone to see client rental rates or equipment prices?"**
   *Answer*: No. The server applies `sanitizeFinancials` directly to the snapshot data before serializing it or sending it over HTTP. Staff snapshots physically omit all rate, price, and cost fields.
2. **"Why does the snapshot include an ETag and accept `If-None-Match`?"**
   *Answer*: Technicians frequently enter and leave cellular coverage zones. If the mobile app re-downloaded the entire equipment list and inventory catalog every time cellular signal returned, it would waste bandwidth and drain battery. By sending `If-None-Match: <etag>`, the server checks in milliseconds if anything changed; if not, it returns HTTP 304 with no body.
3. **"Why is `server_time` included in the snapshot response?"**
   *Answer*: Mobile phone clocks often drift by minutes or hours due to manual adjustments or roaming between cell networks. When the app receives `server_time`, it calculates the difference between its local clock and the server clock, allowing it to record field actions with accurate physical occurrence times and avoid clock-skew rejections.

### How to verify:
1. Run all backend automated test suites:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: All 7 test suites pass cleanly (**75 tests passed**, including all 20 tests in `offline_events.test.ts`).
2. Verify TypeScript type checking:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: `tsc --noEmit` exits with 0 errors.
3. Verify ETag caching via curl:
   ```bash
   # 1. Fetch initial snapshot
   curl -i -H "Authorization: Bearer <STAFF_JWT>" http://localhost:3000/api/sync/snapshot
   # Note ETag header value: W/"..."

   # 2. Re-fetch with If-None-Match
   curl -i -H "Authorization: Bearer <STAFF_JWT>" -H 'If-None-Match: W/"..."' http://localhost:3000/api/sync/snapshot
   # Expected: HTTP/1.1 304 Not Modified
   ```

---

## Step O4: Comprehensive Offline Test Suite, Multi-Device Concurrency, and DevTools Demo Guide

### What we built:
- **Comprehensive Integration Test Suite (`backend/src/__tests__/offline_events.test.ts`)**:
  - Expanded the offline events test suite to **24 thorough integration tests** covering all critical field failure modes:
    1. **Stale Device Syncing an Old Move**: Worker A moves a crane offline at 08:00 AM; Worker B moves the crane online at 09:30 AM to a workshop. Worker B's move syncs first; Worker A's move syncs later at 11:00 AM. The test proves Worker A's move is accepted into `location_log` for auditability, but `v_equipment_current` strictly preserves the Workshop location because 09:30 AM > 08:00 AM.
    2. **Out-of-Order Interleaved Batch Replay**: An offline batch containing valid receipts, valid issues, and an overdraw issue sent intentionally in non-chronological order. Proves the server sorts by `occurred_at ASC`, executes valid transactions, rejects the overdraw with `INSUFFICIENT_STOCK`, and updates the inventory ledger accurately without dropping events.
    3. **Batch Idempotency Across Multiple Replays**: A multi-event batch re-executed identically returns `status: 'duplicate'` with matching stored results and zero duplicate rows written to `location_log` or `stock_movements`.
    4. **Domain Precondition Rejection (Double Repair)**: Rejects sending an asset to repair if it is already under an active maintenance work order (`ALREADY_UNDER_REPAIR`) and records the failure in `sync_events`.
- **End-to-End Offline Demonstration Guide (`docs/DEMO.md`)**:
  - Comprehensive guide documenting how to simulate offline field conditions using Browser DevTools (**Network > Throttling > Offline**).
  - Detailed 7-step walkthrough covering initial login, snapshot caching, offline queuing, auto-reconnection flushing, idempotency proofs, multi-device conflict resolution, and HTTP 304 ETag caching.
  - **Explicit Invariant Documented**: Highlights that the very first login strictly requires internet connectivity for server-side credential verification and JWT issuance before heading into offline coverage zones.
- **Architectural Decision Record**: Documented in `docs/decisions/011-offline-client-lifecycle-and-first-login-dependency.md`.

### Why it exists:
- **Client Requirement**: Mobile access for yard staff to scan a QR code and update location/status, functioning even in remote yards or basement workshops with intermittent or zero cellular connectivity (**CONFIRMED**).
- **Client Requirement**: High operational reliability where network drops and device clock differences never corrupt inventory ledgers or misplace heavy fleet assets (**CONFIRMED**).
- **Demonstrability & Verification**: Product owners, stakeholders, and developers need an authoritative, repeatable procedure to test offline workflows on local machines without driving to remote dead zones.

### Why this way:
- **Automated Integration Testing over Unit Mocking**:
  - *Alternative 1 Rejected (Mocking DB queries in unit tests)*: Multi-device concurrency, timestamp ordering in PostgreSQL views, and transaction rollbacks cannot be reliably verified with in-memory mocks. Testing against the real PostgreSQL database engine proves true runtime correctness.
- **Browser DevTools Emulation over Physical Airplane Mode**:
  - *Alternative 2 Rejected (Requiring physical Wi-Fi disconnections)*: Browser DevTools network throttling provides a standardized, zero-hardware environment for developers and testers to observe network error handling, IndexedDB queuing, and batch flushing.

### How it works:
1. Technicians authenticate online once to receive their JWT token and cache the initial operational snapshot (`GET /api/sync/snapshot`).
2. Technicians enter offline areas. Physical scans and issues are recorded locally in IndexedDB with client-generated UUIDs and timestamps.
3. Upon reconnecting, the client flushes queued events to `POST /api/sync`.
4. The server validates and processes events in chronological order, isolating each event in a distinct transaction.
5. If another technician moved the asset at a later physical time, `v_equipment_current` retains the latest location while storing both movements in the audit log.
6. The client receives explicit per-event statuses (`accepted`, `duplicate`, `rejected`) and updates its local UI accordingly.

### Concepts used:
- **Bi-Temporal Concurrency Ordering**: Using physical occurrence time (`moved_at`) for current operational state while recording system arrival time (`recorded_at`) for audit compliance.
- **Fail-Partial Transaction Isolation**: Processing batch items in independent transactions so valid field entries are never rolled back by an adjacent precondition failure.
- **Browser Network Throttling Emulation**: Leveraging Chromium/WebKit DevTools network stack interception to simulate field cellular dead zones.
- **Zero-Trust Client Authentication**: Enforcing server-side credential validation and cryptographic token issuance rather than storing password hashes on mobile clients.

### Risks and assumptions:
- **Assumption**: Field workers authenticate and synchronize their initial snapshot before departing dispatch offices or areas with cell coverage (**CONFIRMED**).
- **Risk**: If two technicians offline simultaneously attempt to issue the very last unit of a spare part, the first device to regain cellular signal and sync will succeed; the second will receive `INSUFFICIENT_STOCK` and require physical yard reconciliation.

### 30-second explanation:
> *"We built the comprehensive automated test suite and the developer demo guide for offline field operations. Our tests prove that if a worker's phone stays offline for three hours and syncs an old crane move after another worker already moved it online, the server records the history but never lets the stale phone overwrite the crane's true location. The demo guide shows anyone how to simulate being completely offline using browser DevTools with zero setup, while explaining why the very first login must always happen online."*

### Likely questions:
1. **"Can a technician log into the mobile app for the first time while in the middle of a desert job site with no cell reception?"**
   *Answer*: No. The first-ever login requires internet connectivity. Password verification (bcrypt hashing) and cryptographic JWT signing occur exclusively on the server. Technicians log in at the yard office before heading into dead zones; once logged in, their session and operational snapshot remain valid offline.
2. **"How does DevTools offline mode help verify our sync logic?"**
   *Answer*: By switching the Network tab to 'Offline', the browser cuts all outbound HTTP requests. You can perform equipment moves and material issues in the app, observe that they are saved in local IndexedDB outbox queues without crashing, and then switch back to 'No throttling' to watch the app immediately flush the batch to `/api/sync` and receive per-event receipts.
3. **"What happens if an offline technician resends a batch three times because the connection was shaky?"**
   *Answer*: The server detects the unique `client_event_id` UUID on each event. The first request accepts the moves; the second and third requests return status `duplicate` with the exact same stored result and write zero additional rows to the database.

### How to verify:
1. Run the complete automated offline test suite:
   ```bash
   npm --workspace=backend run test -- src/__tests__/offline_events.test.ts
   ```
   *Expected Result*: All 24 tests pass cleanly.
2. Run all project test suites:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: All 7 test suites pass cleanly (**79 tests passed**).
3. Verify TypeScript type checking:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: `tsc --noEmit` exits with 0 errors.
4. Follow the manual DevTools demo procedure in `docs/DEMO.md`.

---

## Step O4 Hardening: Unpriced Stock Accounting, Rental Multi-Item Closure, Private Cache Control, and Row-Locked Concurrency

### What we built:
1. **Unpriced Stock Receipts (`unit_cost IS NULL`) & Valuation Integrity**:
   - Updated offline `material.goods_received` and unpriced movements to insert `unit_cost = NULL` (instead of `0.00`).
   - Created database migration `backend/migrations/1730000000002_allow_null_unit_cost.sql` to drop `NOT NULL` and default `0.00` constraints on `stock_movements.unit_cost`.
   - Updated `GET /api/materials/:id/price-history` to compute inventory valuation (`total_valuation`, `average_cost`, `priced_qty`, `priced_receipts_count`) while strictly excluding `unit_cost IS NULL` rows. This ensures field deliveries pending supplier invoices never artificially dilute inventory valuation or weighted average costs.
2. **Multi-Item Rental Return Verification**:
   - Verified and proved that returning an equipment asset on a multi-item rental agreement (`equipment.return`) only closes the rental agreement (updating `rentals.status = 'returned'`) when **ALL** rental line items have been returned (`COUNT(*) WHERE returned_at IS NULL = 0`).
   - Partial returns return the asset to available yard inventory while keeping the rental contract active.
3. **HTTP Cache-Control Private Header**:
   - Added `Cache-Control: private` header to `GET /api/sync/snapshot` alongside deterministic ETags. Ensures downstream shared proxies/CDNs never cache role-specific data.
4. **Row-Locked Concurrency Trigger Enforcement**:
   - Created database migration `backend/migrations/1730000000003_stock_trigger_concurrency_lock.sql` updating `check_stock_movement_non_negative()`.
   - Added explicit parent item row lock (`PERFORM id FROM items WHERE id = NEW.item_id FOR UPDATE`) inside the trigger before calculating `SUM(qty)`.
   - Under PostgreSQL's `READ COMMITTED` isolation, two parallel sync requests issuing the last remaining stock unit are serialized: the second transaction waits for the first to commit, re-evaluates available stock as 0, and is blocked by the trigger raising `INSUFFICIENT_STOCK`.
5. **Complete API Reference (`docs/API.md`)**:
   - Generated full documentation covering all 25 endpoints (including `/api/sync` and `/api/sync/snapshot`), role-based request/response JSON for Admin and Staff, and client clock drift correction guides.
6. **Automated Integration Tests**:
   - Added 4 comprehensive tests to `backend/src/__tests__/offline_events.test.ts` (bringing the test suite to **83 passing tests** across 7 test files).

### Why it exists:
- **Commercial Valuation Accuracy**: Field yard workers logging receipts of steel plates or lubricants have no legal knowledge of negotiated commercial prices. Recording `0.00` as cost would misrepresent balance sheets by falsely claiming free inventory.
- **Contractual Integrity**: Rental contracts frequently bundle multiple machines (e.g. 2 cranes and 1 generator). If returning the first crane prematurely marked the rental as `'returned'`, billing would prematurely terminate while the customer still held the remaining machines on site.
- **Data Privacy & Caching Compliance**: Shared edge proxies must never serve an Admin snapshot (with rate cards) to a Staff worker, or vice-versa. `Cache-Control: private` guarantees caching is restricted to the caller's private browser/device cache.
- **Zero Race-Condition Inventory Integrity**: If two technicians in remote yards issue the final drum of oil simultaneously, client-side or uncommitted application checks would permit both, causing negative physical inventory. Database row locking guarantees atomic serialization.

### Why this way:
- **Row Locking in DB Trigger over Application-Level Locks**:
  - *Alternative 1 Rejected (Relying solely on Express/controller `SELECT ... FOR UPDATE`)*: Any future direct SQL script, admin migration, or alternate microservice could bypass application locks. Placing `PERFORM ... FOR UPDATE` inside the `BEFORE INSERT` trigger enforces serialization at the database engine level, impossible to bypass.
- **NULL Cost over Sentinel Values (e.g., -1.00 or 0.00)**:
  - *Alternative 2 Rejected (Using 0.00 or sentinel flag)*: Sentinel values corrupt mathematical aggregates (`AVG()`, `SUM(qty * unit_cost)`). In standard relational database theory, `NULL` correctly signifies "unknown / pending invoice". Standard SQL aggregates ignore `NULL` naturally.

### How it works:
1. Field technician records 50 units of oil received offline. The event syncs with `unit_cost = NULL`.
2. When management checks `GET /api/materials/:id/price-history`, the query aggregates `SUM(qty * unit_cost)` strictly over `unit_cost IS NOT NULL AND qty > 0`. The 50 unpriced units increase physical stock on hand without altering the average cost per unit.
3. When a technician returns machine #1 of a 2-machine rental, `handleEquipmentReturn` sets `returned_at` on item #1, verifies `COUNT(*) WHERE returned_at IS NULL = 1` (> 0), and leaves `rentals.status` open.
4. When machine #2 is returned, `COUNT(*) WHERE returned_at IS NULL = 0`, triggering `UPDATE rentals SET status = 'returned'`.
5. Two parallel HTTP requests hit `POST /api/sync` simultaneously issuing 1 unit from an item with 1 unit in stock.
6. Both execute `INSERT INTO stock_movements`. The Postgres trigger executes `PERFORM id FROM items WHERE id = NEW.item_id FOR UPDATE`.
7. Request A locks the item, sees 1 unit in stock, and inserts.
8. Request B waits for the lock. Upon Request A's commit, Request B reads committed stock (0 units), calculates `0 - 1 = -1 < 0`, and the trigger throws an exception.
9. `syncController` catches the trigger error, categorizes it as `INSUFFICIENT_STOCK`, rolls back Request B, records the rejection in `sync_events`, and returns HTTP 200 with `status: 'rejected'`.

### Concepts used:
- **Pessimistic Row Locking (`FOR UPDATE`) in DB Triggers**: Enforcing concurrency boundaries against phantom reads under `READ COMMITTED` isolation.
- **Three-Valued SQL Logic & `NULL` Semantics**: Differentiating between free items (cost 0.00) and unbilled inventory (cost NULL) in financial accounting.
- **Partial vs Complete Contract State Transitions**: Modeling aggregate line-item lifecycle completion before transitioning root entities.
- **RFC 7234 Private Cache Directives**: Directing intermediate proxies not to store authenticated, role-sensitive responses.

### Risks and assumptions:
- **Supplier Invoice Linking**: Unpriced stock movements (`unit_cost IS NULL`) should eventually be reconciled when the admin records the corresponding supplier invoice (`POST /api/invoices/supplier`).
- **Deadlock Avoidance**: Because row locks are acquired only on parent `items` during decrements, deadlocks are avoided as movements lock a single item ID per insert.

### 30-second explanation:
> *"We hardened the offline sync engine against real-world edge cases. Field goods receipts now store cost as NULL so unpriced deliveries never warp company inventory valuation or average costs. Rental contracts with multiple machines now remain open until every single machine is checked back into a yard. Offline snapshots are marked private so edge servers never cache role data, and the database stock trigger now locks the item row, guaranteeing that two workers issuing the last spare part at the same millisecond can never drive inventory below zero."*

### Likely questions:
1. **"Why does the database trigger lock the `items` row instead of `stock_movements`?"**
   *Answer*: In an append-only ledger, new rows in `stock_movements` do not exist yet to be locked. To serialize inserts that calculate an aggregate (`SUM(qty)`) across the ledger, we lock the shared parent row in `items`. This forces concurrent issue transactions for the same SKU to queue up sequentially.
2. **"What happens to the inventory valuation when unpriced goods arrive?"**
   *Answer*: Physical stock on hand increases immediately so workers can issue and use the parts. However, weighted average cost and financial valuation are calculated solely from priced receipts. Once accounting enters the supplier invoice, the price is officially recorded.
3. **"If a customer rents 5 generators and returns 4, what status does the rental have?"**
   *Answer*: The rental status remains 'picked_up' (or 'confirmed'). The 4 returned generators are marked returned with arrival timestamps and become immediately available in the yard for new jobs, but the rental agreement stays open until the 5th generator is returned.

### How to verify:
1. Run all backend automated test suites:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: All 7 test suites pass cleanly (**83 tests passed**, including all 28 tests in `offline_events.test.ts`).
2. Verify TypeScript type checking:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: `tsc --noEmit` exits with 0 errors.
