# ADR 018: Prototype JWT Storage in LocalStorage, XSS Defenses, and Production Same-Origin HttpOnly Cookie Strategy

## Status
Accepted

## Context
During initial rapid prototyping and local development of the SPACE EXSPACE Progressive Web Application (PWA), authentication was implemented using stateless JSON Web Tokens (JWT) stored in browser `localStorage` (`frontend/src/api/client.ts`). As the application transitions toward production deployment readiness (documented in ADR 013 and ADR 014), the integration audit (`docs/INTEGRATION_REVIEW.md` Section 2.1) highlighted the security implications of client-accessible token storage:

1. **XSS Exposure Risk**:
   Any JavaScript execution vulnerability (e.g. cross-site scripting via unescaped user input, third-party dependency compromise, or malicious script injection) grants full access to `window.localStorage`. An attacker executing arbitrary script in the client browser context could extract the stored JWT and impersonate the user across backend APIs until token expiration.

2. **Cross-Origin & PWA Architectural Trade-Offs**:
   In local development, the frontend Vite development server (`http://localhost:5173`) and Express backend API (`http://localhost:3000`) run on different origins/ports. Setting cross-origin credentials (`withCredentials: true`, cross-site cookies, SameSite=None) introduces substantial browser compatibility challenges across mobile PWA webviews and requires complex preflight CORS negotiation.

3. **Production Reverse Proxy Topology**:
   In the production architecture defined in ADR 014, Caddy reverse-proxies both static frontend assets and backend API endpoints under a unified origin (`https://spaceexspace.com` or private VPN intranet domain). This unified origin enables secure cookie policies that are impossible in cross-origin development configurations.

---

## Decisions

### 1. Prototype Mitigation in `localStorage`
For the current prototype release, client JWT storage in `localStorage` is maintained under the following strict frontend implementation invariants:
- **Zero Raw HTML Injection**: The application codebase strictly forbids `dangerouslySetInnerHTML`. All dynamic strings, equipment asset codes, notes, and user-generated text are rendered through standard React JSX expressions, guaranteeing automatic HTML entity escaping.
- **Plain Text Reference URLs**: External documents and physical file references (`file_url`) are constrained to plain text representations. Dangerous executable URL schemes (`javascript:`, `data:`, `vbscript:`) are rejected both on the client and server.
- **Defensive Session Wiping**:
  - Immediate token purge and offline IndexedDB cache invalidation on logout or server 401 token expiry.
  - Automatic cache clearing and clock offset reset when a different user account logs in on a shared field tablet.
  - Outbox actions are persisted securely in IndexedDB without exposing sensitive bearer credentials in storage.

### 2. Production Target: Same-Origin `httpOnly` Cookie Strategy
In production environments operating behind the Caddy reverse proxy:
1. **Cookie Configuration**:
   - `httpOnly`: The JWT auth token will be transmitted in an `httpOnly` cookie (`sx_auth`), rendering it completely inaccessible to client-side JavaScript (`document.cookie` cannot read or extract it), neutralizing XSS token theft.
   - `Secure`: Transmitted exclusively over TLS/HTTPS connections.
   - `SameSite=Strict` (or `Lax` for initial navigation): Ensures the cookie is never attached to unauthorized cross-site requests originating from external websites.
   - `Path=/api`: Scopes token transmission strictly to backend API requests.
2. **Same-Origin Reverse Proxy Routing (Caddy)**:
   - Caddy serves frontend static PWA bundles from root `/` and reverse-proxies `/api/*` directly to upstream Express containers.
   - This eliminates the need for cross-origin cookie sharing or wildcard CORS headers.
3. **Cross-Site Request Forgery (CSRF) Defense**:
   Because ambient browser cookies are vulnerable to CSRF when making state-modifying requests, the production migration will implement:
   - **Custom Header Requirement**: All mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) require a non-simple custom HTTP header (e.g. `X-Requested-With: XMLHttpRequest` or an Anti-CSRF token). Browsers will not send custom headers across origins without an explicit CORS preflight response permitting it.
   - **Double-Submit Cookie / Synchronizer Token Pattern**: A cryptographically random CSRF token issued by the server and validated on all state-altering mutation endpoints.

---

## Consequences

### Positive
- **Prototype Velocity**: Prototype development and testing remain unencumbered by cross-origin cookie quirks or local HTTPS self-signed certificate hurdles.
- **Clear Security Boundary**: Documenting the prototype status versus production target provides transparent guidance for security audits, penetration tests, and client compliance reviews.
- **Seamless Upgrade Path**: Because API communication is already centralized in `frontend/src/api/client.ts`, transitioning to cookie-based authentication requires changing only the client fetch credentials option (`credentials: 'same-origin'`) and backend cookie setters, leaving UI components untouched.

### Negative / Trade-Offs
- Until the production Caddy proxy and cookie migration are deployed, local development environments retain theoretical token exposure if an XSS vulnerability were introduced into application code or third-party packages.
