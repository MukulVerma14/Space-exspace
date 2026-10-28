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
