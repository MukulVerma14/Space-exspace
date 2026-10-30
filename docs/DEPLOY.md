# Production Deployment Guide: SPACE EXSPACE Fleet Platform

This document describes the production deployment architecture, step-by-step launch procedure, required environment variables, automated backup/restore routines with off-site replication, and an architectural comparison between a Small VPS and a Managed Cloud Platform.

> [!NOTE]
> Every cost figure and data-residency statement in this document is marked as **"(to verify before quoting)"** to ensure financial and regulatory commitments are vetted prior to commercial quoting.

---

## 1. Production Architecture Overview

In production, the backend and frontend run in a hardened, containerized environment managed via Docker Compose and placed behind **Caddy** as the automated TLS edge reverse proxy.

```
                      HTTPS (Port 443) / HTTP (Port 80)
                                     │
                          ┌──────────▼──────────┐
                          │    Caddy v2 Proxy   │ (Automatic HTTPS, Let's Encrypt / ZeroSSL,
                          │  [space_exspace_    │  zstd/gzip, HSTS, camera=(self))
                          │    caddy_prod]      │
                          └─────┬────────────┬──┘
                                │            │
                 /srv (Static)  │            │ /api/*, /health (HTTP 127.0.0.1:3000)
       ┌────────────────────────┘            │ X-Forwarded-For: <client_ip>
       │                                     │
┌──────▼──────────────┐             ┌────────▼────────────┐
│ Frontend SPA Build  │             │  Backend API (Node) │ [Container: space_exspace_api_prod]
│ [space_exspace_     │             │  (trust proxy: 1)   │ (Node.js 20 Alpine, dumb-init, non-root)
│  frontend_prod]     │             └────────┬────────────┘
└─────────────────────┘                      │ Docker Bridge Network (Port 5432)
                                    ┌────────▼────────────┐
                                    │  PostgreSQL 16 DB   │ [Container: space_exspace_db_prod]
                                    │ (Named Volume Data) │ (Persistent storage, localized ports)
                                    └─────────────────────┘
```

### Security & Operational Invariants
- **Same-Origin Architecture**: Caddy serves both the compiled React frontend static assets (`/srv`) and proxies `/api/*` requests to the Node.js backend under the exact same domain (e.g. `https://app.spaceexspace.com`). This completely eliminates Cross-Origin Resource Sharing (CORS) preflight roundtrips, browser cookie blocking, and credential friction.
- **Mobile Camera QR Scanning Requires HTTPS (Secure Context)**:
  Modern mobile browsers (Safari on iOS, Chrome on Android) strictly enforce the W3C Secure Context specification for `navigator.mediaDevices.getUserMedia`. Web applications running over plain HTTP (non-secure) are blocked by browser sandboxes from accessing camera video hardware. Caddy automates public TLS certificates (Let's Encrypt / ZeroSSL), guaranteeing immediate, valid HTTPS encryption required for yard technicians to scan equipment QR codes.
- **Reverse Proxy Hop Trust (`app.set('trust proxy', 1)`)**:
  - Express is configured with `app.set('trust proxy', 1)`, directing it to trust exactly **1 upstream proxy hop**.
  - **Why 1 hop?** In this architecture, Caddy is the single, direct edge reverse proxy terminating TLS and forwarding requests to Express. Caddy sets `X-Forwarded-For: {remote_host}`. Express strips 1 proxy hop, accurately resolving `req.ip` as the client's genuine IP address for `loginRateLimiter` (10 failed attempts / 15 mins) and security audit logs.
  - **Upstream CDN / Multi-Hop Consideration**: If a secondary edge proxy (such as Cloudflare CDN, AWS CloudFront, or an external corporate load balancer) is placed in front of Caddy, the hop count must be adjusted to `2` (or configured with the trusted CDN IP range CIDR blocks). If left at `1` with a CDN in front, `req.ip` would resolve to Cloudflare's egress node, causing all yard clients to share a single rate-limiting bucket.
- **Fail-Fast Environment Validation**: Startup validates all mandatory secrets with Zod. In `production`, `JWT_SECRET` must be strictly **≥ 32 characters** and cannot match default development keys (`dev_jwt_secret_...`).
- **Production Seed Safeguards**: `npm run seed` refuses execution under `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true` is set. When enabled, admin and staff passwords must come from environment variables (`DEMO_ADMIN_PASSWORD`, `DEMO_STAFF_PASSWORD`).
- **Health Check Readiness**: Monitoring systems query `GET /health` to verify that Node.js process and PostgreSQL connection pooling are fully functional before routing traffic.

---

## 2. Production Run Steps

### Step 1: Server Provisioning
Ensure Docker and Docker Compose v2 are installed on the Linux host (e.g., Ubuntu 24.04 LTS / Debian 12):
```bash
sudo apt update && sudo apt install -y curl git docker.io docker-compose-v2 rclone
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
# Server & Domain
NODE_ENV=production
PORT=3000
DOMAIN=app.spaceexspace.com
TLS_EMAIL=admin@spaceexspace.com

# Database Credentials
DB_HOST=postgres
DB_PORT=5432
DB_USER=space_admin
DB_PASSWORD=SecureRandomDbPasswordString_987654321
DB_NAME=space_exspace

# Authentication
# Strictly >= 32 characters, cryptographically random
JWT_SECRET=c8f1e2d3b4a567890abcdef1234567890abcdef1234567890abcdef12345678
JWT_EXPIRES_IN=8h

# CORS (matches same-origin production domain)
CORS_ORIGIN=https://app.spaceexspace.com

# Demo Seeding Guard (set to 'false' in live production)
ALLOW_DEMO_SEED=false

# Off-site S3 Backup Config (for scripts/backup_daily.sh)
RCLONE_REMOTE=s3_backup
RCLONE_BUCKET=space-exspace-backups
```

### Step 4: Build and Launch Containers
```bash
# Build multi-stage backend, compile frontend SPA, and start services with Caddy
docker compose -f docker-compose.prod.yml up -d --build
```

### Step 5: Run Database Migrations
Run all PostgreSQL migrations inside the production backend container:
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

### Step 7: Verify Service Health & HTTPS
```bash
# Verify internal backend health probe
curl -i http://127.0.0.1:3000/health

# Verify public edge Caddy HTTPS response
curl -i https://app.spaceexspace.com/health
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
| `PORT` | Number | No | Application listen port (default: `3000`). | Internal container port proxied by Caddy. Never expose raw port to public internet. |
| `DOMAIN` | String | **Yes** | Public FQDN (e.g. `app.spaceexspace.com`). | Used by Caddy for automatic Let's Encrypt / ZeroSSL TLS certificate acquisition. |
| `TLS_EMAIL` | String | No | Administrator email for ACME TLS certificate registration. | Default: `admin@spaceexspace.com`. Used for certificate renewal notices. |
| `DB_HOST` | String | **Yes** | PostgreSQL hostname (`postgres` inside Docker). | Resolves via internal Docker network `space_exspace_prod_net`. |
| `DB_PORT` | Number | **Yes** | PostgreSQL port (default: `5432`). | Internal container communication port. |
| `DB_USER` | String | **Yes** | PostgreSQL username. | Use dedicated role (e.g. `space_admin`), avoid default superusers. |
| `DB_PASSWORD` | String | **Yes** | PostgreSQL database password. | Minimum 16 random characters. Must be non-empty. |
| `DB_NAME` | String | **Yes** | PostgreSQL database name (e.g. `space_exspace`). | Target database name. |
| `JWT_SECRET` | String | **Yes** | Symmetric key used to sign JWT tokens. | **Strictly ≥ 32 characters in production**. Server refuses boot on short keys or default dev secrets. |
| `JWT_EXPIRES_IN` | String | No | Token lifetime string (default: `8h`). | Balances field shift duration (8h) with revocation window. |
| `CORS_ORIGIN` | String | **Yes** | Allowed client origin (e.g. `https://app.spaceexspace.com`). | Matches production domain; same-origin deployment eliminates cross-domain blocking. |
| `ALLOW_DEMO_SEED` | String | No | Controls whether seed script is permitted in production (`true`/`false`). | Default `false`. Prevents accidental production data overwrites. |
| `DEMO_ADMIN_PASSWORD` | String | Conditional | Initial admin password if seeding demo data. | Required in production if `ALLOW_DEMO_SEED=true`. Min 8 chars. |
| `DEMO_STAFF_PASSWORD` | String | Conditional | Initial staff password if seeding demo data. | Required in production if `ALLOW_DEMO_SEED=true`. Min 8 chars. |
| `RCLONE_REMOTE` | String | No | rclone remote name for off-site backups (default: `s3_backup`). | Configured in `~/.config/rclone/rclone.conf`. |
| `RCLONE_BUCKET` | String | No | Target S3 bucket for off-site backups (default: `space-exspace-backups`). | Off-site S3-compatible cloud storage bucket. |

---

## 4. Automated Daily PostgreSQL Backup Routine with Off-Site S3 Replication

Backups are executed using a non-blocking PostgreSQL dump (`pg_dump -Fc`), compressed with custom archive format, stored locally in `/var/backups/space_exspace`, and replicated off-site to an S3-compatible object storage bucket using `rclone`.

### Loud Failure Behavior
The backup script is engineered to **fail loudly**:
- If `rclone` is not installed or configured, the script exits immediately with **exit code 10**.
- If the off-site S3 upload fails (network drop, invalid credentials, bucket permissions), the script exits immediately with **exit code 20**.
- This loud failure ensures standard monitoring daemons, cron error logs, and pager alerts immediately notify engineering rather than silently skipping off-site storage.

### Automated Backup Script (`scripts/backup_daily.sh`)
```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/space_exspace}"
CONTAINER_NAME="${CONTAINER_NAME:-space_exspace_db_prod}"
DB_USER="${DB_USER:-space_admin}"
DB_NAME="${DB_NAME:-space_exspace}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Off-site S3 configuration
RCLONE_REMOTE="${RCLONE_REMOTE:-s3_backup}"
RCLONE_BUCKET="${RCLONE_BUCKET:-space-exspace-backups}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/space_exspace_backup_${TIMESTAMP}.dump"
LOG_PREFIX="[$(date +"%Y-%m-%d %H:%M:%S")]"

mkdir -p "${BACKUP_DIR}"

# 1. Execute pg_dump inside the database container using custom compressed format (-Fc)
docker exec -t "${CONTAINER_NAME}" pg_dump \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  -Fc \
  --no-owner \
  --no-privileges \
  > "${BACKUP_FILE}"

# 2. Verify file size is non-zero (> 100 bytes)
FILE_SIZE=$(wc -c < "${BACKUP_FILE}" | tr -d ' ')
if [ "${FILE_SIZE}" -le 100 ]; then
  echo "${LOG_PREFIX} ❌ Backup failed: output file is suspiciously small (${FILE_SIZE} bytes)." >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi

# 3. Off-Site Replication via rclone to S3-compatible bucket
RCLONE_DEST="${RCLONE_REMOTE}:${RCLONE_BUCKET}/daily/$(basename "${BACKUP_FILE}")"
if ! command -v rclone &> /dev/null; then
  echo "${LOG_PREFIX} ❌ FATAL ERROR: 'rclone' executable not found in PATH! Off-site S3 backup failed." >&2
  exit 10
fi

if ! rclone copyto "${BACKUP_FILE}" "${RCLONE_DEST}" --stats 10s --stats-one-line; then
  echo "${LOG_PREFIX} ❌ FATAL ERROR: rclone upload to ${RCLONE_DEST} FAILED!" >&2
  exit 20
fi

# 4. Cleanup local backups older than retention window (14 days)
find "${BACKUP_DIR}" -name "space_exspace_backup_*.dump" -mtime +"${RETENTION_DAYS}" -exec rm -v {} \;
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

## 5. Documented Disaster Recovery & Monthly Restore Test Reminder

> [!IMPORTANT]
> **MONTHLY DISASTER RECOVERY DRILL (Mandatory Operating Routine)**:
> Backups that have never been tested for restoration are not backups. On the **first Monday of every month**, the designated system operator must run the disaster recovery verification procedure below against a staging or test database.

### Monthly Restore Drill Checklist:
- [ ] 1. Download the latest backup archive from the off-site S3 bucket via `rclone copyto`.
- [ ] 2. Execute `./scripts/restore.sh <dump_path> space_exspace_restore_test`.
- [ ] 3. Verify that row counts match across core tables (`equipment`, `users`, `rentals`, `stock_movements`, `sync_events`).
- [ ] 4. Verify that `v_equipment_current` executes with valid derived statuses (`available`, `rented`, `under_repair`).
- [ ] 5. Document the test date, archive name, and verification sign-off in the operational log.

### Step-by-Step Restore Procedure:
```bash
# Execute disaster recovery restore verification
./scripts/restore.sh /var/backups/space_exspace/space_exspace_backup_20261030_020000.dump space_exspace_restore_test
```

#### Manual Verification Commands:
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
| **Monthly Cost** *(to verify before quoting)* | **\$6 – \$14 / month (to verify before quoting)** (Flat-rate for 2 vCPU, 4GB RAM, 80GB NVMe SSD, unlimited egress). Highly predictable. | **\$40 – \$110+ / month (to verify before quoting)** (Compute \$15–\$25, Managed DB \$20–\$50, egress & logging add-ons (to verify before quoting)). Variable monthly bills. |
| **Operational Effort** | **Moderate (Self-Managed)**: Requires OS security patches (`unattended-upgrades`), Docker daemon updates, UFW firewall maintenance, and Caddy reverse proxy configuration. | **Low (Turnkey)**: Zero OS maintenance. Automatic container deployment from Git, managed SSL certificates, and managed database version upgrades. |
| **Backups & Recovery** | **Scripted & Self-Maintained**: Daily `pg_dump` cron script with automated `rclone` off-site replication to S3-compatible object storage. Restore testing is verified monthly via checklist. | **Automated & Point-in-Time**: 1-click snapshots, automated daily backups with retention sliders, and point-in-time database rollback. |
| **Account Ownership & Data Sovereignty** *(to verify before quoting)* | **100% Client Owned**: SPACE EXSPACE owns the root Linux server and encrypted disk volumes. Data resides in the designated region (e.g. in-kingdom KSA or UAE data centers) adhering to Saudi data residency regulations (to verify before quoting). | **Third-Party Managed**: Data hosted inside shared multitenant platform infrastructure. Vendor account lock-in; potential latency to Middle Eastern mobile clients if regional PoPs are unavailable (to verify before quoting). |

### Architectural Recommendation

1. **Phase 1: Initial Deployment & Field Pilot (Recommended: Hardened Small VPS)**:
   - Deploy Docker Compose on a dedicated Ubuntu VPS located in or nearest to Saudi Arabia (e.g., AWS Middle East Bahrain `me-south-1` or regional VPS provider *(to verify before quoting)*).
   - Cost is under \$15/month *(to verify before quoting)* with zero vendor lock-in.
   - The included `backup_daily.sh` and `restore.sh` scripts provide verified disaster recovery with minimal operational burden.
2. **Phase 2: High-Volume Operational Scale (Migration to Managed RDS)**:
   - When operations grow beyond 50 concurrent active yard terminals, detach PostgreSQL from Docker Compose to a managed PostgreSQL cluster (e.g. AWS RDS PostgreSQL or managed regional DB *(to verify before quoting)*) for automated point-in-time recovery and multi-AZ failover, while keeping the Node.js API container stateless.
