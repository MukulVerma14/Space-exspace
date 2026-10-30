#!/bin/bash
# =============================================================================
# SPACE EXSPACE - Automated Daily PostgreSQL Backup Script
# =============================================================================
# Usage:
#   ./scripts/backup_daily.sh
# Crontab entry (daily at 02:00 AM):
#   0 2 * * * /path/to/scripts/backup_daily.sh >> /var/log/space_exspace_backup.log 2>&1
# =============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/space_exspace}"
CONTAINER_NAME="${CONTAINER_NAME:-space_exspace_db_prod}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-space_exspace}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Off-site S3 configuration
RCLONE_REMOTE="${RCLONE_REMOTE:-s3_backup}"
RCLONE_BUCKET="${RCLONE_BUCKET:-space-exspace-backups}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/space_exspace_backup_${TIMESTAMP}.dump"
LOG_PREFIX="[$(date +"%Y-%m-%d %H:%M:%S")]"

mkdir -p "${BACKUP_DIR}"

echo "${LOG_PREFIX} Starting daily PostgreSQL backup for database '${DB_NAME}'..."

# 1. Execute pg_dump inside the database container using custom compressed format (-Fc)
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker exec -t "${CONTAINER_NAME}" pg_dump \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    -Fc \
    --no-owner \
    --no-privileges \
    > "${BACKUP_FILE}"
else
  # Fallback to host pg_dump if database is installed natively
  echo "${LOG_PREFIX} Container ${CONTAINER_NAME} not found, attempting host pg_dump..."
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" -Fc > "${BACKUP_FILE}"
fi

# 2. Verify file size is non-zero
FILE_SIZE=$(wc -c < "${BACKUP_FILE}" | tr -d ' ')
if [ "${FILE_SIZE}" -le 100 ]; then
  echo "${LOG_PREFIX} ❌ Backup failed: output file is suspiciously small (${FILE_SIZE} bytes)." >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi

echo "${LOG_PREFIX} ✅ Local backup successfully created: ${BACKUP_FILE} (${FILE_SIZE} bytes)"

# 3. Off-Site Replication via rclone to S3-compatible bucket
# INVARIANT: Must fail loudly if upload fails so monitoring/cron immediately alerts operations
RCLONE_DEST="${RCLONE_REMOTE}:${RCLONE_BUCKET}/daily/$(basename "${BACKUP_FILE}")"
echo "${LOG_PREFIX} Initiating off-site copy to ${RCLONE_DEST} via rclone..."

if ! command -v rclone &> /dev/null; then
  echo "${LOG_PREFIX} ❌ FATAL ERROR: 'rclone' executable not found in PATH! Off-site S3 backup failed." >&2
  echo "${LOG_PREFIX} Install rclone and configure remote '${RCLONE_REMOTE}' to enable off-site backups." >&2
  exit 10
fi

if ! rclone copyto "${BACKUP_FILE}" "${RCLONE_DEST}" --stats 10s --stats-one-line; then
  echo "${LOG_PREFIX} ❌ FATAL ERROR: rclone upload of ${BACKUP_FILE} to ${RCLONE_DEST} FAILED!" >&2
  exit 20
fi

echo "${LOG_PREFIX} ✅ Off-site S3 backup successfully replicated to ${RCLONE_DEST}"

# 4. Cleanup local backups older than retention window
echo "${LOG_PREFIX} Purging local backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "space_exspace_backup_*.dump" -mtime +"${RETENTION_DAYS}" -exec rm -v {} \;

echo "${LOG_PREFIX} Backup routine completed successfully."
