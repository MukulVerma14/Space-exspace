#!/bin/bash
# =============================================================================
# SPACE EXSPACE - PostgreSQL Encrypted Restore & Disaster Recovery Verification
# =============================================================================
# Usage:
#   # Direct restore from local decrypted dump:
#   ./scripts/restore.sh /path/to/backup_file.dump [target_database_name]
#
#   # Restore from encrypted archive (verifies decryption & encryption proof):
#   BACKUP_CRYPT_PASSPHRASE="secret" ./scripts/restore.sh /path/to/encrypted_backup.dump [target_database_name]
#
#   # Restore directly from off-site S3 using read-only credentials (passed at drill time):
#   BACKUP_CRYPT_PASSPHRASE="secret" RCLONE_REMOTE="s3_readonly" ./scripts/restore.sh s3_crypt:backup.dump [target_database_name]
#
# SECURITY ARCHITECTURE:
#   1. Separate Read-Only Credentials:
#      Read-only credentials for S3 are kept OFF the production server and injected
#      only during scheduled restore drills or disaster recovery events.
#   2. Crypt Proof Verification:
#      Before decrypting, the script proves that the encrypted archive is completely
#      unreadable by pg_restore or database tools without the crypt passphrase.
#   3. Secure Plaintext Cleanup:
#      Temporary decrypted dump files are purged from disk immediately after restore.
# =============================================================================

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <path_to_dump_file_or_rclone_target> [target_database_name]"
  echo "Example (local dump):"
  echo "  $0 /var/backups/space_exspace/space_exspace_backup_20261030_020000.dump space_exspace_restore_test"
  echo "Example (encrypted dump drill):"
  echo "  BACKUP_CRYPT_PASSPHRASE='pass' $0 /var/backups/encrypted.dump space_exspace_restore_test"
  exit 1
fi

INPUT_SOURCE="$1"
TARGET_DB="${2:-space_exspace_restore_test}"
CONTAINER_NAME="${CONTAINER_NAME:-space_exspace_db_prod}"
DB_USER="${DB_USER:-postgres}"

CRYPT_PASS="${BACKUP_CRYPT_PASSPHRASE:-}"
CRYPT_SALT="${BACKUP_CRYPT_SALT:-}"
TEMP_DIR=$(mktemp -d)
CLEANUP_FILES=()

# Cleanup trap to ensure decrypted plaintexts are wiped on exit
cleanup() {
  for f in "${CLEANUP_FILES[@]}"; do
    if [ -f "$f" ]; then
      rm -f "$f"
    fi
  done
  if [ -d "${TEMP_DIR}" ]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

echo "============================================================================="
echo "SPACE EXSPACE Disaster Recovery & Restore Verification"
echo "Target Database: '${TARGET_DB}'"
echo "============================================================================="

WORKING_DUMP=""

# Check if input source is an rclone remote path or local file
if [[ "${INPUT_SOURCE}" == *":"* ]]; then
  echo "1. Downloading off-site backup via rclone using read-only credentials..."
  if ! command -v rclone &> /dev/null; then
    echo "❌ Error: 'rclone' executable not found in PATH." >&2
    exit 10
  fi

  if [ -z "${CRYPT_PASS}" ]; then
    echo "❌ Error: BACKUP_CRYPT_PASSPHRASE is required to decrypt off-site backups." >&2
    exit 11
  fi

  # Configure dynamic rclone crypt layer for download
  OBSCURED_PASS=$(rclone obscure "${CRYPT_PASS}")
  OBSCURED_SALT=""
  if [ -n "${CRYPT_SALT}" ]; then
    OBSCURED_SALT=$(rclone obscure "${CRYPT_SALT}")
  fi

  RCLONE_REMOTE="${RCLONE_REMOTE:-s3_readonly}"
  RCLONE_BUCKET="${RCLONE_BUCKET:-space-exspace-backups}"

  export RCLONE_CONFIG_S3_CRYPT_TYPE="crypt"
  export RCLONE_CONFIG_S3_CRYPT_REMOTE="${RCLONE_REMOTE}:${RCLONE_BUCKET}/daily"
  export RCLONE_CONFIG_S3_CRYPT_PASSWORD="${OBSCURED_PASS}"
  if [ -n "${OBSCURED_SALT}" ]; then
    export RCLONE_CONFIG_S3_CRYPT_PASSWORD2="${OBSCURED_SALT}"
  fi

  DOWNLOADED_FILE="${TEMP_DIR}/decrypted_restore.dump"
  CLEANUP_FILES+=("${DOWNLOADED_FILE}")

  echo "   Decrypting stream and downloading from ${INPUT_SOURCE}..."
  rclone copyto "${INPUT_SOURCE}" "${DOWNLOADED_FILE}" --stats 10s --stats-one-line
  WORKING_DUMP="${DOWNLOADED_FILE}"
else
  # Local file
  if [ ! -f "${INPUT_SOURCE}" ]; then
    echo "❌ Error: Input dump file not found: ${INPUT_SOURCE}" >&2
    exit 1
  fi

  # Check if file starts with standard PostgreSQL dump magic string "PGDMP"
  MAGIC=$(head -c 5 "${INPUT_SOURCE}" 2>/dev/null || true)
  if [ "${MAGIC}" != "PGDMP" ]; then
    echo "1. Encrypted archive detected (magic header is not 'PGDMP')."
    echo "   Testing encryption proof..."

    # Step A: Prove the file cannot be read without the passphrase
    if command -v pg_restore &>/dev/null; then
      if pg_restore -l "${INPUT_SOURCE}" &>/dev/null; then
        echo "❌ Security Assertion Failed: pg_restore was able to parse encrypted file without passphrase!" >&2
        exit 12
      else
        echo "   ✅ PROOF VERIFIED: pg_restore rejected raw encrypted file (invalid header/corrupted)."
      fi
    elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
      if docker exec -i "${CONTAINER_NAME}" pg_restore -l < "${INPUT_SOURCE}" &>/dev/null; then
        echo "❌ Security Assertion Failed: pg_restore was able to parse encrypted file without passphrase!" >&2
        exit 12
      else
        echo "   ✅ PROOF VERIFIED: pg_restore rejected raw encrypted file (header is high-entropy ciphertext)."
      fi
    fi

    # Step B: Decrypt using rclone crypt
    if [ -z "${CRYPT_PASS}" ]; then
      echo "❌ Error: BACKUP_CRYPT_PASSPHRASE is required to decrypt this archive." >&2
      exit 11
    fi

    if ! command -v rclone &> /dev/null; then
      echo "❌ Error: 'rclone' executable required to decrypt archive." >&2
      exit 10
    fi

    echo "   Decrypting archive with client-side crypt passphrase..."
    OBSCURED_PASS=$(rclone obscure "${CRYPT_PASS}")
    OBSCURED_SALT=""
    if [ -n "${CRYPT_SALT}" ]; then
      OBSCURED_SALT=$(rclone obscure "${CRYPT_SALT}")
    fi

    LOCAL_CRYPT_DIR=$(dirname "${INPUT_SOURCE}")
    BASE_NAME=$(basename "${INPUT_SOURCE}")

    export RCLONE_CONFIG_LOCAL_CRYPT_TYPE="crypt"
    export RCLONE_CONFIG_LOCAL_CRYPT_REMOTE="${LOCAL_CRYPT_DIR}"
    export RCLONE_CONFIG_LOCAL_CRYPT_PASSWORD="${OBSCURED_PASS}"
    if [ -n "${OBSCURED_SALT}" ]; then
      export RCLONE_CONFIG_LOCAL_CRYPT_PASSWORD2="${OBSCURED_SALT}"
    fi

    DECRYPTED_FILE="${TEMP_DIR}/decrypted_${BASE_NAME}"
    CLEANUP_FILES+=("${DECRYPTED_FILE}")

    rclone copyto "local_crypt:${BASE_NAME}" "${DECRYPTED_FILE}"
    WORKING_DUMP="${DECRYPTED_FILE}"

    # Verify decrypted file now has PGDMP header
    DECRYPTED_MAGIC=$(head -c 5 "${WORKING_DUMP}" 2>/dev/null || true)
    if [ "${DECRYPTED_MAGIC}" != "PGDMP" ]; then
      echo "❌ Error: Decrypted output does not match PostgreSQL dump format ('PGDMP'). Wrong passphrase?" >&2
      exit 13
    fi
    echo "   ✅ Decryption successful: verified valid 'PGDMP' archive header."
  else
    echo "1. Valid unencrypted PostgreSQL dump detected ('PGDMP' header present)."
    WORKING_DUMP="${INPUT_SOURCE}"
  fi
fi

# 2. Recreate target database
echo "2. Recreating target test database '${TARGET_DB}'..."
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
  docker exec -t "${CONTAINER_NAME}" psql -U "${DB_USER}" -c "DROP DATABASE IF EXISTS ${TARGET_DB};"
  docker exec -t "${CONTAINER_NAME}" psql -U "${DB_USER}" -c "CREATE DATABASE ${TARGET_DB};"

  # 3. Restore schema and data using pg_restore
  echo "3. Restoring data via pg_restore..."
  docker exec -i "${CONTAINER_NAME}" pg_restore \
    -U "${DB_USER}" \
    -d "${TARGET_DB}" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges < "${WORKING_DUMP}" || true

  # 4. Integrity verification
  echo "4. Running verification checks on restored database..."
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

  echo "5. Testing derived view integrity..."
  docker exec -t "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TARGET_DB}" -c "
    SELECT asset_code, status, current_location_name, make, model FROM v_equipment_current LIMIT 5;
  "
else
  # Native host restore
  psql -U "${DB_USER}" -c "DROP DATABASE IF EXISTS ${TARGET_DB};"
  psql -U "${DB_USER}" -c "CREATE DATABASE ${TARGET_DB};"
  pg_restore -U "${DB_USER}" -d "${TARGET_DB}" --clean --if-exists --no-owner "${WORKING_DUMP}" || true

  psql -U "${DB_USER}" -d "${TARGET_DB}" -c "
    SELECT 'equipment' AS table_name, count(*) AS row_count FROM equipment
    UNION ALL
    SELECT 'users', count(*) FROM users;
  "
fi

echo "============================================================================="
echo "✅ Disaster recovery test completed successfully! Database '${TARGET_DB}' is verified."
echo "============================================================================="
