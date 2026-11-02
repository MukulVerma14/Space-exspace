# SPACE EXSPACE — Equipment & Materials Tracker

[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/postgresql-16-blue.svg)](https://www.postgresql.org/)
[![Vite](https://img.shields.io/badge/vite-6-646CFF.svg)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/react-18-61DAFB.svg)](https://react.dev/)
[![License](https://img.shields.io/badge/license-UNLICENSED-red.svg)]()

Industrial equipment and materials tracking system for **SPACE EXSPACE Company** (Dammam, Saudi Arabia). Supports crane rentals, heavy containers, portable site offices, diesel generators, cleaning machinery, material inventory ledgers, and invoice pricing history.

---

## Architecture at a Glance

- **Monorepo**:
  - `/backend`: Node.js 20+, TypeScript, Express, native `pg` driver, plain SQL migrations (`node-pg-migrate`), Zod schema validation, Vitest.
  - `/frontend`: Vite 6, React 18, TypeScript, mobile-first PWA with camera QR scanning (`jsqr`) and offline outbox sync (`idb`).
  - `/docs`: Architecture specs, open client questions, learning logs, and architectural decision records (ADRs).
- **Database**: PostgreSQL 16+ with partial unique indexes, single-entry append-only ledger tables, and derived-state SQL views (`v_equipment_current`).

---

## Demo Accounts

> [!IMPORTANT]
> These credentials are seeded automatically via `npm run seed` for local development and client demo walkthroughs.

| Role | Name | Email | Password | Access Scope |
|---|---|---|---|---|
| **Admin** | Abdullah Al-Dosari | `admin@spaceexspace.com` | `Admin#2026!Dev` | Full fleet, rate cards, rental contracts, invoice tracking, stock ledgers |
| **Staff** | Tariq Mansour | `staff@spaceexspace.com` | `Staff#2026!Dev` | QR scan, location moves, repair tickets (no access to pricing/rates) |

---

## Step-by-Step: How to Run the Whole App

### 1. Prerequisites
- **Node.js**: `v20.0.0` or higher
- **PostgreSQL**: PostgreSQL 16+ (via Docker or local Windows/Linux install)
- **Git**

---

### 2. Install Dependencies
Run from the root directory to install packages across both `backend` and `frontend` workspaces:
```bash
npm install
```

---

### 3. Start PostgreSQL Database

You can run PostgreSQL either through Docker (recommended) or using a local PostgreSQL installation.

#### Option A: Docker (Recommended)
Run PostgreSQL in a background container:
```bash
docker compose up -d postgres
```
This starts PostgreSQL on port `5432` with user `postgres`, password `postgres`, and database `space_exspace`.

#### Option B: Local PostgreSQL Installation
If using a local PostgreSQL installation, ensure the PostgreSQL service or cluster is running:
- **Default Port**: `5432`
- **Custom Port (e.g., 5433)**: If port 5432 is already occupied by another service on your machine, start your cluster on port 5433 (e.g. using `pg_ctl` or Windows Services):
  ```powershell
  # Example for custom cluster at D:\pgdata5433
  & "D:\PGSQL18\bin\pg_ctl.exe" -D "D:\pgdata5433" -l "D:\pgdata5433\server.log" start
  ```
- Ensure the database `space_exspace` exists:
  ```sql
  CREATE DATABASE space_exspace;
  ```

---

### 4. Configure Environment Variables

Create your local backend environment configuration:
```bash
# On Linux / macOS / Git Bash:
cp backend/.env.example backend/.env

# On Windows PowerShell:
Copy-Item backend\.env.example backend\.env
```

Open `backend/.env` and verify that the database connection parameters match your setup:
```env
PORT=3000
NODE_ENV=development

# Database Settings
DB_HOST=127.0.0.1
DB_PORT=5432    # Change to 5433 if your local cluster runs on port 5433
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=space_exspace

# Connection string used by migration runner (node-pg-migrate)
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/space_exspace

# Authentication & CORS
JWT_SECRET=dev_jwt_secret_must_be_changed_in_production_min32chars
JWT_EXPIRES_IN=8h
CORS_ORIGIN=http://localhost:5173
```

---

### 5. Run Database Migrations

Apply all plain SQL schema migrations (tables, partial unique indexes, check constraints, append-only ledgers, and views):
```bash
npm run migrate:backend
```

---

### 6. Seed Demo Data

Populate realistic equipment fleet (~41 assets), standard rate cards, fictional customers, suppliers, rental bookings, maintenance tickets, and initial admin/staff accounts:
```bash
npm run seed
```

---

### 7. Run the Application (Backend + Frontend)

Open **two separate terminal windows** (or tabs) from the project root:

#### Terminal 1: Backend API
```bash
npm run dev:backend
```
- Starts the Express API server with automatic hot-reloading (`tsx watch`).
- Listens on `http://localhost:3000`.
- Verify API health: `http://localhost:3000/health`.

#### Terminal 2: Frontend PWA
```bash
npm run dev:frontend
```
- Starts the Vite development server on `http://localhost:5173`.
- Automatically proxies all `/api` and `/health` requests to `http://localhost:3000` via Vite's built-in dev proxy.

---

### 8. Open the App in Your Browser

1. Navigate to:
   ```
   http://localhost:5173
   ```
2. Log in using either the **Admin** or **Staff** demo account:
   - **Admin**: `admin@spaceexspace.com` / `Admin#2026!Dev`
   - **Staff**: `staff@spaceexspace.com` / `Staff#2026!Dev`

---

## Mobile PWA & Camera QR Scanner

- **Localhost Testing**: Desktop browsers treat `http://localhost:5173` as a secure origin, granting camera permissions for the QR scanner.
- **Mobile Device Over Wi-Fi**: Mobile browsers require **HTTPS** (Secure Context) for `navigator.mediaDevices.getUserMedia`. To test the scanner on a physical mobile device:
  1. Use USB port forwarding via Chrome Remote Debugging (`chrome://inspect` -> Port Forwarding: `5173 -> localhost:5173`), or
  2. Launch the production Docker Compose stack (`docker-compose.prod.yml`) with Caddy for automatic HTTPS certificates.

---

## Running Tests and Validation

### Run Backend Tests (Vitest + Supertest)
```bash
npm run test:backend
```

### Run Backend Lint / Typecheck
```bash
npm --workspace=backend run lint
```

### Build Frontend Static Bundle
```bash
npm run build:frontend
```

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

## Documentation & Architecture
- [Frontend Guide](frontend/README.md)
- [Deployment & Operations Guide](docs/DEPLOY.md)
- [System Architecture & Data Model](docs/ARCHITECTURE.md)
- [Learning Log & Technical Concepts](docs/LEARNING_LOG.md)
- [Integration Review Findings](docs/INTEGRATION_REVIEW.md)
- [Open Questions & Client Ambiguities](docs/OPEN_QUESTIONS.md)
