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

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/space_exspace_backup_${TIMESTAMP}.dump"
LOG_PREFIX="[$(date +"%Y-%m-%d %H:%M:%S")]"

mkdir -p "${BACKUP_DIR}"

echo "${LOG_PREFIX} Starting daily PostgreSQL backup for database '${DB_NAME}'..."

# Execute pg_dump inside the database container using custom compressed format (-Fc)
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

# Verify file size is non-zero
FILE_SIZE=$(wc -c < "${BACKUP_FILE}" | tr -d ' ')
if [ "${FILE_SIZE}" -le 100 ]; then
  echo "${LOG_PREFIX} ❌ Backup failed: output file is suspiciously small (${FILE_SIZE} bytes)." >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi

echo "${LOG_PREFIX} ✅ Backup successfully created: ${BACKUP_FILE} (${FILE_SIZE} bytes)"

# Cleanup backups older than retention window
echo "${LOG_PREFIX} Purging backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "space_exspace_backup_*.dump" -mtime +"${RETENTION_DAYS}" -exec rm -v {} \;

echo "${LOG_PREFIX} Backup routine completed successfully."
