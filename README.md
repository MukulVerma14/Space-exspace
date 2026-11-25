# SPACE EXSPACE — Equipment & Materials Tracker

Internal web app for SPACE EXSPACE (Dammam) to track rental equipment (cranes, containers, portable offices, generators), yard moves, repairs, materials stock and invoices. Staff use a phone (QR scanning, moves, returns, repairs), and admins use a laptop (rates, invoices, stock). It works offline and syncs when the connection returns.

## Tech stack

- **Frontend:** React 18, TypeScript, Vite, React Router, `idb` (IndexedDB), `vite-plugin-pwa` (installable offline app), `jsqr` (QR scanning from the camera video)
- **Backend:** Node.js, Express, TypeScript, PostgreSQL (`pg`), plain SQL migrations (`node-pg-migrate`), JWT auth, `zod`, `decimal.js`, `pino`, `helmet`
- **Database:** PostgreSQL 16 (Docker)
- **Tests:** Vitest (backend and frontend)

## Prerequisites

- Node.js 20+ and npm 10+
- Docker Desktop (recommended), or a local PostgreSQL 16

## First-time setup

Run these from the project root (`E:\Space-exspace` on Windows). The steps are the same on macOS and Linux, except for the environment variable syntax in step 4.

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create the backend settings file**
   ```bash
   cp backend/.env.example backend/.env
   ```
   Set `JWT_SECRET` to a long random value. Any random string of 32+ characters works.
   The database values (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`) must match `docker-compose.yml`.

3. **Start the database**
   ```bash
   docker compose up -d
   ```

4. **Create the tables.** The migration tool reads `DATABASE_URL`, not `backend/.env`, so set it in the same terminal:
   ```powershell
   # Windows PowerShell
   $env:DATABASE_URL="postgres://postgres:postgres@localhost:5432/space_exspace"
   npm run migrate:backend
   ```
   ```bash
   # macOS / Linux
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/space_exspace npm run migrate:backend
   ```

5. **Load the sample data**
   ```bash
   npm run seed
   ```

Sample accounts (development only):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@spaceexspace.com` | `Admin#2026!Dev` |
| Staff | `staff@spaceexspace.com` | `Staff#2026!Dev` |

## Running the app

Use two terminals:

```bash
# Terminal 1: API on http://localhost:3000 (health: /health)
npm run dev:backend

# Terminal 2: frontend on http://localhost:5173
npm run dev:frontend
```

To test the production build locally:

```bash
npm run build:frontend
cd frontend && npx vite preview      # http://localhost:4173
```

## Phones and the camera

Browsers only allow camera access over HTTPS (or `localhost`). To test on a phone, expose the preview server through an HTTPS tunnel, for example:

```bash
cloudflared tunnel --url http://localhost:4173
```

- `/staff/camera-test` shows the raw camera feed. If it shows video, the camera permission and HTTPS are fine.
- The **Scan** page reads QR labels and always has a manual asset-code box as a fallback.
- Tunnel addresses change each time the tunnel restarts.
- If the phone shows "Blocked request", allow the tunnel host in `vite.config.ts` under `preview.allowedHosts` for the test only, and remove it afterwards.

**Status:** QR scanning has been checked on Android and on a laptop webcam, on an earlier build. iPhone has not been tested. Re-test on the current build before any client demo.

## Demo mode

Demo mode adds a "DEMO" watermark, a banner, a stamp on printed label sheets, and blocks search indexing. It is off by default. Full steps are in [docs/DEPLOY.md](docs/DEPLOY.md) section 8.

- Frontend build: set `VITE_DEMO_WATERMARK=true` in `frontend/.env.production`, then rebuild.
- Backend: set `DEMO_WATERMARK=true` in `backend/.env` to stamp label sheets.
- Reset the demo data to the sample data (refuses to run unless `ALLOW_DEMO_SEED=true` and `NODE_ENV` is not `production`):
  ```bash
  ALLOW_DEMO_SEED=true npm --workspace=backend run demo:reset
  ```

## Checks

```bash
npm run test:backend                  # needs the database running
npm run test:frontend
npm run build:frontend                # type-checks and builds the frontend
npm --workspace=backend run lint      # backend type-check
```

**Known failing tests:** 2 frontend tests in `frontend/src/__tests__/equipmentDetail.test.ts` (F-S2) fail on the current build. They need fixing before release.

## Production

- Docker Compose production stack: `docker-compose.prod.yml` (Caddy with automatic HTTPS, PostgreSQL, API, daily encrypted backups).
- Read [docs/DEPLOY.md](docs/DEPLOY.md) before deploying. Set real values for `JWT_SECRET`, `DEMO_ADMIN_PASSWORD` and `DEMO_STAFF_PASSWORD`, and turn demo mode off.
- In production, the seed refuses to run with the hardcoded sample passwords.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `client password must be a string` during migration | `DATABASE_URL` not set for the migration tool | Set `$env:DATABASE_URL` in the same terminal, then run `npm run migrate:backend` |
| `ECONNREFUSED 127.0.0.1:5432` | Database not running | `docker compose up -d`, then check `docker ps` |
| `relation ... does not exist` during seed | Migrations didn't run | Run the migration step first |
| Seed fails with "must be set in production" | `NODE_ENV=production` without demo passwords | Set `DEMO_ADMIN_PASSWORD` and `DEMO_STAFF_PASSWORD` |
| `REFUSED:` from `demo:reset` | Guard not met | Set `ALLOW_DEMO_SEED=true`, and make sure `NODE_ENV` is not `production` |
| "Equipment not found" on labels | Asset code doesn't exist in the database | Use codes from the sample data, such as `CRN-50-001`, `CRN-50-002`, `CRN-50-004` |
| Camera shows black or an error | Permission, HTTPS, or scanner issue | Check `/staff/camera-test` first, then use manual entry |
| "Blocked request" on phone | Tunnel host not allowed by Vite preview | Add `preview.allowedHosts` for the tunnel, for the test only |

## Documentation

- [Administrator & Operations Guide](docs/ADMIN_GUIDE.md)
- [Frontend Guide](frontend/README.md)
- [Deployment & Operations Guide](docs/DEPLOY.md) (includes demo mode)
- [Demo script](docs/DEMO.md)
- [System architecture & data model](docs/ARCHITECTURE.md)
- [Learning log](docs/LEARNING_LOG.md)
- [Integration review](docs/INTEGRATION_REVIEW.md)
- [Open questions for the client](docs/OPEN_QUESTIONS.md)

### Architecture decision records

- [001: no orm and sql migrations](docs/decisions/001-no-orm-and-sql-migrations.md)
- [002: derived equipment status and append only ledgers](docs/decisions/002-derived-equipment-status-and-append-only-ledgers.md)
- [003: idempotent seed strategy and credential security](docs/decisions/003-idempotent-seed-strategy-and-credential-security.md)
- [004: quotation lifecycle and booking overlap scope](docs/decisions/004-quotation-lifecycle-and-booking-overlap-scope.md)
- [005: server side rate serialization and jwt auth](docs/decisions/005-server-side-rate-serialization-and-jwt-auth.md)
- [006: action driven state transitions and qr resolution](docs/decisions/006-action-driven-state-transitions-and-qr-resolution.md)
- [007: rentals materials and price history](docs/decisions/007-rentals-materials-and-price-history.md)
- [008: client generated uuids and offline event ordering](docs/decisions/008-client-generated-uuids-and-offline-event-ordering.md)
- [009: offline conflict policy](docs/decisions/009-offline-conflict-policy.md)
- [010: role based read snapshots and etag caching](docs/decisions/010-role-based-read-snapshots-and-etag-caching.md)
- [011: offline client lifecycle and first login dependency](docs/decisions/011-offline-client-lifecycle-and-first-login-dependency.md)
- [012: plain text qr payload and high error correction](docs/decisions/012-plain-text-qr-payload-and-high-error-correction.md)
- [013: production deployment readiness and proxy trust](docs/decisions/013-production-deployment-readiness-and-proxy-trust.md)
- [014: caddy reverse proxy same origin and offsite backup](docs/decisions/014-caddy-reverse-proxy-same-origin-and-offsite-backup.md)
- [015: client side backup encryption and hsts policy](docs/decisions/015-client-side-backup-encryption-and-hsts-policy.md)
- [016: store only issued customer invoices and reconciliation](docs/decisions/016-store-only-issued-customer-invoices-and-reconciliation.md)
- [017: decimal money math 4 decimal unit prices and compensating void reversals](docs/decisions/017-decimal-money-math-4-decimal-unit-prices-and-compensating-void-reversals.md)
- [018: prototype jwt localstorage and production cookie strategy](docs/decisions/018-prototype-jwt-localstorage-and-production-cookie-strategy.md)
- [019: custom getusermedia scanner with jsqr](docs/decisions/019-custom-getusermedia-scanner-with-jsqr.md)