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
- **Database**: PostgreSQL 16 with partial unique indexes, append-only ledger tables, and derived-state SQL views (`v_equipment_current`).

---

## Prerequisites
- **Node.js**: v20.0.0 or higher
- **npm**: v10.0.0 or higher
- **Docker & Docker Compose** (or a local PostgreSQL 16 instance running on port 5432)

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

### 3. Start PostgreSQL
Using Docker Compose:
```bash
docker compose up -d
```
*(If running a local PostgreSQL service, create the database `space_exspace` on port 5432).*

### 4. Run the Backend API
```bash
npm run dev:backend
```
The server will start on `http://localhost:3000`.

### 5. Verify API Health
Open a browser or run:
```bash
curl http://localhost:3000/health
```
Expected response:
```json
{
  "status": "ok",
  "uptimeSeconds": 12,
  "timestamp": "2026-10-27T08:50:00.000Z",
  "environment": "development",
  "database": {
    "status": "connected",
    "latencyMs": 4
  }
}
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

## Pedagogical Documentation
- [Architecture & Data Model](docs/ARCHITECTURE.md)
- [Learning Log & Technical Concepts](docs/LEARNING_LOG.md)
- [Open Questions & Ambiguities](docs/OPEN_QUESTIONS.md)
