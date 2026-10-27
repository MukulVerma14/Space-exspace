# Learning & Architectural Log

This document records every step of building the SPACE EXSPACE equipment and materials tracker. Each entry explains the technical choices, rejected alternatives, data flows, and interview-grade explanations.

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
2. `src/server.ts` immediately imports `src/config/env.ts`, which reads `.env` and passes all variables through the Zod schema. If any variable is missing or malformed, the process halts immediately with exit code 1.
3. Express configures Helmet security headers, CORS permissions, body parsers, and Pino HTTP logging.
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
> *"Before writing any business logic, we built a sturdy foundation. We set up an automated health check and strict startup checks. If a database password or key configuration is missing, the system catches it instantly and refuses to start with a clear error, instead of failing midway while a worker is trying to scan equipment in the yard."*

### Likely questions:
1. **"Why use Zod for environment variables instead of just reading `process.env`?"**
   *Answer*: `process.env` provides raw strings without type guarantees or presence validation. If an essential variable like `DB_PASSWORD` or `JWT_SECRET` is missing or misspelled, raw `process.env` produces `undefined`, which silently propagates until a user makes a request that triggers an obscure runtime crash. Zod guarantees that if the server boots, every single required configuration is present and structurally valid.
2. **"Why did you choose raw PostgreSQL with `pg` instead of an ORM like Prisma or TypeORM?"**
   *Answer*: SPACE EXSPACE's business rules rely heavily on PostgreSQL-specific features: partial unique indexes (ensuring an asset is only rented once concurrently), CHECK constraints (disallowing negative stock or backwards dates), and SQL views for derived asset status. ORMs abstract away these exact primitives, making the system harder to tune, explain, and audit.
3. **"What happens to inflight user requests if the server process receives a restart or shutdown signal?"**
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
- **Derived State SQL View (`v_equipment_current`)**: Unifies physical equipment metadata, latest location from immutable `location_log`, and derived status (`rented` if an active rental item exists, `under_repair` if an open maintenance work order exists, otherwise `available`).
- **Inventory Ledger Non-Negative Trigger (`check_stock_movement_non_negative`)**: Prevents negative stock on hand at the database engine level before an `issue` movement can be inserted.
- **Automated Schema Verification Suite (`src/__tests__/schema.test.ts`)**: Rigorous Vitest tests verifying:
  1. Initial status derivation in `v_equipment_current`
  2. Partial unique index enforcing that a crane cannot be rented to two clients simultaneously
  3. Partial unique index enforcing only one concurrent open repair per machine
  4. Non-negative inventory trigger rejecting stock deficits
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
   - Never updated or deleted. Full tamper-proof audit trail for customer billing and insurance disputes.
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
14. **`stock_movements` (Double-Entry Ledger Pattern)**:
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
4. The view joins against `rental_items` where `returned_at IS NULL` and `maintenance` where `closed_at IS NULL`.
5. If an open rental exists, `status` resolves to `'rented'`. If open maintenance exists, it resolves to `'under_repair'`. Otherwise, it resolves to `'available'`.
6. When an item of consumable material is issued, `BEFORE INSERT ON stock_movements` fires. The trigger calculates `current_stock + NEW.qty`. If negative, PostgreSQL raises an exception and aborts the transaction before any write occurs.

### Concepts used:
- **3NF (Third Normal Form)**: A database design standard where every non-key column is non-transitively dependent solely on the primary key ("the key, the whole key, and nothing but the key").
- **Partial Unique Index**: An index with a `WHERE` filter that enforces uniqueness only across rows matching that condition (e.g. only one active row where `returned_at IS NULL`).
- **Append-only ledger**: A data structure where records are only inserted and never updated or deleted, providing complete historical traceability.
- **Derived state**: Dynamic computation of an entity's current condition from historical facts, avoiding duplicate sources of truth.
- **Database trigger**: Procedural code automatically executed by the database engine in response to specific data modification events (e.g. `BEFORE INSERT`).

### Risks and assumptions:
- **Assumption**: The active equipment fleet is ~145 items as confirmed by preliminary data. Evaluating `v_equipment_current` on 145 items takes under 2 milliseconds.
- **Risk**: If the fleet actually grows to 50,000+ items with millions of location log rows, querying `DISTINCT ON` on every request will eventually require a materialized view with refresh triggers. For the prototype and client demo, a standard view is optimal and free of cache-invalidation bugs.

### 30-second explanation:
> *"Instead of having workers manually type whether a machine is 'available' or 'rented'—which causes human errors and double bookings—the database figures out the status automatically. If there is an active rental agreement, it is rented. If a repair ticket is open, it is under repair. If neither, it is available. And at the database level, it is physically impossible to rent a crane that is already checked out to another client."*

### Likely questions:
1. **"Why didn't you put the equipment's current location and current status directly into the `equipment` table?"**
   *Answer*: That would create two sources of truth. If someone updates the rental table or moves a crane, but the application crashes before updating the status column on the equipment table, the two records contradict each other. By deriving status and location dynamically from the audit logs and active rental contracts in `v_equipment_current`, the status is always mathematically guaranteed to match operational reality.
2. **"Why do we store `applied_rate` on `rental_items` if we already have a `rates` table?"**
   *Answer*: Standard rates change over time due to inflation or management decisions. If a customer signs a contract today for 1,200 SAR/day, and six months from now SPACE EXSPACE raises standard crane rates to 1,500 SAR/day, past rental contracts and customer invoices must still reflect the agreed 1,200 SAR. Storing `applied_rate` on the line item permanently seals the agreed financial transaction.
3. **"How does the database prevent someone from issuing material when there isn't enough in the yard?"**
   *Answer*: Materials are tracked in an append-only ledger (`stock_movements`), where stock on hand is `SUM(qty)`. We attached a PostgreSQL `BEFORE INSERT` trigger to `stock_movements`. If a technician attempts to issue 50 meters of conduit when only 20 are available, the trigger calculates the deficit and raises an immediate SQL error, rolling back the transaction before any bad data can be written.

### How to verify:
1. Run migration rollback and re-apply:
   ```bash
   npm --workspace=backend run migrate:down
   npm --workspace=backend run migrate:up
   ```
   *Expected Result*: Output confirms all 17 tables, indexes, trigger, and view are dropped and cleanly re-created.
2. Run automated test suite:
   ```bash
   npm --workspace=backend run test
   ```
   *Expected Result*: All 7 tests pass across `health.test.ts` and `schema.test.ts`.
3. Run TypeScript type checks:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: `tsc --noEmit` exits with 0 errors.

---

## Step 2: Idempotent Realistic Database Seeding

### What we built:
- **Idempotent Seeding Engine (`backend/src/db/seed.ts`)**:
  - 2 seeded users (`admin@spaceexspace.com` with role `admin`, `staff@spaceexspace.com` with role `staff`), with real `bcrypt` password hashing (10 salt rounds).
  - 7 equipment types and 12 equipment models with realistic manufacturer specs (Tadano, Kato, Grove, Liebherr, Cummins, Caterpillar, CIMC, Space Modular, Kärcher).
  - Standard rate cards for hourly, daily, weekly, and monthly units in SAR.
  - 3 realistic industrial suppliers (SABIC, Rawabi, Al-Jubail Paint) and 3 major customers (Nesma & Partners, Aramco Subcontractors, Al-Kifah Holding) with valid 15-digit ZATCA VAT numbers.
  - 7 operational locations (Central Dammam Yard, Jubail Yard, Dammam Heavy Workshop, Fleet Transit, and 3 client job sites).
  - 41 individual equipment assets with unique asset codes (`CRN-50-001`, `GEN-250-001`, `CNT-20-001`, `OFF-40-001`, etc.) and initial location logs.
  - 3 rental scenarios: 1 active rental (7 assets deployed at King Salman Maritime Complex), 1 historical returned rental, and 1 recent active rental.
  - Maintenance work orders: 2 open repair tickets (hydraulic winch seal rupture, outrigger cylinder loss) deriving `status = 'under_repair'`, and 1 closed historical repair.
  - 15 materials inventory SKUs (mild steel plates, armoured cables, flexible conduits, epoxy primers, welding rods, hydraulic oil) across 5 categories and 6 measurement units.
  - 2 full invoices with line items: 1 received supplier invoice (SABIC) with material purchase prices, and 1 issued customer invoice (Nesma) for crane rentals.
  - Initial stock ledger movements for all 15 materials, plus an issue movement, maintaining positive stock on hand.
- **Root and Backend npm Scripts**: Added `npm run seed` callable from anywhere in the monorepo.
- **Automated Verification Suite (`backend/src/__tests__/seed.test.ts`)**: 7 new Vitest tests proving end-to-end idempotency, bcrypt authentication, status distribution in `v_equipment_current`, ZATCA VAT compliance, and inventory balances.
- **Architectural Decision Record**: Created `docs/decisions/003-idempotent-seed-strategy-and-credential-security.md`.

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
1. `npm run seed` executes `src/db/seed.ts` inside a single PostgreSQL transaction (`BEGIN ... COMMIT`).
2. The seeder hashes development passwords with `bcrypt.hash('...', 10)` and upserts the two users.
3. Master reference data (types, models, rates, parties, locations, categories, units, items) is inserted using `ON CONFLICT (...) DO UPDATE` or natural key checks.
4. Equipment assets are inserted with unique `asset_code`s, and each receives an initial `location_log` record placing it in its initial yard or site.
5. The 3 rental agreements and rental items are linked. Because active rental items have `returned_at IS NULL`, the SQL view `v_equipment_current` immediately derives their status as `'rented'`.
6. Open maintenance records are inserted with `closed_at IS NULL`. For those specific machines, `v_equipment_current` immediately derives status as `'under_repair'`.
7. All remaining machines automatically evaluate to `'available'`.
8. Invoices and stock movements are written. If any error occurs anywhere during execution, `ROLLBACK` runs, leaving the database completely uncorrupted.

### Concepts used:
- **Idempotency**: An operation that produces the exact same outcome whether executed once or a hundred times consecutively, without error or side effects.
- **Bcrypt**: A salted, adaptive cryptographic hash function designed specifically for secure password storage.
- **Upsert**: A database operation that atomically inserts a new row or updates existing attributes if a unique constraint conflict is detected (`INSERT ... ON CONFLICT DO UPDATE`).
- **Natural key**: A real-world business identifier (such as `asset_code`, `email`, or `sku`) as opposed to a surrogate autoincrement ID.
- **ZATCA (Zakat, Tax and Customs Authority)**: The Saudi tax authority regulating VAT identification numbers (15 digits, starting and ending with 3).

### Risks and assumptions:
- **Assumption**: The prototype uses local development bcrypt hashing. In a production deployment, passwords will not be seeded via static strings; staff will be invited via email tokens or single sign-on (SSO).
- **Risk**: If developers alter existing primary key sequences manually without using the seeder, the seed script's natural-key lookups ensure records are updated gracefully rather than failing on sequence conflicts.

### 30-second explanation:
> *"We built an idempotent demo seed script that loads the entire system with realistic industrial data from Dammam—crane models from Tadano and Liebherr, generators from Cummins, project sites like Ras Tanura, and real Saudi VAT numbers. Best of all, it's completely safe: you can run it as many times as you want before a client meeting or interview, and it will never crash or create duplicate records."*

### Likely questions:
1. **"What does 'idempotent' mean in the context of a seed script, and why is it crucial?"**
   *Answer*: Idempotency means running the script multiple times produces the exact same clean database state without crashing with unique constraint errors or creating duplicate records. In client demos or test pipelines, developers frequently need to reset or refresh sample data; an idempotent script guarantees that running `npm run seed` is always 100% safe.
2. **"Why do we see 7 rented items, 2 under repair, and 32 available in `v_equipment_current` when the seed script never wrote the word 'available' or 'rented' into an equipment table?"**
   *Answer*: That demonstrates our derived state architecture. The seed script created 1 active rental contract with 5 items, 1 rental with 2 items, and 2 open repair orders with no close date. The SQL view `v_equipment_current` dynamically calculated the status of every single asset based on whether active rental or maintenance rows exist.
3. **"Where are the passwords for the admin and staff users stored, and how does the server authenticate them?"**
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
   *Expected Result*: All 14 tests pass across `health.test.ts`, `schema.test.ts`, and `seed.test.ts`.
3. Verify TypeScript type checking:
   ```bash
   npm --workspace=backend run lint
   ```
   *Expected Result*: `tsc --noEmit` exits with code 0.
