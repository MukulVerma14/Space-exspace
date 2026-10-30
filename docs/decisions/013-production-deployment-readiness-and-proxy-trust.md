# ADR 013: Production Deployment Readiness, Proxy Trust Architecture, and Demonstration Seeding Safeguards

## Status
Accepted

## Context
As SPACE EXSPACE prepares to deploy the equipment and materials tracking platform to live production infrastructure, architectural decisions were required across four operational dimensions:
1. **Containerization & Minimal Attack Surface**: How to package the TypeScript backend into a lean, secure, production-grade container without bloating image size with build tools or running as root.
2. **Reverse Proxy IP Forwarding (`trust proxy`)**: When deployed behind an edge TLS reverse proxy (Nginx, Caddy, Cloudflare, or AWS ALB), how Express resolves client IP addresses for brute-force rate limiters and audit logs.
3. **Database Integrity & Seed Safeguards**: How to prevent catastrophic accidental data overwrites in production while retaining the capability to initialize demo environments with controlled credentials.
4. **Environment Validation & Fail-Fast Boot**: How to ensure bad configurations, weak passwords, or default development secrets crash the process before handling a single user request.

---

## Decisions

### 1. Multi-Stage Docker Build (`builder` + `runner`)
We implement a multi-stage Dockerfile based on `node:20-alpine`:
- **Builder Stage**: Installs development dependencies and compilers (`python3`, `make`, `g++` for native bcrypt builds), copies TypeScript source, and compiles to JavaScript in `/app/dist`.
- **Runner Stage**: Creates a clean, stripped Alpine image containing only production dependencies (`npm ci --omit=dev`), the compiled `/dist` directory, and `/migrations`.
- **Non-Root Execution**: Runs under the unprivileged `node` user (UID 1000) rather than `root`.
- **PID 1 Signal Handling**: Uses `dumb-init` as the container entrypoint to correctly receive and propagate `SIGTERM` and `SIGINT` signals, ensuring Express finishes in-flight requests and closes database connection pools cleanly.

### 2. Upstream Proxy Trust (`app.set('trust proxy', 1)`)
We configure Express with `app.set('trust proxy', 1)`:
- In production, client traffic terminates at an edge reverse proxy (e.g., Nginx, Caddy, or AWS ALB) which forwards requests to Node.js over an internal bridge network (`127.0.0.1:3000`).
- Without `trust proxy: 1`, Express ignores `X-Forwarded-For` and inspects only the socket address (`127.0.0.1` or the proxy's internal container IP). This causes `loginRateLimiter` (10 attempts per 15 minutes) to bucket all users under the proxy's IP, meaning one user's failed attempts lock out the entire company.
- By configuring `trust proxy: 1`, Express trusts exactly one proxy hop, accurately reading the genuine client IP address from the rightmost client entry in `X-Forwarded-For` while preventing IP spoofing via arbitrary client-forged headers.

### 3. Production Database Seed Safeguards (`ALLOW_DEMO_SEED`)
The database seeder (`seedDatabase()`) enforces strict runtime environment guards:
- **Default Production Refusal**: If `NODE_ENV === 'production'`, `seedDatabase()` immediately logs an error and throws an exception, aborting the transaction before issuing any SQL commands.
- **Explicit Override (`ALLOW_DEMO_SEED=true`)**: Only when `ALLOW_DEMO_SEED=true` is explicitly injected into the environment can the seed script proceed in production (intended for dedicated demo or staging instances).
- **Externalized Credentials**: Demo passwords are never hardcoded or taken from README documentation; they must be provided via `DEMO_ADMIN_PASSWORD` and `DEMO_STAFF_PASSWORD` environment variables.

### 4. Strict Environment Validation with Zod
The environment loader (`backend/src/config/env.ts`) uses Zod refinements to enforce fail-fast security constraints on server startup:
- When `NODE_ENV === 'production'`, the server refuses to boot if `JWT_SECRET` is set to the default development secret (`dev_jwt_secret_must_be_changed_in_production_min32chars`).
- If `ALLOW_DEMO_SEED === 'true'` in production, both `DEMO_ADMIN_PASSWORD` and `DEMO_STAFF_PASSWORD` must be defined with at least 8 characters.
- `CORS_ORIGIN` must be explicitly configured from the environment and cannot be omitted.

### 5. Deployment Infrastructure Strategy (Hardened VPS Baseline)
- For the initial release, the platform deploys via `docker-compose.prod.yml` on a dedicated Linux VPS located nearest to Saudi Arabia.
- Daily backups are automated via `scripts/backup_daily.sh` utilizing `pg_dump -Fc` with automated 14-day rotation.
- Disaster recovery is codified and verified via `scripts/restore.sh`.
- The architecture maintains clean stateless separation so the backend can transition to AWS ECS/Fargate and AWS RDS PostgreSQL when operational volume scales.

---

## Alternatives Considered & Rejected

1. **Running Single-Stage Docker Containers with Dev Dependencies**:
   - *Rejected*: Including TypeScript, compilers, and devDependencies inflates image size from ~180MB to >1GB, increases container attack surface, and risks leaving development tools accessible to attackers in production.
2. **Trusting All Proxies (`app.set('trust proxy', true)`)**:
   - *Rejected*: Setting `trust proxy: true` trusts every proxy in the chain, allowing malicious clients to send forged `X-Forwarded-For: 1.2.3.4` headers and spoof their IP address to bypass rate limiters or falsify audit trails. Trusting exactly 1 hop (`trust proxy: 1`) restricts trust to the immediate infrastructure proxy.
3. **Leaving Demo Passwords in README for Production Seeding**:
   - *Rejected*: Storing default passwords in public or team-shared documentation causes immediate credential compromise if a staging or production instance is inadvertently exposed.
4. **Deploying Directly to Fully Managed Serverless (e.g. AWS Lambda + Aurora Serverless)**:
   - *Rejected for MVP*: High cold-start latencies, complex VPC peering for database access, unpredictable billing costs, and data residency compliance friction in the Middle East. A dedicated containerized VPS provides predictable low latency, complete data sovereignty, and \$10/month predictability.
