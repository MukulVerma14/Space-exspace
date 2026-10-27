# ADR 005: Server-Side Rate Serialization and JWT Authentication with Active Account Verification

## Context
SPACE EXSPACE has two distinct user roles confirmed by the client:
1. **Admin**: Full access to all business operations, including proprietary rate cards (hourly, daily, weekly, monthly in SAR), rental contracts, agreed client pricing, invoices, and maintenance costs.
2. **Staff (Yard / Field Crew)**: Operational access focused on scanning equipment QR codes, inspecting assets, moving equipment between yards and job sites, and logging repairs.

The client requirement explicitly mandates that **staff must NOT be able to view rates or financial data**. Equipment pricing and rental margins are confidential commercial intelligence. Furthermore, yard staff frequently use personal mobile browsers or field tablets on yard Wi-Fi networks where tokens could theoretically be stored or network traffic inspected.

## Decision
We implement a defense-in-depth security architecture composed of five pillars:

1. **Stateless JWT with Shift-Aligned Expiry (8 Hours)**:
   - JSON Web Tokens signed using HMAC SHA-256 (`HS256`) via a validated `JWT_SECRET`.
   - The token payload carries non-sensitive identity claims: `sub` (user ID), `email`, `role`, and `name`.
   - Token lifespan is set to 8 hours, aligning with a standard operational shift at the equipment yard.

2. **Database Active Account Verification on Every Authenticated Request**:
   - Pure stateless JWTs suffer from a known vulnerability: if a staff member is terminated or reassigned, their token remains valid until expiry.
   - The `authenticate` middleware decodes the JWT and immediately executes a indexed primary key check (`SELECT id, active FROM users WHERE id = $1`). If `active = false` or the user was deleted, the request is rejected with `401 Unauthorized`.
   - This provides the scalability of JWTs combined with **instant access revocation**.

3. **Role-Based Access Control (RBAC) Route Guards**:
   - `requireRole('admin')` middleware blocks unauthorized HTTP requests before controller execution. Staff attempting to call `/api/rates` receive a strict `403 Forbidden`.

4. **Mandatory Server-Side Rate Serialization (`sanitizeFinancials`)**:
   - On endpoints shared across both roles (e.g., equipment details, rental orders, repair logs), response objects pass through a recursive server-side serializer.
   - When `req.user.role !== 'admin'`, all sensitive keys (`applied_rate`, `rates`, `amount`, `unit_price`, `unit_cost`, `subtotal`, `vat_amount`, `total`, `discount_note`, `cost`) are physically deleted before `res.json()` transmits the payload.
   - Staff network responses contain only operational data (asset codes, equipment types, locations, rental status), making it impossible for a tech-savvy user to discover rates via browser DevTools.

5. **Brute-Force Rate Limiting**:
   - `loginRateLimiter` restricts IP addresses to 10 login attempts per 15-minute window (relaxed to 100 in automated test environments), mitigating dictionary and credential stuffing attacks.

## Alternatives Considered

1. **Frontend-Only Conditional Rendering (`{role === 'admin' && <Price />}`)**:
   - *Why rejected*: A severe security anti-pattern. If the API returns `{ applied_rate: 1200.00 }` in the JSON payload, any staff user can open Chrome DevTools, inspect the Network tab, or view the React component props in Redux/DevTools to read confidential contract rates. Security must be enforced on the server.
2. **Separate Database Views for Admin vs Staff (`v_equipment_admin` vs `v_equipment_staff`)**:
   - *Why rejected*: Doubling database views introduces schema bloat, code duplication, and synchronization hazards whenever columns change. A unified relational view combined with a deterministic TypeScript serialization filter provides clean separation of concerns without database fragmentation.
3. **Stateful Server-Side Sessions with Redis Store**:
   - *Why rejected*: Unnecessary operational overhead for a prototype demo. Introducing a Redis instance complicates deployment and maintenance without measurable benefit for a system with ~145 equipment assets and two initial users.

## Consequences

### Positive
- **Guaranteed Data Confidentiality**: Sensitive financial fields never travel across the wire to staff clients.
- **Immediate Account Revocation**: Deactivating a user in PostgreSQL immediately invalidates active sessions without waiting for JWT expiration.
- **Explainable Defense in Depth**: Final-year student can clearly articulate why client-side security is insufficient and how server-side serialization prevents data exfiltration.
- **Brute-Force Protection**: Rate limiting prevents automated credential discovery.

### Negative / Trade-offs
- Each authenticated request performs a fast indexed query (`WHERE id = $1`) against PostgreSQL. For high-scale systems this can be cached in Redis with short TTLs, but for this prototype (~145 items, dozens of users) the sub-millisecond query overhead is negligible compared to the revocation guarantee.
- Controllers returning models with financial properties must remember to call `sanitizeFinancials()` or apply an automated serialization middleware.
