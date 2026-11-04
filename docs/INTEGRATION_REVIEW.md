# SPACE EXSPACE — Post-Merge Integration Review

**Date**: 2026-11-04  
**Status**: Completed  
**Scope**: Full end-to-end integration audit across Frontend (`frontend/src`), Backend (`backend/src`), and Architecture Specifications (`docs/API.md`, `docs/ARCHITECTURE.md`).  

---

## Executive Summary

A comprehensive post-merge integration review was conducted across the SPACE EXSPACE codebase following the completion of features F1 through F-O4 and F-I1 through F-I4. The platform exhibits robust foundations in database constraints, rate stripping, append-only ledgers, role enforcement, and modular frontend structure. 

The audit evaluated six specific dimensions:
1. **Contract Integrity**: Every frontend API call verified against `docs/API.md`.
2. **Security Posture**: JWT storage, XSS exposure, financial redaction for staff, logout wipe, and cache scoping.
3. **Offline & Sync Protocol**: Client clock calibration, UUIDs, outbox durability, concurrency locks, jittered backoff, 401 handling, rejection review, and offline polling guards.
4. **Request Leaks & Performance**: Polling intervals, effect hooks, debounce coverage, and inflight deduplication.
5. **Feature Completeness**: Status matrix of F1 through F-O4 and F-I1 through F-I4.
6. **Code Hygiene**: Mock artifacts, hardcoded credentials, logging hygiene, dead code, and run documentation.

---

## Finding Severity Matrix

| Severity | Count | Summary |
|---|:---:|---|
| **Blocker** | 1 | Contract response payload wrapper mismatch on `PATCH /api/invoices/:id/payment` (`invoicesSource.ts` / `InvoicesPage.tsx`) causing `undefined` invoice numbers in audit confirmations. |
| **Major** | 3 | Sequential fleet pagination cold start burst (`equipmentSource.ts`), JWT in `localStorage` without CSRF/XSS defense, lack of fine-grained 403 alert dialogs. |
| **Minor** | 5 | Client clock offset not reset on logout, missing continuous camera scanner debounce, leftover dead mock data (`equipmentMock.ts`), unused dev hook export (`simulateNext401`), README run step clarifications. |

---

## 1. Contract Review (Frontend vs `docs/API.md`)

### Endpoint Audit Table

| # | Endpoint & Method | Frontend Caller File | Backend Controller | Status | Contract Finding / Details |
|---|---|---|---|:---:|---|
| 1 | `POST /api/auth/login` | `frontend/src/api/client.ts` (`loginRequest`) | `backend/src/controllers/authController.ts` (`login`) | **PASS** | Exact match. Request `{ email, password }` parses `{ token, user }`. Rate limiting (429) and invalid credentials (401) errors propagated cleanly. |
| 2 | `GET /api/auth/me` | `frontend/src/api/client.ts` (`meRequest`) | `backend/src/controllers/authController.ts` (`me`) | **PASS** | Exact match. Returns `{ user: { id, name, email, role } }`. 401 triggers session purge in `AuthContext.tsx`. |
| 3 | `GET /api/equipment` | `frontend/src/data/equipmentSource.ts` (`fetchLiveEquipment`) | `backend/src/controllers/equipmentController.ts` (`listEquipment`) | **PASS** | Exact match. Queries `page` and `limit`. Parses `{ items, pagination: { page, limit, total, totalPages, hasNext, hasPrev } }`. Live failure sets `error` notice and falls back to snapshot. |
| 4 | `GET /api/materials` | `frontend/src/data/materialsSource.ts` (`loadMaterials`) | `backend/src/controllers/materialsController.ts` (`listMaterials`) | **PASS** | Exact match. Queries `category_id`, `low_stock`, `q`. Parses `{ data: MaterialItem[] }`. Offline or network failure gracefully falls back to cached snapshot. |
| 5 | `GET /api/materials/:id/price-history` | `frontend/src/data/materialsSource.ts` (`fetchMaterialPriceHistory`) | `backend/src/controllers/materialsController.ts` (`getMaterialPriceHistory`) | **PASS** | Exact match. Admin-only. Server returns 403 for staff; frontend additionally enforces client-side check. Parses `{ item_id, price_history, valuation }`. Receipts from voided invoices are filtered. |
| 6 | `GET /api/materials/:id/movements` | `frontend/src/data/materialsSource.ts` (`fetchMaterialMovements`) | `backend/src/controllers/materialsController.ts` (`getMaterialMovements`) | **PASS** | Exact match. Accessible to admin and staff. Backend scrubs `unit_cost` for staff via `sanitizeFinancials()`. Returns `{ data: MaterialMovement[] }`. |
| 7 | `GET /api/invoices` | `frontend/src/data/invoicesSource.ts` (`fetchInvoices`) | `backend/src/controllers/invoicesController.ts` (`listInvoices`) | **PASS** | Exact match. Admin-only. Supports `direction`, `status`, `party_id`, `page`, `limit`. Parses `{ data, pagination: { page, limit, total, total_pages } }`. |
| 8 | `GET /api/invoices/:id` | `frontend/src/data/invoicesSource.ts` (`fetchInvoiceById`) | `backend/src/controllers/invoicesController.ts` (`getInvoiceById`) | **PASS** | Exact match. Admin-only. Parses `{ data: { ...invoice, lines } }`. File references are handled strictly as plain text. |
| 9 | `POST /api/invoices/supplier` | `frontend/src/data/invoicesSource.ts` (`createSupplierInvoice`) | `backend/src/controllers/invoicesController.ts` (`createSupplierInvoice`) | **PASS** | Exact match. Admin-only. Sends full invoice header with line items. Backend recalculates subtotal with `decimal.js` and updates material price history and stock receipts. Duplicate returns 409. |
| 10 | `POST /api/invoices/customer` | `frontend/src/data/invoicesSource.ts` (`createCustomerInvoice`) | `backend/src/controllers/invoicesController.ts` (`createCustomerInvoice`) | **PASS** | Exact match. Admin-only. Store-only workflow (zero stock movements). Verifies customer party, optional rental contract, and decimal math reconciliation. Returns 201 with computed totals. |
| 11 | `PATCH /api/invoices/:id/payment` | `frontend/src/data/invoicesSource.ts` (`markInvoicePayment`) | `backend/src/controllers/invoicesController.ts` (`markInvoicePayment`) | **BLOCKER** | **Payload Wrapper Mismatch**: Backend returns `{ message, data: { id, direction, invoice_no, status, paid_on, paid_by } }`. Frontend interface `MarkInvoicePaymentResponse` expects flat fields (`invoice_no`, `paid_on`). In `InvoicesPage.tsx` line 169, `res.invoice_no` and `res.paid_on` evaluate to `undefined`. |
| 12 | `POST /api/sync` | `frontend/src/sync/syncClient.ts` (`sendBatch`) | `backend/src/controllers/syncController.ts` (`processSyncBatch`) | **PASS** | Exact match. Transforms frontend outbox events into `{ events: [...] }` payload. Parses `{ processed, results }`. Correctly splits `accepted` and `rejected` IDs. Propagates 401 for sync manager halt. |

### Error Handling & HTTP Status Code Behaviour
- **401 Unauthorized**: Correctly handled across the entire client. In `AuthContext.tsx`, an expired token triggers automatic session wipe and redirects to `/login`. In `syncManager.ts`, receiving a 401 halts batch retries immediately, flags `authExpired: true`, preserves the outbox, and alerts the user.
- **403 Forbidden**: [MAJOR] `client.ts` throws `ApiRequestError(403)`. While role guards redirect unprivileged staff attempting to access `/admin/*`, direct API calls lack dedicated permission alert modals and display the generic server error string.

---

## 2. Security Review

### 2.1 JWT Storage & XSS Exposure ([MAJOR])
- **Current State**: The JWT token is persisted in browser `localStorage` under `sx_token` (`frontend/src/api/client.ts`).
- **Risk Assessment**: If a script injection occurs on the origin, tokens can be accessed via JavaScript.
- **Mitigation & Future Work**:
  - React's JSX text node escaping provides default XSS mitigation.
  - Zero raw HTML injection patterns exist in the frontend.
  - Documented in `docs/OPEN_QUESTIONS.md`: Production architecture should migrate to `httpOnly`, `Secure`, `SameSite=Strict` cookies once backend cookie handling is provisioned.

### 2.2 `dangerouslySetInnerHTML` ([PASS])
- A codebase-wide scan confirmed **zero occurrences** of `dangerouslySetInnerHTML`.
- All user input and dynamic content (including invoice file references and notes) are rendered via standard React text nodes.

### 2.3 Financial Fields Leakage for Staff ([PASS])
- **Backend Serializer**: `sanitizeFinancials()` in `backend/src/serializers/rateSerializer.ts` physically strips `daily_rate`, `rates`, `rate_cards`, `unit_price`, `unit_cost`, `subtotal`, `vat_amount`, `total`, and `cost` whenever `req.user.role === 'staff'`.
- **Client Layer**: 
  - `formatMoney()` in `frontend/src/data/materialsSource.ts` strictly checks `if (userRole !== 'admin') return '';`.
  - `MaterialsPage.tsx` renders price history tabs and valuation cards only when `user?.role === 'admin'`.
  - `InvoicesPage.tsx` is completely barred from staff by `RequireAuth(role="admin")`.

### 2.4 IndexedDB & Cache Cleared on Logout ([PASS])
- `logout()` in `AuthContext.tsx` calls `wipeOfflineData()`, which invokes `clearAllOfflineData()` in `frontend/src/offline/db.ts`.
- Wipes all records from the `snapshots` and `session` IndexedDB stores.
- The `outbox` store is intentionally preserved on standard logout so field workers do not silently lose un-synced yard entries, but users are prompted if switching accounts.
- `clearToken()` purges `sx_token` from `localStorage`.

### 2.5 Per-User Cache Keys ([PASS])
- Snapshot store keys are scoped by user ID: `${userId}:${name}` (`equipmentSource.ts` and `materialsSource.ts`).
- Outbox store maintains an index `byUser` on `userId`, ensuring `listEvents(userId)` strictly isolates one technician's actions from another on shared mobile hardware.

---

## 3. Offline & Sync Protocol Review

### 3.1 Client Clock Skew Compensation ([PASS])
- **Requirement**: Prevent `CLOCK_SKEW_EXCEEDED` rejections when device time drifts > 5 minutes.
- **Implementation**:
  - `frontend/src/offline/clock.ts`: `calibrateClockFromServerTime()` computes $\Delta t = \text{server\_time} - \text{Date.now()}$.
  - `frontend/src/api/client.ts`: Automatically calibrates $\Delta t$ on **every** HTTP response from the HTTP `Date` response header or body `server_time`.
  - `frontend/src/offline/outbox.ts`: `enqueueEvent()` sets `occurredAt: getCalibratedNowIso()`, applying the calibrated offset.
  - Persisted in `localStorage` (`sx_clock_offset_ms`) so offline dead zones retain accurate calibration.

### 3.2 UUID Per Event ([PASS])
- `newEventId()` in `frontend/src/offline/outbox.ts` generates RFC 4122 v4 UUIDs using `crypto.randomUUID()` with a cryptographically secure fallback (`crypto.getRandomValues`) for unencrypted local HTTP contexts.

### 3.3 Outbox Persistence ([PASS])
- Events are persisted to IndexedDB store `outbox` (database `sx-offline`, version 2) before any network transmission is attempted.

### 3.4 Concurrency Guard ([PASS])
- `syncManager.ts` enforces a module-level `inFlight` boolean guard. Overlapping triggers (such as network flapping or rapid button clicks) are dropped while a sync batch is in flight.

### 3.5 Exponential Backoff with Jitter ([PASS])
- `backoffDelay(attempt)` computes $\min(60000, 2000 \times 2^{\text{attempt}}) \times (0.5 + \text{random})$.
- Capped at 5 attempts, after which syncing pauses until the next browser `online` event or manual retry.

### 3.6 Rejection Visibility & User Review ([PASS])
- Rejections returned by the backend (`status === 'rejected'`) are updated in IndexedDB with `status: 'rejected'` and `rejectReason`.
- `OutboxBadge.tsx` displays rejected items in an expandable review drawer, offering a red warning tag, reason description, and an explicit "Discard" action.

### 3.7 Offline Polling Guard ([PASS])
- Zero `setInterval` polling exists.
- Sync runs strictly on app initialization (if online), browser `online` window events, and explicit manual trigger buttons.
- All network fetches verify `navigator.onLine` before executing.

---

## 4. Request Leaks & Performance

### 4.1 Interval Polling ([PASS])
- Confirmed zero occurrences of `setInterval` or recursive `setTimeout` polling loops in the frontend.

### 4.2 Effect Loops ([PASS])
- All `useEffect` hooks across `EquipmentListPage`, `MaterialsPage`, and `InvoicesPage` have clean dependency arrays and include `cancelled` booleans for in-flight cleanup.

### 4.3 Search Input Debounce ([PASS])
- Debounced at 300ms via `useDebounce`:
  - `EquipmentListPage.tsx`: Equipment search input.
  - `MaterialsPage.tsx`: Material SKU and catalog search input.
  - `NewSupplierInvoiceModal.tsx`: Dynamic line item search dropdown.
  - `NewCustomerInvoiceModal.tsx`: Dynamic customer line search dropdown.

### 4.4 Camera Scanner Stream Debounce ([MINOR])
- Continuous video stream decoding is not yet hooked up to a physical camera feed. When a camera scanner component is added, decodes must be debounced to prevent duplicate events per video frame.

### 4.5 Fleet Pagination Bursts ([MAJOR])
- `fetchLiveEquipment` in `equipmentSource.ts` iterates sequentially across up to 200 pages (`MAX_PAGES = 200`, `limit = 100`). For a 5,000 asset fleet, this generates 50 sequential HTTP requests on first load. Migrating initial cold-start hydration to `GET /api/sync/snapshot` (Endpoint 27) with ETag caching is recommended.

---

## 5. Feature Status Table (F1 through F-O4 & F-I1 through F-I4)

| Feature ID | Scope / Requirements | Status | Notes / Verification |
|---|---|:---:|---|
| **F1** | Scaffold, API Client, Login, Role Routing, `/me`, Logout | **DONE** | Full state machine (`booting → authenticated`), token management, and role-based redirect guards. |
| **F2** | Equipment List, Debounced Search, Status Filter | **DONE** | Debounced search, status pills, live fetch with IndexedDB snapshot fallback and error notice. |
| **F-O1** | Installable PWA, Offline App Shell, Online/Offline Badge | **DONE** | Service worker asset caching, Web App Manifest, reactive online badge with auto-fade. |
| **F-O2** | IndexedDB Snapshot, Per-User Keying, Wipe on Logout | **DONE** | `sx-offline` database with `snapshots` and `session` stores; purged cleanly on sign-out. |
| **F-O3** | Outbox: Staff Actions Stored Locally First | **DONE** | RFC 4122 UUID v4, calibrated `occurredAt`, durable storage, rejection review UI. |
| **F-O4** | Sync Manager: Batch Send Queued Events to Server | **DONE** | Connected to real `POST /api/sync`; backoff with jitter, 401 halt, zero polling. |
| **F-I1** | Materials Stock List, Low-Stock Badges, Price History | **DONE** | Stock on hand calculated from append-only ledger; admin price history & valuation; staff amounts scrubbed. |
| **F-I2** | Invoices Page: Received/Issued Tabs, Detail Drawer, Badges | **DONE** | Paginated table, status filtering, detail drawer with line items, plain-text file references. |
| **F-I3** | New Supplier Invoice Modal with Dynamic Lines | **DONE** | Dynamic line items, debounced catalog search, server authority decimal validation, duplicate 409 alerts. |
| **F-I4** | New Customer Invoice Modal & Mark Paid Settlement Action | **DONE** | Customer invoice recording, rental ID linkage, settlement date modal, audit logging. |

---

## 6. Code Hygiene & Deployment

### 6.1 Leftover Mock Data ([MINOR])
- `frontend/src/mocks/equipmentMock.ts`: Contains `MOCK_EQUIPMENT` (175 lines of static mock items) that is never used at runtime (only the TypeScript interface `MockEquipment` is imported).
- `frontend/src/sync/syncClient.ts`: Contains `simulateNext401()` which is a test utility exported into production code.

### 6.2 Hardcoded URLs & Secrets ([PASS])
- Zero hardcoded API base URLs or backend connection strings in frontend source files.
- All API calls utilize relative `/api/*` paths routed via Vite dev proxy or production reverse proxy.
- Demo credential pre-fills in `LoginPage.tsx` are strictly gated behind `import.meta.env.DEV`.

### 6.3 Console Statements ([PASS])
- No stray `console.log` debugging prints in production code.
- Only defensive `console.warn` statements for IndexedDB quota errors and `console.error` for auth rehydration failures.

### 6.4 Dead Code ([MINOR])
- Unused static array in `frontend/src/mocks/equipmentMock.ts`.

### 6.5 README Run Steps ([MINOR])
- Root `README.md` details environment configuration, migrations, seeds, and execution steps (`npm run dev`, `npm run dev:frontend`, `npm run dev:backend`).
- All scripts match `package.json` workspaces.

---

## Prioritized Action Plan (Fixing Blockers Only)

Following the strict rule to remediate **ONLY** items ranked as **Blocker**:

### Remediating Blocker 1: Align `markInvoicePayment` Contract Response Schema
1. **Root Cause**:
   Backend `invoicesController.ts` and `docs/API.md` Endpoint 25 specify:
   ```json
   {
     "message": "Invoice marked as paid successfully",
     "data": {
       "id": 5,
       "direction": "issued",
       "invoice_no": "INV-SE-2026-0099",
       "status": "paid",
       "paid_on": "2026-11-02",
       "paid_by": 1
     }
   }
   ```
   Frontend `frontend/src/data/invoicesSource.ts` defines:
   ```ts
   export interface MarkInvoicePaymentResponse {
     message: string;
     invoice_id: number;
     invoice_no: string;
     status: 'paid';
     paid_on: string;
     paid_by: number;
   }
   ```
   And `InvoicesPage.tsx` accesses `res.invoice_no` and `res.paid_on` directly, leading to `undefined` values in user audit notices.

2. **Fix Steps**:
   - Update `MarkInvoicePaymentResponse` in `frontend/src/data/invoicesSource.ts` to include `{ message: string; data: { id: number; direction: string; invoice_no: string; status: 'paid'; paid_on: string; paid_by: number; } }` (or provide backwards-compatible getters).
   - Update `InvoicesPage.tsx` to read `res.data.invoice_no` and `res.data.paid_on`.
   - Update `frontend/src/__tests__/invoicesSource.test.ts` to assert against the contract `{ message, data }`.
   - Run `npm run test:frontend` and `npm run build:frontend` to verify complete resolution.
   - Record fix in `docs/LEARNING_LOG.md`.
