# Space-exspace — Code Structure Explained

## What is this project?

**Space-exspace** is an industrial equipment & materials tracking system for SPACE EXSPACE Company (Dammam, Saudi Arabia). It tracks crane rentals, heavy containers, portable site offices, diesel generators, cleaning machinery, material inventory ledgers, and invoices.

It is a **monorepo** containing a backend API (fully built) and a stubbed frontend placeholder.

---

## Top-Level Layout

```
Space-exspace/
├── backend/          ← Node.js REST API (TypeScript + Express + PostgreSQL)
├── frontend/         ← React + Vite PWA (scaffold only — package.json stub)
├── docs/             ← Architecture specs, ADRs, learning logs
├── package.json      ← Root workspace config (npm workspaces)
├── docker-compose.yml← Docker setup for local PostgreSQL
└── .gitignore
```

---

## Root `package.json` & `docker-compose.yml`

| File | Purpose |
|---|---|
| [package.json](file:///e:/Space-exspace/package.json) | NPM workspaces root. Defines top-level scripts that delegate to `backend/` workspace (e.g. `npm run dev:backend`, `npm run seed`, `npm run migrate:backend`) |
| [docker-compose.yml](file:///e:/Space-exspace/docker-compose.yml) | Spins up a local PostgreSQL 16 container with the `space_exspace` database pre-configured |

---

## `/backend` — The Core API

### Entry Points

```
backend/
├── src/server.ts    ← Process entry: starts HTTP server, graceful shutdown
└── src/app.ts       ← Express app factory: middleware stack + route mounts
```

- **[server.ts](file:///e:/Space-exspace/backend/src/server.ts)** — Calls `app.listen()` and registers `SIGTERM`/`SIGINT` handlers for graceful shutdown. Drains the DB connection pool before exiting to prevent transaction corruption.

- **[app.ts](file:///e:/Space-exspace/backend/src/app.ts)** — Assembles the Express application:
  - `helmet` → sets security HTTP headers
  - `cors` → restricts cross-origin requests to the configured origin
  - `express.json()` → parses request bodies
  - `httpLogger` → structured HTTP request logging via Pino
  - `/health` endpoint → DB ping + process uptime info
  - Mounts all route modules under `/api/*`

---

### `/src/config/`

| File | Purpose |
|---|---|
| [env.ts](file:///e:/Space-exspace/backend/src/config/env.ts) | Validates **all** environment variables at startup using a **Zod schema**. If any required variable is missing or malformed, the process exits immediately with a descriptive error — a *fail-fast* pattern. Exports a typed `env` object used throughout the codebase. |

**Variables it validates:**
- `NODE_ENV`, `PORT`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `JWT_SECRET` (enforces ≥ 32 chars)
- `JWT_EXPIRES_IN`, `CORS_ORIGIN`

---

### `/src/db/`

| File | Purpose |
|---|---|
| [pool.ts](file:///e:/Space-exspace/backend/src/db/pool.ts) | Creates a shared **PostgreSQL connection pool** (max 20 connections) using the native `pg` driver. Also exports `checkDbHealth()` used by the `/health` endpoint. |
| [seed.ts](file:///e:/Space-exspace/backend/src/db/seed.ts) | **Idempotent** seed script (~41 KB). Populates the DB with realistic demo data: equipment models, 41 assets, rate cards, parties (customers/suppliers), locations, rentals, repairs, materials, and invoices. Safe to re-run (uses `ON CONFLICT DO NOTHING`). |

---

### `/src/middleware/`

| File | Purpose |
|---|---|
| [auth.ts](file:///e:/Space-exspace/backend/src/middleware/auth.ts) | Two middleware functions: **`authenticate`** (verifies JWT + checks user is still active in DB) and **`requireRole(...roles)`** (RBAC guard — restricts routes to specific roles). |
| [rateLimiter.ts](file:///e:/Space-exspace/backend/src/middleware/rateLimiter.ts) | Configures `express-rate-limit` to protect endpoints from abuse (e.g., login brute force). |

**Key design:** JWT is stateless, but user `active` status is verified on *every* request in the DB — so revoking a user takes effect immediately without waiting for the JWT to expire.

---

### `/src/routes/`

Each file creates an Express `Router` and wires controller functions to HTTP methods + paths:

| File | Mount Point | Access |
|---|---|---|
| [authRoutes.ts](file:///e:/Space-exspace/backend/src/routes/authRoutes.ts) | `POST /api/auth/login` | Public |
| [equipmentRoutes.ts](file:///e:/Space-exspace/backend/src/routes/equipmentRoutes.ts) | `GET /api/equipment`, `GET /:asset_code`, `POST /:asset_code/move`, `/return`, `/repair` | All authenticated |
| [rentalsRoutes.ts](file:///e:/Space-exspace/backend/src/routes/rentalsRoutes.ts) | `GET /api/rentals`, `GET /:id`, `POST /`, `POST /:id/pickup`, `POST /:id/return` | GET: all auth; POST /: admin only |
| [materialsRoutes.ts](file:///e:/Space-exspace/backend/src/routes/materialsRoutes.ts) | `GET /api/materials`, `POST /api/materials/ledger` | GET: all auth; POST: admin only |
| [invoicesRoutes.ts](file:///e:/Space-exspace/backend/src/routes/invoicesRoutes.ts) | `GET /api/invoices`, `GET /:id` | Admin only |
| [ratesRoutes.ts](file:///e:/Space-exspace/backend/src/routes/ratesRoutes.ts) | `GET /api/rates`, `GET /api/rates/rental-quote-demo` | Admin only (demo endpoint: all auth with financial scrubbing) |

---

### `/src/controllers/`

The controllers contain the actual **business logic** — they parse requests, run SQL queries against `pool`, and return JSON responses:

| File | Responsibility |
|---|---|
| [authController.ts](file:///e:/Space-exspace/backend/src/controllers/authController.ts) | Handles `POST /login`: validates credentials with bcrypt, issues a signed JWT |
| [equipmentController.ts](file:///e:/Space-exspace/backend/src/controllers/equipmentController.ts) | List/search equipment, QR code asset lookup, action handlers for move/return/repair (all run in DB transactions to keep `equipment` + `location_log` in sync) |
| [rentalsController.ts](file:///e:/Space-exspace/backend/src/controllers/rentalsController.ts) | Rental lifecycle: create quotation → pickup → return. Handles overlap checking for booking conflicts |
| [materialsController.ts](file:///e:/Space-exspace/backend/src/controllers/materialsController.ts) | Materials inventory with append-only ledger entries (each transaction is a signed record — never UPDATE) |
| [invoicesController.ts](file:///e:/Space-exspace/backend/src/controllers/invoicesController.ts) | Supplier invoice management and price history tracking |

---

### `/src/serializers/`

| File | Purpose |
|---|---|
| [rateSerializer.ts](file:///e:/Space-exspace/backend/src/serializers/rateSerializer.ts) | `sanitizeFinancials(data, role)` — **recursively strips** sensitive financial fields (`applied_rate`, `amount`, `discount_note`, `cost`, etc.) from API responses for `staff` users. Admins get full data. This is the server-side RBAC data layer — the UI cannot be trusted to hide it on its own. |

---

### `/src/types/`

| File | Purpose |
|---|---|
| [auth.ts](file:///e:/Space-exspace/backend/src/types/auth.ts) | Defines `UserRole` (`'admin' \| 'staff'`), `AuthenticatedUser`, and `JwtTokenPayload` interfaces. Also augments Express's `Request` type to add `req.user` globally. |

---

### `/src/utils/`

| File | Purpose |
|---|---|
| [logger.ts](file:///e:/Space-exspace/backend/src/utils/logger.ts) | Exports a **Pino** structured logger. Uses `pino-pretty` in development (human-readable), raw JSON in production (for log collectors like Datadog/CloudWatch). Silent in test mode to keep test output clean. |

---

### `/src/__tests__/`

Integration test suite using **Vitest + Supertest** (hits real DB in test mode):

| File | Tests |
|---|---|
| [health.test.ts](file:///e:/Space-exspace/backend/src/__tests__/health.test.ts) | `/health` endpoint response shape |
| [auth.test.ts](file:///e:/Space-exspace/backend/src/__tests__/auth.test.ts) | Login success/failure, JWT issuance, inactive user blocking |
| [equipment.test.ts](file:///e:/Space-exspace/backend/src/__tests__/equipment.test.ts) | Equipment listing, QR lookup, move/return/repair actions |
| [rentals_materials.test.ts](file:///e:/Space-exspace/backend/src/__tests__/rentals_materials.test.ts) | Rental lifecycle + materials ledger |
| [schema.test.ts](file:///e:/Space-exspace/backend/src/__tests__/schema.test.ts) | DB schema integrity checks (tables, columns, views exist) |
| [seed.test.ts](file:///e:/Space-exspace/backend/src/__tests__/seed.test.ts) | Seed idempotency — runs seed twice, verifies no duplicate data |

---

### `/migrations/`

| File | Purpose |
|---|---|
| [1730000000000_initial_schema.sql](file:///e:/Space-exspace/backend/migrations/1730000000000_initial_schema.sql) | The single **plain SQL migration** (~17 KB). Creates all tables (`users`, `equipment_models`, `equipment`, `location_log`, `rates`, `parties`, `locations`, `rentals`, `rental_items`, `maintenance_log`, `materials`, `material_ledger`, `invoices`, `invoice_items`), views (`v_equipment_current`), partial unique indexes, and constraints. Managed by `node-pg-migrate`. |

---

## `/frontend`

Currently just a `package.json` scaffold — **not yet implemented**. Planned as a Vite + React + TypeScript **mobile-first PWA** with camera-based QR scanning.

---

## `/docs`

Rich documentation for this learning/prototype project:

| File | Purpose |
|---|---|
| [ARCHITECTURE.md](file:///e:/Space-exspace/docs/ARCHITECTURE.md) | Full data model, entity relationships, derived-state views |
| [LEARNING_LOG.md](file:///e:/Space-exspace/docs/LEARNING_LOG.md) | Developer learning journal (~63 KB): explains *why* each technical decision was made |
| [OPEN_QUESTIONS.md](file:///e:/Space-exspace/docs/OPEN_QUESTIONS.md) | Unresolved design questions and ambiguities |
| [API.md](file:///e:/Space-exspace/docs/API.md) | Full REST API reference |
| [decisions/](file:///e:/Space-exspace/docs/decisions) | 7 Architectural Decision Records (ADRs) documenting key choices |

---

## Data Flow Summary

```
HTTP Request
    │
    ▼
app.ts (helmet + cors + json + logging)
    │
    ▼
Route (routes/*.ts)  ──►  authenticate() middleware  ──►  requireRole() (if needed)
    │
    ▼
Controller (controllers/*.ts)
    │  ├── Validates input (Zod)
    │  ├── Runs SQL via pool (db/pool.ts)
    │  └── Applies sanitizeFinancials() (serializers/rateSerializer.ts)
    │
    ▼
JSON Response
```

---

## Key Design Decisions

| Decision | Choice |
|---|---|
| ORM | **None** — plain SQL with native `pg` driver for full control and transparency |
| Auth | **JWT** + DB active-check on every request (fast + revocable) |
| Equipment State | **Derived** from `location_log` via SQL view `v_equipment_current` — no mutable status column |
| Inventory | **Append-only ledger** — material quantities are calculated from signed ledger entries, never overwritten |
| Financial Data Security | **Server-side serializer** strips sensitive fields before response — cannot be bypassed by frontend |
| Migrations | **node-pg-migrate** with raw `.sql` files — fully transparent, no magic |
| Logging | **Pino** (structured JSON, production-grade) |
| Validation | **Zod** for both env variables and request body validation |
