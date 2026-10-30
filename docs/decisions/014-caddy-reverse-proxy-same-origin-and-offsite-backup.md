# ADR 014: Caddy Edge Reverse Proxy, Same-Origin Architecture, Mobile Camera Secure Context, and Off-Site S3 Backups

## Status
Accepted

## Context
Following the baseline containerization established in Step 6b, the SPACE EXSPACE demonstration and production environment required operational hardening across five key areas:
1. **Automated TLS & Reverse Proxying**: Field mobile devices and yard workers require secure HTTPS connections. Manually provisioning and renewing SSL/TLS certificates via Certbot introduces administrative failure points when certificates expire.
2. **CORS Friction & Same-Origin Delivery**: Deploying the frontend SPA on a separate origin or port from the REST API introduces Cross-Origin Resource Sharing (CORS) preflight requests (`OPTIONS`), cookie/credential transmission blockers, and complex domain white-listing.
3. **Mobile Camera QR Scanner Constraints**: Modern mobile browsers (Safari on iOS, Chrome on Android) strictly require a **Secure Context (HTTPS)** for `navigator.mediaDevices.getUserMedia`. Insecure HTTP origins block camera hardware access entirely.
4. **Disaster Recovery & Off-Site Replication**: Storing database backups strictly on the local VPS disk leaves the company vulnerable to total data loss if the server hypervisor or disk fails. Off-site replication to S3-compatible cloud storage must be automated and must **fail loudly** on errors.
5. **Cryptographic Secret Strength**: JWT tokens secure all yard and administrative sessions. A short or weak `JWT_SECRET` in production exposes session tokens to offline dictionary and brute-force attacks.

---

## Decisions

### 1. Caddy v2 as the Automated TLS Reverse Proxy
We adopt **Caddy v2** as the edge ingress reverse proxy in `docker-compose.prod.yml`:
- **Automatic HTTPS**: Caddy manages TLS certificate acquisition, OCSP stapling, and renewals automatically via Let's Encrypt and ZeroSSL using ACME HTTP-01 / TLS-ALPN-01 challenges.
- **Modern Performance**: Caddy provides out-of-the-box support for HTTP/2, HTTP/3 (QUIC over UDP 443), and modern streaming compression (`zstd` and `gzip`).
- **Production Security Headers**: Caddy injects HTTP Strict Transport Security (`HSTS`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(self)`.

### 2. Same-Origin Frontend & Backend Architecture
We configure Caddy to serve both the frontend and backend under the exact same domain origin:
- `/api/*` and `/health` requests are reverse-proxied internally to `backend:3000`.
- Root path and SPA route fallbacks (`try_files {path} /index.html`) serve the compiled React static files directly from `/srv`.
- **Elimination of CORS**: Because client requests to `/api` originate from the exact same domain and scheme as the web application, the browser treats all requests as same-origin. Preflight `OPTIONS` overhead is eliminated and authentication headers pass without cross-origin browser blocking.

### 3. Mobile Camera QR Scanning Requires HTTPS Secure Context
HTML5 QR code scanning in the mobile browser relies on the W3C Media Capture and Streams API (`getUserMedia`). The W3C specification strictly restricts this capability to Secure Contexts (HTTPS or `localhost`). By placing Caddy at the ingress layer with automatic TLS, field technicians scanning equipment labels in yards are guaranteed valid HTTPS access, preventing browser camera permission errors.

### 4. Single Upstream Proxy Hop Trust (`trust proxy: 1`)
Express is configured with `app.set('trust proxy', 1)`:
- In our topology, Caddy sits directly in front of Node.js as the single proxy hop. Caddy appends the remote client IP into `X-Forwarded-For`.
- Express trusts this single hop, ensuring `req.ip` correctly reflects the field technician's IP address rather than Caddy's internal container address.
- This ensures `loginRateLimiter` isolates brute-force attack attempts per individual client rather than throttling the entire company through a shared proxy IP.
- If an additional upstream layer (such as Cloudflare CDN or an AWS ALB) is introduced later, the hop count must be adjusted to `2` or configured with trusted subnet CIDR ranges.

### 5. Off-Site S3 Replication via `rclone` with Loud Failure
The daily backup script (`scripts/backup_daily.sh`) incorporates automated off-site synchronization:
- After creating a compressed PostgreSQL archive (`pg_dump -Fc`) and verifying its non-empty size, the script uploads the archive to an S3-compatible bucket via `rclone copyto`.
- **Loud Failure Invariant**: If `rclone` is not installed or configured, the script exits with **exit code 10**. If the off-site upload fails, the script exits with **exit code 20**. It never fails silently, ensuring cron monitoring systems and ops pagers are immediately triggered.
- We codify a mandatory **Monthly Disaster Recovery Restore Drill** in `docs/DEPLOY.md` to ensure backup archives are regularly tested against clean target databases.

### 6. Strict Production JWT Secret Length Validation (>= 32 Characters)
The environment validation schema (`backend/src/config/env.ts`) enforces that in `NODE_ENV=production`, `JWT_SECRET` must be strictly **at least 32 characters long**. Any attempt to start the production server with a short key or the default development key fails fast at process startup.

---

## Alternatives Considered & Rejected

1. **Nginx with Certbot Cron Containers**:
   - *Rejected*: Requires managing multiple containers or host cron jobs for certificate renewals, handling renewal hooks, and coordinating reload signals. Caddy manages the entire certificate lifecycle natively in-memory with zero external cron dependencies.
2. **Hosting Frontend on S3/CloudFront and API on Separate Domain (`api.spaceexspace.com`)**:
   - *Rejected for Phase 1*: Introduces cross-origin CORS overhead, requires separate DNS management, complicates cookie policies, and increases monthly cloud costs. A single VPS running Caddy serving both static files and API proxying provides optimal latency, simplified maintenance, and zero CORS friction.
3. **Silent Backup Replication Failure (Soft Warnings)**:
   - *Rejected*: In many operations, backup scripts log a warning and exit 0 when an S3 upload fails. This leads to months of unnoticed backup failures until a catastrophic event occurs. Failing loudly with distinctive non-zero exit codes (10, 20) ensures alerts are impossible to ignore.
4. **Relaxed Secret Lengths in Production**:
   - *Rejected*: Weak secrets (e.g. 8-16 characters) can be cracked offline using modern GPU rigs in seconds. Mandating 32 characters in production ensures sufficient cryptographic entropy for HMAC-SHA256 token signatures.
