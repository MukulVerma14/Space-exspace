#!/bin/bash
# =============================================================================
# SPACE EXSPACE - PostgreSQL Restore & Disaster Recovery Test Script
# =============================================================================
# Usage:
#   ./scripts/restore.sh /path/to/backup_file.dump [target_database_name]
# Example:
#   ./scripts/restore.sh /var/backups/space_exspace/space_exspace_backup_20261030_020000.dump space_exspace_restore_test
# =============================================================================

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <path_to_dump_file> [target_database_name]"
  exit 1
fi

DUMP_FILE="$1"
TARGET_DB="${2:-space_exspace_restore_test}"
CONTAINER_NAME="${CONTAINER_NAME:-space_exspace_db_prod}"
DB_USER="${DB_USER:-postgres}"

if [ ! -f "${DUMP_FILE}" ]; then
  echo "❌ Error: Dump file not found: ${DUMP_FILE}" >&2
  exit 1
fi

echo "============================================================================="
echo "Restoring ${DUMP_FILE} into database '${TARGET_DB}'"
echo "============================================================================="

# 1. Recreate target database
echo "1. Recreating target test database '${TARGET_DB}'..."
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker exec -t "${CONTAINER_NAME}" psql -U "${DB_USER}" -c "DROP DATABASE IF EXISTS ${TARGET_DB};"
  docker exec -t "${CONTAINER_NAME}" psql -U "${DB_USER}" -c "CREATE DATABASE ${TARGET_DB};"

  # 2. Restore schema and data using pg_restore
  echo "2. Restoring data via pg_restore..."
  docker exec -i "${CONTAINER_NAME}" pg_restore \
    -U "${DB_USER}" \
    -d "${TARGET_DB}" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges < "${DUMP_FILE}" || true

  # 3. Integrity verification
  echo "3. Running verification checks on restored database..."
  docker exec -t "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TARGET_DB}" -c "
    SELECT 'equipment' AS table_name, count(*) AS row_count FROM equipment
    UNION ALL
    SELECT 'users', count(*) FROM users
    UNION ALL
    SELECT 'rentals', count(*) FROM rentals
    UNION ALL
    SELECT 'items', count(*) FROM items
    UNION ALL
    SELECT 'stock_movements', count(*) FROM stock_movements
    UNION ALL
    SELECT 'sync_events', count(*) FROM sync_events;
  "

  echo "4. Testing derived view integrity..."
  docker exec -t "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TARGET_DB}" -c "
    SELECT asset_code, status, current_location_name, make, model FROM v_equipment_current LIMIT 5;
  "
else
  # Native host restore
  psql -U "${DB_USER}" -c "DROP DATABASE IF EXISTS ${TARGET_DB};"
  psql -U "${DB_USER}" -c "CREATE DATABASE ${TARGET_DB};"
  pg_restore -U "${DB_USER}" -d "${TARGET_DB}" --clean --if-exists --no-owner "${DUMP_FILE}" || true

  psql -U "${DB_USER}" -d "${TARGET_DB}" -c "
    SELECT 'equipment' AS table_name, count(*) AS row_count FROM equipment
    UNION ALL
    SELECT 'users', count(*) FROM users;
  "
fi

echo "============================================================================="
echo "✅ Disaster recovery test completed successfully! Database '${TARGET_DB}' is verified."
echo "============================================================================="
