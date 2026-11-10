# SPACE EXSPACE — Operations & Yard Management Platform

A web-based equipment rental, materials inventory, and yard management application for **SPACE EXSPACE Company**, built to streamline heavy machinery rentals, tracking, workshop maintenance, and field operations with an **offline-first** progressive web app architecture.

---

## Tech Stack Overview

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons, Dexie.js (IndexedDB).
- **Backend**: Node.js, Express, TypeScript, `node-postgres` (`pg`), JWT authentication, `decimal.js`.
- **Database**: PostgreSQL 16+ (using native constraints, append-only audit ledgers, row-level locks, and triggers).
- **Tooling**: Turborepo workspace, `vitest`, `supertest`, `tsx`.

---

## Prerequisites

Before running the application, ensure the following are installed:
- **Node.js**: v20+ (`node -v`)
- **npm**: v10+ (`npm -v`)
- **PostgreSQL**: v16+ (`psql --version` or Docker)

---

## Environment Setup

Create `.env` configuration files for both the backend and frontend from their examples:

```bash
# In the root repository directory:
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Ensure your `backend/.env` has the correct database connection details and secret:
```env
PORT=3000
NODE_ENV=development
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=space_exspace
DB_USER=postgres
DB_PASSWORD=postgres
JWT_SECRET=dev-secret-key-must-be-at-least-32-chars-long-for-security
JWT_EXPIRES_IN=8h
CLIENT_URL=http://localhost:5173
```

Ensure your `frontend/.env` points to the backend API:
```env
VITE_API_BASE_URL=http://localhost:3000/api
```

---

## Step-by-Step: How to Run the Whole App

Follow these exact steps from the project root directory:

### Step 1: Install Dependencies
Install all workspace dependencies across the root, backend, and frontend:
```bash
npm install
```

### Step 2: Database Initialization & Migrations
Ensure PostgreSQL is running locally or inside Docker on the configured port.
Run database migrations to initialize tables, constraints, triggers, and append-only audit logs:
```bash
npm run migrate:backend
```

### Step 3: Seed Database with Initial Data
Seed standard rate cards, test equipment, locations, materials, users, and customer rentals:
```bash
npm run seed
```

> [!NOTE]
> Seeded accounts for testing:
> - **Admin**: `admin@spaceexspace.com` / `Admin#2026!Dev`
> - **Staff**: `staff@spaceexspace.com` / `Staff#2026!Dev`

### Step 4: Run the Backend & Frontend

#### Option A: Run Both Concurrently (Recommended)
You can start both the backend API server (`localhost:3000`) and Vite frontend (`localhost:5173`) simultaneously using:
```bash
npm run dev
```

#### Option B: Run in Separate Terminals

**Terminal 1 — Backend:**
```bash
npm run dev:backend
```
*API will start on `http://localhost:3000` with health check at `http://localhost:3000/health`.*

**Terminal 2 — Frontend:**
```bash
npm run dev:frontend
```
*Frontend will start on `http://localhost:5173`.*

---

## Production Build & Verification

### Run Automated Test Suites
Run all backend unit and integration tests (PostgreSQL integration, role masking, offline sync, ETag caching, concurrency triggers):
```bash
npm run test:backend
```

### Typecheck & Lint
Validate TypeScript and code style across workspaces:
```bash
npm --workspace=backend run lint
npm --workspace=frontend run typecheck
```

### Build Frontend
Compile and bundle the production-ready frontend:
```bash
npm run build:frontend
```

---

## Docker Compose Production Setup

To run the complete production-hardened environment including PostgreSQL, Node.js API, Caddy reverse-proxy with automatic HTTPS, and daily encrypted backups:

```bash
# 1. Provide production secrets
cp .env.example .env.prod
# Update JWT_SECRET, POSTGRES_PASSWORD, RCLONE_CRYPT_PASSWORD, etc.

# 2. Launch production stack
docker compose -f docker-compose.prod.yml up -d
```

---

## Contributing & Git Workflow

- **Branch Push Policy**: All development and automated agent commits must be pushed **ONLY** to the active working branch (`main`). Never push to `origin/Frontend` or other remote branches.
- **Testing & Verification**: Always run the automated test suite (`npm run test:backend`), linter (`npm --workspace=backend run lint`), and build checks (`npm run build:frontend`) before pushing.

---

## Troubleshooting Common Issues

### 1. `connect ECONNREFUSED 127.0.0.1:5432` (or `:5433`)
- **Cause**: The PostgreSQL database server is not running, or your `backend/.env` port does not match your active PostgreSQL instance.
- **Fix**:
  1. Check if PostgreSQL is running via Docker (`docker ps`) or local service (`netstat -ano | findstr 5432` / `5433`).
  2. Start the database service or container (`docker compose up -d postgres`).
  3. Verify that `DB_PORT` and `DATABASE_URL` in `backend/.env` specify the correct port.

### 2. `ALLOW_DEMO_SEED error` during seed
- **Cause**: If `NODE_ENV=production` is set, `npm run seed` will fail intentionally to protect production databases.
- **Fix**: Ensure `NODE_ENV=development` in your local `backend/.env`, or set `ALLOW_DEMO_SEED=true` if explicitly testing a demo in staging.

### 3. API Requests Fail from Frontend (`Network Error`)
- **Cause**: The backend API server is not running on port 3000.
- **Fix**: Start the backend with `npm run dev:backend`.

---

## Architectural Decision Records (ADRs)
- [ADR 001: Plain SQL Migrations and No ORM](docs/decisions/001-no-orm-and-sql-migrations.md)
- [ADR 002: Derived Equipment Status and Append-Only Ledgers](docs/decisions/002-derived-equipment-status-and-append-only-ledgers.md)
- [ADR 003: Idempotent Seed Strategy and Credential Security](docs/decisions/003-idempotent-seed-strategy-and-credential-security.md)
- [ADR 004: Quotation Lifecycle, Cancellation Item Freeing, and Future Booking Overlap Scope](docs/decisions/004-quotation-lifecycle-and-booking-overlap-scope.md)
- [ADR 014: Plain Text QR Code Payload vs URLs](docs/decisions/014-plain-text-qr-payload.md)
- [ADR 015: Client-Side Encrypted Off-Site Backups and Lifecycle Retention](docs/decisions/015-client-side-encrypted-backups.md)
- [ADR 016: Store-Only Issued Customer Invoices, Math Reconciliation Invariants, and Payment State Auditing](docs/decisions/016-store-only-issued-customer-invoices-and-reconciliation.md)
- [ADR 017: Arbitrary-Precision Decimal Money Math, 4-Decimal Unit Prices, Half-Up Rounding Rule, and Compensating Reversals for Voided Invoices](docs/decisions/017-decimal-money-math-4-decimal-unit-prices-and-compensating-void-reversals.md)
- [ADR 018: Prototype JWT Storage in LocalStorage, XSS Defenses, and Production Same-Origin HttpOnly Cookie Strategy](docs/decisions/018-prototype-jwt-localstorage-and-production-cookie-strategy.md)
- [ADR 019: Replacement of html5-qrcode with Custom Native getUserMedia Scanner and jsQR Engine](docs/decisions/019-custom-getusermedia-scanner-with-jsqr.md)

## Documentation & Architecture
- [Administrator & Operations Guide](docs/ADMIN_GUIDE.md)
- [Frontend Guide](frontend/README.md)
- [Deployment & Operations Guide](docs/DEPLOY.md)
- [System Architecture & Data Model](docs/ARCHITECTURE.md)
- [Learning Log & Technical Concepts](docs/LEARNING_LOG.md)
- [Integration Review Findings](docs/INTEGRATION_REVIEW.md)
- [Open Questions & Client Ambiguities](docs/OPEN_QUESTIONS.md)
