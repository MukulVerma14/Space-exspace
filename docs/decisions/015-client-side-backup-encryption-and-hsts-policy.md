# ADR 015: Client-Side Backup Encryption (rclone crypt), Write-Only S3 Ingress, and Stepwise HSTS Rollout

## Status
Accepted

## Context
Following the baseline Caddy ingress and automated daily backup routines implemented in Steps 6b and 6c, two operational security risks required formal mitigation for SPACE EXSPACE:
1. **Cloud Backup Exposure & Lateral Compromise**:
   - Storing unencrypted database dumps in cloud object storage exposes all client contracts, equipment telemetry, and user hashes if the cloud bucket permissions are misconfigured.
   - If backup scripts run with full read/write/delete S3 credentials, an attacker gaining root access on the production VPS could download historical dumps, wipe the S3 bucket, or overwrite backups with ransom payloads.
2. **HSTS Domain Pinning Risk**:
   - HTTP Strict Transport Security (`HSTS`) protects users against SSL-stripping and man-in-the-middle attacks by forcing browsers to connect only via HTTPS.
   - However, deploying aggressive HSTS headers (`max-age=31536000; includeSubDomains; preload`) during initial pilot or demo stages creates severe availability risks: if subdomains are not HTTPS-ready, or if DNS/certificates need emergency reconfiguration, client browsers will refuse to connect for an entire year.

---

## Decisions

### 1. Client-Side Encryption via `rclone crypt` (NaCl SecretBox)
We implement client-side encryption layered directly over the S3 remote using `rclone crypt`:
- **Cryptographic Standard**: Uses NaCl SecretBox (`XSalsa20` stream cipher with `Poly1305` MAC) for data encryption and `EME` (ECB-Mix-ECB with AES) for filename obfuscation.
- **Zero Plaintext Wire Exposure**: Dumps are encrypted in-memory as they stream from the host; plaintext archives never leave the server or touch the cloud provider unencrypted.
- **Key Custody**: The master passphrase (`BACKUP_CRYPT_PASSPHRASE`) and salt (`BACKUP_CRYPT_SALT`) are supplied via environment variables or a root-only file (`/etc/space_exspace/backup_crypt.key`, `chmod 600`), never stored in version control.
- **Dual Custody Mandate**: Because recovery is impossible without the crypt passphrase, it must be stored in two distinct off-server safe locations (enterprise password manager and a sealed offline physical envelope in the corporate safe).

### 2. Write-Only S3 IAM Upload Credentials (`s3:PutObject` Only)
The S3 credentials provisioned on the production server for `scripts/backup_daily.sh` are strictly **write-only**:
- **Permitted**: `s3:PutObject` on `space-exspace-backups/daily/*`.
- **Denied**: `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject`.
- **Compromise Containment**: If the production host is compromised, an attacker cannot read past backups, cannot list bucket contents to map company assets, and cannot delete or ransom previous dumps.

### 3. Serverless Lifecycle Retention over Script Deletion
Because write-only credentials cannot list or delete remote objects, `scripts/backup_daily.sh` does not perform remote pruning:
- Cloud backup retention is delegated to **S3 Bucket Lifecycle Rules** (e.g. automatic expiration after 30 days).
- Local disk retention remains at 14 days using standard filesystem cleanup (`find -mtime +14 -exec rm`).

### 4. Separate Read-Only Restore Credentials and Encryption Proof Verification
Restoration and disaster recovery drills use separate credentials:
- **Off-Server Read Credentials**: The read-only IAM credential (`s3:GetObject`, `s3:ListBucket`) is never stored on the production server; it is supplied only at drill time by the authorized operator.
- **Encryption Proof Check**: `scripts/restore.sh` explicitly validates that raw encrypted dumps cannot be read by `pg_restore` or database utilities without the crypt passphrase before initiating decryption.

### 5. Configurable Stepwise HSTS Header (`HSTS_MAX_AGE`)
We configure Caddy to inject `Strict-Transport-Security: max-age={$HSTS_MAX_AGE:300}` without `includeSubDomains` or `preload`:
- **Default for Demo/Staging**: `300` seconds (5 minutes) to ensure that testing and pilot domain adjustments do not permanently pin browser state.
- **Stepwise Production Rollout**:
  - Phase 1 (Demo): 300s (5 minutes)
  - Phase 2 (Initial Stable Deployment): 86400s (1 day)
  - Phase 3 (Intermediate Staging): 604800s (1 week)
  - Phase 4 (Mature Stable Domain): 31536000s (1 year)
- **Omission of `includeSubDomains` and `preload`**: Protects other potential company subdomains (e.g. legacy intranet tools or staging subdomains) from being bricked.

---

## Alternatives Considered & Rejected

1. **S3 Server-Side Encryption (SSE-S3 / SSE-KMS)**:
   - *Rejected as sole protection*: Server-side encryption decrypts transparently whenever credentials with `s3:GetObject` are used. If cloud credentials or AWS consoles are compromised, server-side encrypted files are instantly readable. Client-side encryption ensures ciphertext is unreadable even if the S3 bucket is made public.
2. **Read/Write Credentials with In-Script Remote Pruning (`rclone delete`)**:
   - *Rejected*: Granting `s3:DeleteObject` and `s3:ListBucket` to the production server creates a fatal vulnerability where a compromised server or buggy script can wipe all off-site backups.
3. **Hardcoded Long HSTS (`max-age=31536000; includeSubDomains; preload`) on Day One**:
   - *Rejected*: Irreversible in browser caches. Serving a 1-year HSTS header during staging or initial domain configuration can permanently break access if DNS or certificates require changes.
4. **Storing Encryption Passphrase in `.env` Checked into Git**:
   - *Rejected*: Catastrophic security failure. Keys must exist only in memory, in root-only protected files (`chmod 600`), and in secure offsite key escrow.
