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
