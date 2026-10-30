#!/bin/bash
# =============================================================================
# SPACE EXSPACE - Automated Daily PostgreSQL Encrypted Backup Script
# =============================================================================
# Usage:
#   ./scripts/backup_daily.sh
# Crontab entry (daily at 02:00 AM AST):
#   0 2 * * * /path/to/scripts/backup_daily.sh >> /var/log/space_exspace_backup.log 2>&1
#
# SECURITY ARCHITECTURE:
#   1. Client-Side Encryption:
#      PostgreSQL dumps are encrypted on-the-fly via rclone "crypt" (NaCl SecretBox
#      XSalsa20-Poly1305) before leaving the server. Unencrypted dumps are never
#      transmitted over the wire or stored in cloud object storage.
#   2. Key Custody:
#      Passphrase and salt come from environment variables (BACKUP_CRYPT_PASSPHRASE,
#      BACKUP_CRYPT_SALT) or a root-only file (/etc/space_exspace/backup_crypt.key).
#      They must NEVER be stored in the code repository or printed to logs.
#   3. Write-Only IAM Credentials:
#      The S3 credential used on this server must have write-only permissions
#      (s3:PutObject only, with NO s3:GetObject, s3:ListBucket, or s3:DeleteObject).
#      If the server is compromised, attackers cannot read past backups or purge them.
#   4. Remote Retention:
#      Because write-only credentials cannot list or delete remote objects,
#      remote backup retention is managed strictly via S3 Bucket Lifecycle Rules
#      (e.g., expire objects after 30 days). Local 14-day disk rotation is preserved.
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

# Encryption keys source (root-only file or environment variables)
KEY_FILE="${BACKUP_CRYPT_KEY_FILE:-/etc/space_exspace/backup_crypt.key}"
CRYPT_PASS="${BACKUP_CRYPT_PASSPHRASE:-}"
CRYPT_SALT="${BACKUP_CRYPT_SALT:-}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/space_exspace_backup_${TIMESTAMP}.dump"
LOG_PREFIX="[$(date +"%Y-%m-%d %H:%M:%S")]"

mkdir -p "${BACKUP_DIR}"

echo "${LOG_PREFIX} Starting daily PostgreSQL backup for database '${DB_NAME}'..."

# 1. Resolve and validate client-side encryption keys
# Read from root-only key file if environment variables are not set
if [ -z "${CRYPT_PASS}" ] && [ -f "${KEY_FILE}" ]; then
  # Ensure permissions on key file are restricted to owner (root) only (chmod 600 or 400)
  KEY_PERMS=$(stat -c "%a" "${KEY_FILE}" 2>/dev/null || stat -f "%OLp" "${KEY_FILE}" 2>/dev/null || echo "unknown")
  if [ "${KEY_PERMS}" != "600" ] && [ "${KEY_PERMS}" != "400" ] && [ "${KEY_PERMS}" != "unknown" ]; then
    echo "${LOG_PREFIX} ⚠️ WARNING: Key file ${KEY_FILE} has loose permissions (${KEY_PERMS}). Should be 600 or 400." >&2
  fi
  # Source key file without printing contents
  # Expected format: BACKUP_CRYPT_PASSPHRASE=... \n BACKUP_CRYPT_SALT=...
  # shellcheck disable=SC1090
  source "${KEY_FILE}"
  CRYPT_PASS="${BACKUP_CRYPT_PASSPHRASE:-}"
  CRYPT_SALT="${BACKUP_CRYPT_SALT:-}"
fi

if [ -z "${CRYPT_PASS}" ]; then
  echo "${LOG_PREFIX} ❌ FATAL ERROR: BACKUP_CRYPT_PASSPHRASE is not set in environment or key file (${KEY_FILE})!" >&2
  echo "${LOG_PREFIX} Dumps must be encrypted client-side before off-site transmission. Refusing unencrypted upload." >&2
  exit 11
fi

# 2. Execute pg_dump inside the database container using custom compressed format (-Fc)
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
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

# 3. Verify dump file size is non-zero
FILE_SIZE=$(wc -c < "${BACKUP_FILE}" | tr -d ' ')
if [ "${FILE_SIZE}" -le 100 ]; then
  echo "${LOG_PREFIX} ❌ Backup failed: output file is suspiciously small (${FILE_SIZE} bytes)." >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi

echo "${LOG_PREFIX} ✅ Local backup archive created: ${BACKUP_FILE} (${FILE_SIZE} bytes)"

# 4. Off-Site Replication via rclone "crypt" layered remote to S3-compatible bucket
# INVARIANT: Must fail loudly if upload fails so monitoring/cron immediately alerts operations
if ! command -v rclone &> /dev/null; then
  echo "${LOG_PREFIX} ❌ FATAL ERROR: 'rclone' executable not found in PATH! Off-site encrypted backup failed." >&2
  echo "${LOG_PREFIX} Install rclone and configure base remote '${RCLONE_REMOTE}' to enable off-site backups." >&2
  exit 10
fi

echo "${LOG_PREFIX} Initializing rclone client-side crypt layer over ${RCLONE_REMOTE}:${RCLONE_BUCKET}/daily..."

# Obscure password and salt for rclone config consumption (without logging secrets)
OBSCURED_PASS=$(rclone obscure "${CRYPT_PASS}")
OBSCURED_SALT=""
if [ -n "${CRYPT_SALT}" ]; then
  OBSCURED_SALT=$(rclone obscure "${CRYPT_SALT}")
fi

# Configure dynamic rclone crypt remote layered over the S3-compatible remote
export RCLONE_CONFIG_S3_CRYPT_TYPE="crypt"
export RCLONE_CONFIG_S3_CRYPT_REMOTE="${RCLONE_REMOTE}:${RCLONE_BUCKET}/daily"
export RCLONE_CONFIG_S3_CRYPT_PASSWORD="${OBSCURED_PASS}"
if [ -n "${OBSCURED_SALT}" ]; then
  export RCLONE_CONFIG_S3_CRYPT_PASSWORD2="${OBSCURED_SALT}"
fi
export RCLONE_CONFIG_S3_CRYPT_FILENAME_ENCRYPTION="standard"
export RCLONE_CONFIG_S3_CRYPT_DIRECTORY_NAME_ENCRYPTION="true"

# Define destination on encrypted remote
RCLONE_DEST="s3_crypt:$(basename "${BACKUP_FILE}")"
echo "${LOG_PREFIX} Uploading encrypted stream to off-site S3 storage (client-side encrypted)..."

# Upload file via rclone crypt. Never print secrets to stdout/stderr.
if ! rclone copyto "${BACKUP_FILE}" "${RCLONE_DEST}" --stats 15s --stats-one-line; then
  echo "${LOG_PREFIX} ❌ FATAL ERROR: rclone encrypted upload of $(basename "${BACKUP_FILE}") FAILED!" >&2
  # Clean up memory config
  unset RCLONE_CONFIG_S3_CRYPT_PASSWORD RCLONE_CONFIG_S3_CRYPT_PASSWORD2
  exit 20
fi

# 5. Remote object existence verification
# Where write-only permissions allow reading (or in staging/test environments), verify object exists.
# With strict write-only credentials (s3:PutObject only), S3 returns HTTP 200 on PUT, which rclone verifies.
if rclone lsf "${RCLONE_DEST}" &>/dev/null; then
  echo "${LOG_PREFIX} ✅ Verified encrypted remote object exists via read check: ${RCLONE_DEST}"
else
  # In production with write-only IAM policies (PutObject only), read/list returns 403 Forbidden.
  echo "${LOG_PREFIX} ℹ️ Read check skipped or denied by IAM policy (expected when using write-only s3:PutObject credentials)."
  echo "${LOG_PREFIX} ✅ Client-side encrypted upload confirmed via rclone HTTP 200 exit status."
fi

# Clean up sensitive credentials from environment
unset RCLONE_CONFIG_S3_CRYPT_PASSWORD RCLONE_CONFIG_S3_CRYPT_PASSWORD2 OBSCURED_PASS OBSCURED_SALT CRYPT_PASS CRYPT_SALT

# 6. Cleanup local backups older than retention window (14 days)
# Note: Remote S3 retention is handled by S3 Bucket Lifecycle Rules (e.g. 30 days) because write-only credentials cannot delete.
echo "${LOG_PREFIX} Purging local backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "space_exspace_backup_*.dump" -mtime +"${RETENTION_DAYS}" -exec rm -v {} \;

echo "${LOG_PREFIX} Backup routine completed successfully."
