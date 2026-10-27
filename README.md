# SPACE EXSPACE — Equipment & Materials Tracker

[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/postgresql-16-blue.svg)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/license-UNLICENSED-red.svg)]()

Industrial equipment and materials tracking prototype for **SPACE EXSPACE Company** (Dammam, Saudi Arabia). Supports crane rentals, heavy containers, portable site offices, diesel generators, cleaning machinery, material inventory ledgers, and invoice pricing history.

---

## Architecture at a Glance
- **Monorepo**:
  - `/backend`: Node.js 20+, TypeScript, Express, native `pg` driver, plain SQL migrations (`node-pg-migrate`), Zod validation, Vitest.
  - `/frontend`: Vite + React + TypeScript, mobile-first PWA with camera QR scanning.
  - `/docs`: Architecture specs, open client questions, learning logs, and architectural decision records (ADRs).
- **Database**: PostgreSQL 16 with partial unique indexes, single-entry signed append-only ledger tables, and derived-state SQL views (`v_equipment_current`).

---

## Development Accounts (Demo / Prototype)
> [!IMPORTANT]
> These credentials are for local development and client demo environments only. They are seeded automatically via `npm run seed`.

| Role | Name | Email | Password | Access Scope |
|---|---|---|---|---|
| **Admin** | Abdullah Al-Dosari | `admin@spaceexspace.com` | `Admin#2026!Dev` | Full fleet, rate cards, rental contracts, invoice tracking, stock ledgers |
| **Staff** | Tariq Mansour | `staff@spaceexspace.com` | `Staff#2026!Dev` | QR scan, location moves, repair tickets (no access to pricing/rates) |

---

## Quickstart

### 1. Install Dependencies
From the repository root:
```bash
npm install
```

### 2. Configure Environment Variables
Copy the sample environment file in the backend directory:
```bash
cp backend/.env.example backend/.env
```
Ensure your database credentials match your PostgreSQL instance.

### 3. Run Database Migrations
```bash
npm run migrate:backend
```

### 4. Seed Idempotent Demo Data
Populate realistic equipment (~41 assets), standard rate cards, fictional customers, fictional suppliers, rentals, repairs, materials, and invoices:
```bash
npm run seed
```

### 5. Run the Backend API
```bash
npm run dev:backend
```
The server will start on `http://localhost:3000`.

### 6. Verify API Health
Open a browser or run:
```bash
curl http://localhost:3000/health
```

---

## Running Tests and Typechecks

To execute the test suite (Vitest + Supertest):
```bash
npm run test:backend
```

To run TypeScript type checks:
```bash
npm --workspace=backend run lint
```

---

## Architectural Decision Records (ADRs)
- [ADR 001: Plain SQL Migrations and No ORM](docs/decisions/001-no-orm-and-sql-migrations.md)
- [ADR 002: Derived Equipment Status and Append-Only Ledgers](docs/decisions/002-derived-equipment-status-and-append-only-ledgers.md)
- [ADR 003: Idempotent Seed Strategy and Credential Security](docs/decisions/003-idempotent-seed-strategy-and-credential-security.md)
- [ADR 004: Quotation Lifecycle, Cancellation Item Freeing, and Future Booking Overlap Scope](docs/decisions/004-quotation-lifecycle-and-booking-overlap-scope.md)

## Pedagogical Documentation
- [Architecture & Data Model](docs/ARCHITECTURE.md)
- [Learning Log & Technical Concepts](docs/LEARNING_LOG.md)
- [Open Questions & Ambiguities](docs/OPEN_QUESTIONS.md)
