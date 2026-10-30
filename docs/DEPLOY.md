# Production Deployment Guide: SPACE EXSPACE Fleet Platform

This document describes the production deployment architecture, step-by-step launch procedure, required environment variables, automated backup/restore routines, and an architectural comparison between a Small VPS and a Managed Cloud Platform.

---

## 1. Production Architecture Overview

In production, the backend runs in a hardened, containerized environment managed via Docker Compose and placed behind an edge reverse proxy (such as Nginx, Caddy, or AWS Application Load Balancer).

```
                      HTTPS (Port 443)
                             │
                  ┌──────────▼──────────┐
                  │    Reverse Proxy    │ (TLS termination, HTTP/2,
                  │   (Nginx / Caddy)   │  DDoS mitigation)
                  └──────────┬──────────┘
                             │ HTTP (127.0.0.1:3000)
                             │ X-Forwarded-For: <client_ip>
                  ┌──────────▼──────────┐
                  │   Backend API (App) │ [Container: space_exspace_api_prod]
                  │   (trust proxy: 1)  │ (Node.js 20 Alpine, dumb-init, non-root)
                  └──────────┬──────────┘
                             │ Docker Bridge Network (Port 5432)
                  ┌──────────▼──────────┐
                  │   PostgreSQL 16 DB  │ [Container: space_exspace_db_prod]
                  │ (Named Volume Data) │ (Persistent storage, localized ports)
                  └─────────────────────┘
```

### Security & Operational Invariants
- **Reverse Proxy Trust (`app.set('trust proxy', 1)`)**: Express trusts the first upstream proxy hop so `req.ip` reflects the real client IP extracted from `X-Forwarded-For`. This prevents brute-force login attackers from bypassing rate limits or sharing a single bucket.
- **Strict Environment Validation**: Startup validates all mandatory secrets with Zod. In `production`, the server refuses to boot if default development secrets (`dev_jwt_secret_...`) are detected.
- **Production Seed Safeguards**: `npm run seed` refuses execution under `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true` is set. When enabled, admin and staff passwords must come from environment variables (`DEMO_ADMIN_PASSWORD`, `DEMO_STAFF_PASSWORD`).
- **Health Check Readiness**: Monitoring systems query `GET /health` to verify that Node.js process and PostgreSQL connection pooling are fully functional before routing traffic.

---

## 2. Production Run Steps

### Step 1: Server Provisioning
Ensure Docker and Docker Compose v2 are installed on the Linux host (e.g., Ubuntu 24.04 LTS / Debian 12):
```bash
sudo apt update && sudo apt install -y curl git docker.io docker-compose-v2
sudo systemctl enable --now docker
```

### Step 2: Clone Repository
```bash
git clone https://github.com/MukulVerma14/Space-exspace.git /opt/space-exspace
cd /opt/space-exspace
```

### Step 3: Configure Production Environment (`.env`)
Create `/opt/space-exspace/.env` with strict permissions (`chmod 600 .env`):
```bash
# Server
NODE_ENV=production
PORT=3000

# Database Credentials
DB_HOST=postgres
DB_PORT=5432
DB_USER=space_admin
DB_PASSWORD=SecureRandomDbPasswordString_987654321
DB_NAME=space_exspace

# Authentication
# Must be at least 32 characters, cryptographically random
JWT_SECRET=c8f1e2d3b4a567890abcdef1234567890abcdef1234567890abcdef12345678
JWT_EXPIRES_IN=8h

# CORS (FQDN of the frontend web application)
CORS_ORIGIN=https://app.spaceexspace.com

# Demo Seeding Guard (set to 'false' in live production)
ALLOW_DEMO_SEED=false
```

### Step 4: Build and Launch Containers
```bash
# Build multi-stage image and start services in background
docker compose -f docker-compose.prod.yml up -d --build
```

### Step 5: Run Database Migrations
Run all PostgreSQL migrations inside a transient container attached to the production database:
```bash
docker compose -f docker-compose.prod.yml exec backend npm run migrate:up
```

### Step 6: (Optional) Initialize Demo Data
If standing up a dedicated demonstration environment in production mode:
```bash
docker compose -f docker-compose.prod.yml exec \
  -e ALLOW_DEMO_SEED=true \
  -e DEMO_ADMIN_PASSWORD='StrongAdminPassword2026!' \
  -e DEMO_STAFF_PASSWORD='StrongStaffPassword2026!' \
  backend npm run seed
```

### Step 7: Verify Service Health
```bash
curl -i http://127.0.0.1:3000/health
```
*Expected Response (`200 OK`)*:
```json
{
  "status": "ok",
  "uptimeSeconds": 14,
  "timestamp": "2026-10-30T10:45:00.000Z",
  "environment": "production",
  "database": {
    "status": "connected",
    "latencyMs": 1.2
  }
}
```

---

## 3. Required Environment Variables

| Variable | Type | Required | Description | Security Guidance / Constraints |
| :--- | :---: | :---: | :--- | :--- |
| `NODE_ENV` | String | **Yes** | Execution mode (`production`, `development`, `test`). | Must be `production` on live servers. Activates proxy trust and enforces secure secrets. |
| `PORT` | Number | No | Application listen port (default: `3000`). | Bound to `127.0.0.1:3000` via Compose. Never expose raw port to internet. |
| `DB_HOST` | String | **Yes** | PostgreSQL hostname (`postgres` inside Docker). | Resolves via internal Docker network `space_exspace_prod_net`. |
| `DB_PORT` | Number | **Yes** | PostgreSQL port (default: `5432`). | Internal container communication port. |
| `DB_USER` | String | **Yes** | PostgreSQL username. | Use dedicated role (e.g. `space_admin`), avoid default superusers. |
| `DB_PASSWORD` | String | **Yes** | PostgreSQL database password. | Minimum 16 random characters. Must be non-empty. |
| `DB_NAME` | String | **Yes** | PostgreSQL database name (e.g. `space_exspace`). | Target database name. |
| `JWT_SECRET` | String | **Yes** | Symmetric key used to sign JWT tokens. | **Strictly ≥ 32 characters**. Server refuses default dev secret in production. |
| `JWT_EXPIRES_IN` | String | No | Token lifetime string (default: `8h`). | Balances field shift duration (8h) with revocation window. |
| `CORS_ORIGIN` | String | **Yes** | Allowed client origin (e.g. `https://app.spaceexspace.com`). | Must match production frontend domain; wildcards (`*`) are disallowed with credentials. |
| `ALLOW_DEMO_SEED` | String | No | Controls whether seed script is permitted in production (`true`/`false`). | Default `false`. Prevents accidental production data overwrites. |
| `DEMO_ADMIN_PASSWORD` | String | Conditional | Initial admin password if seeding demo data. | Required in production if `ALLOW_DEMO_SEED=true`. Min 8 chars. |
| `DEMO_STAFF_PASSWORD` | String | Conditional | Initial staff password if seeding demo data. | Required in production if `ALLOW_DEMO_SEED=true`. Min 8 chars. |

---

## 4. Automated Daily PostgreSQL Backup Routine

Backups are executed using a non-blocking PostgreSQL dump (`pg_dump -Fc`), compressed with custom archive format and stored in `/var/backups/space_exspace`.

### Automated Backup Script (`scripts/backup_daily.sh`)
```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/space_exspace}"
CONTAINER_NAME="space_exspace_db_prod"
DB_USER="space_admin"
DB_NAME="space_exspace"
RETENTION_DAYS=14

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/space_exspace_backup_${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

# Run pg_dump inside the production database container
docker exec -t "${CONTAINER_NAME}" pg_dump \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  -Fc \
  --no-owner \
  --no-privileges \
  > "${BACKUP_FILE}"

# Verify backup size > 100 bytes
if [ "$(wc -c < "${BACKUP_FILE}" | tr -d ' ')" -le 100 ]; then
  echo "Backup error: dump file is empty or corrupted" >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi

# Rotate backups older than 14 days
find "${BACKUP_DIR}" -name "space_exspace_backup_*.dump" -mtime +"${RETENTION_DAYS}" -delete
```

### Production Cron Setup
To execute automatically every night at 02:00 AM AST:
```bash
sudo crontab -e
```
Add the following line:
```cron
0 2 * * * /opt/space-exspace/scripts/backup_daily.sh >> /var/log/space_exspace_backup.log 2>&1
```

---

## 5. Documented Disaster Recovery & Restore Test

To verify backup validity and test disaster recovery procedures, run the restore script against a designated test database:

```bash
# Execute disaster recovery restore verification
./scripts/restore.sh /var/backups/space_exspace/space_exspace_backup_20261030_020000.dump space_exspace_restore_test
```

### Manual Step-by-Step Restore Procedure:
1. **Create Clean Target Database**:
   ```bash
   docker exec -it space_exspace_db_prod psql -U space_admin -c "DROP DATABASE IF EXISTS space_exspace_restore_test;"
   docker exec -it space_exspace_db_prod psql -U space_admin -c "CREATE DATABASE space_exspace_restore_test;"
   ```

2. **Restore Archive via `pg_restore`**:
   ```bash
   docker exec -i space_exspace_db_prod pg_restore \
     -U space_admin \
     -d space_exspace_restore_test \
     --clean \
     --if-exists \
     --no-owner \
     --no-privileges < /var/backups/space_exspace/latest.dump
   ```

3. **Verify Table Row Counts**:
   ```sql
   SELECT 'equipment' AS table_name, count(*) AS row_count FROM equipment
   UNION ALL
   SELECT 'users', count(*) FROM users
   UNION ALL
   SELECT 'rentals', count(*) FROM rentals
   UNION ALL
   SELECT 'stock_movements', count(*) FROM stock_movements
   UNION ALL
   SELECT 'sync_events', count(*) FROM sync_events;
   ```

4. **Verify Derived View Functionality**:
   ```sql
   SELECT asset_code, status, current_location_name, make, model 
   FROM v_equipment_current 
   LIMIT 5;
   ```
   *Verification Success*: `v_equipment_current` executes with non-empty results and matches expected fleet counts.

---

## 6. Infrastructure Evaluation: Small VPS vs. Managed Platform

When selecting production infrastructure for SPACE EXSPACE, we evaluate a **Small Cloud VPS** against a **Managed Cloud Platform** across four architectural dimensions:

| Architectural Dimension | Option A: Small Cloud VPS (e.g. Hetzner Cloud / DigitalOcean Droplet / AWS Lightsail) | Option B: Managed Cloud Platform (e.g. Render / Railway / AWS ECS + RDS) |
| :--- | :--- | :--- |
| **Monthly Cost** | **\$6 – \$14 / month** (Flat-rate for 2 vCPU, 4GB RAM, 80GB NVMe SSD, unlimited egress). Highly predictable. | **\$40 – \$110+ / month** (Compute \$15–\$25, Managed DB \$20–\$50, egress & logging add-ons). Variable monthly bills. |
| **Operational Effort** | **Moderate (Self-Managed)**: Requires OS security patches (`unattended-upgrades`), Docker daemon updates, UFW firewall maintenance, and Nginx reverse proxy configuration. | **Low (Turnkey)**: Zero OS maintenance. Automatic container deployment from Git, managed SSL certificates, and managed database version upgrades. |
| **Backups & Recovery** | **Scripted & Self-Maintained**: Daily `pg_dump` cron script with off-site sync to S3 or object storage. Restore testing is manual. | **Automated & Point-in-Time**: 1-click snapshots, automated daily backups with retention sliders, and point-in-time database rollback. |
| **Account Ownership & Sovereignty** | **100% Client Owned**: SPACE EXSPACE owns the root Linux server and encrypted disk volumes. Data resides in the designated region (e.g. in-kingdom KSA or UAE data centers) adhering to Saudi data residency regulations. | **Third-Party Managed**: Data hosted inside shared multitenant platform infrastructure. Vendor account lock-in; potential latency to Middle Eastern mobile clients if regional PoPs are unavailable. |

### Architectural Recommendation

1. **Phase 1: Initial Deployment & Field Pilot (Recommended: Hardened Small VPS)**:
   - Deploy Docker Compose on a dedicated Ubuntu VPS located in or nearest to Saudi Arabia (e.g., AWS Middle East Bahrain `me-south-1` or regional VPS provider).
   - Cost is under \$15/month with zero vendor lock-in.
   - The included `backup_daily.sh` and `restore.sh` scripts provide disaster recovery with minimal operational burden.
2. **Phase 2: High-Volume Operational Scale (Migration to Managed RDS)**:
   - When operations grow beyond 50 concurrent active yard terminals, detach PostgreSQL from Docker Compose to a managed PostgreSQL cluster (e.g. AWS RDS PostgreSQL or managed regional DB) for automated point-in-time recovery and multi-AZ failover, while keeping the Node.js API container stateless.
