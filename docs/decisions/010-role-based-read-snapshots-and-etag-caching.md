# ADR 010: Role-Based Read Snapshots and ETag Caching for Offline Mobile Clients

## Status
Accepted

## Context
Technicians and yard staff using the Space Exspace field app frequently operate in areas with intermittent or zero cellular connectivity (e.g. remote desert staging sites, coastal industrial plants in Ras Tanura and Jubail, or reinforced concrete workshops).

Before heading into the field, mobile clients need to download a coherent operational snapshot of the business domain to local device storage (SQLite or IndexedDB):
1. **Equipment Fleet**: Equipment assets with their current derived status (`available`, `rented`, `under_repair`) and location IDs to allow offline validation and scanning.
2. **Locations Registry**: Active yards, client project sites, and workshops.
3. **Materials & Consumables**: Spare parts, cables, lubricants, and current stock on hand to allow immediate offline issuance checks.

However, three primary architectural challenges arise:
- **Commercial Data Leakage**: Field staff devices must never store commercial rates, rental prices, or vendor procurement costs locally. If an employee's phone is inspected or compromised offline, client commercial terms must remain confidential.
- **Bandwidth Consumption on High-Frequency Polling**: Mobile devices checking for updates when regaining connectivity could easily flood the backend and exhaust field cellular data if downloading entire snapshot payloads on every reconnection.
- **Clock Drift Detection**: Field mobile device clocks frequently drift or get set incorrectly by users. Clients need an authoritative server timestamp to measure skew before generating offline events.

## Decisions

### 1. Unified Operational Snapshot Endpoint (`GET /api/sync/snapshot`)
We implement a single endpoint (`GET /api/sync/snapshot`) accessible to authenticated staff and administrators that consolidates the operational data needed for offline work into one atomic response:
- `equipment`: Derived fleet status and locations directly from `v_equipment_current`.
- `locations`: Active operational sites.
- `materials`: Material items with aggregated `stock_on_hand` calculated from the append-only `stock_movements` ledger.
- `server_time`: Authoritative ISO 8601 UTC timestamp of snapshot generation.
- `etag`: Content hash identifying this exact state version.

### 2. Strict Role-Based Sanitization (Zero Rates for Staff)
- Before the snapshot payload is hashed or returned to the client, it is processed through `sanitizeFinancials(rawSnapshot, userRole)`.
- For `staff` callers, all financial fields (`applied_rate`, `rate_unit`, `unit_cost`, `unit_price`, `cost`, `standard_rates`, `vat_included`) are strictly omitted.
- For `admin` callers, standard rate cards (`standard_rates`) are attached to enable offline pricing review and quotations work.
- This enforces defense-in-depth: staff offline caches physically cannot leak rate cards because the server never transmits them.

### 3. Deterministic SHA-256 ETag and HTTP 304 `Not Modified` Caching
- The server computes a deterministic SHA-256 hash across the serialized, role-sanitized snapshot payload:
  `etag = 'W/"' + sha256(JSON.stringify(sanitizedSnapshot)).substring(0, 32) + '"'`.
- The ETag is returned in the `ETag` HTTP response header and as a property in the JSON payload.
- On subsequent synchronization attempts or reconnection checks, mobile clients send the standard HTTP request header `If-None-Match: <etag>`.
- If no equipment has moved, no stock has changed, and no locations have updated since that ETag, the server immediately returns HTTP `304 Not Modified` with zero response body, saving device battery and cellular bandwidth.
- If any operational state has changed, the server returns HTTP `200 OK` with the fresh snapshot and updated ETag.

### 4. Authoritative Server Time for Skew Calibration
- Every HTTP 200 response contains `server_time: new Date().toISOString()`.
- Mobile clients use this server timestamp to compute the device's clock delta:
  `device_skew_ms = Date.now() - Date.parse(server_time)`.
- When generating subsequent offline events (`occurred_at`), the client can calibrate event timestamps or warn the worker if their device clock is dangerously ahead of server time, avoiding `CLOCK_SKEW_EXCEEDED` rejections at sync time.

## Alternatives Considered & Rejected

1. **Individual Entity REST Endpoints (`/api/equipment`, `/api/locations`, `/api/materials`)**:
   - *Rejected*: In high-latency cellular conditions, opening 3-4 separate HTTP requests increases connection handshake overhead, risks inconsistent cross-entity states (e.g. equipment at a location not yet fetched), and requires coordinating 4 separate ETags. A single consolidated snapshot guarantees atomic baseline consistency.
2. **Delta / Incremental Change Feeds (e.g., GraphQL Subscriptions or SSE)**:
   - *Rejected*: Field devices are completely offline for hours at a time; streaming connections fail in dead zones. A lightweight conditional GET with `If-None-Match` provides 95% of the bandwidth savings with zero connection state management on the server.
3. **Client-Side Financial Masking**:
   - *Rejected*: Sending commercial rates to the mobile client and relying on the frontend UI to hide them is an unacceptable security risk. Server-side stripping ensures that data at rest on technician phones contains zero financial data.

## Consequences
- Clean separation of operational field data from sensitive financial rates.
- Near-zero bandwidth overhead on frequent reconnection checks via HTTP 304.
- Deterministic offline readiness for mobile field applications.
