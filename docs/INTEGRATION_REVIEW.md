# SPACE EXSPACE — Post-Merge Integration Review

**Date**: 2026-10-30  
**Status**: Completed  
**Scope**: Full end-to-end integration audit across Frontend (`frontend/src`), Backend (`backend/src`), and Architecture Specifications (`docs/API.md`, `docs/ARCHITECTURE.md`).  

---

## Executive Summary

A comprehensive post-merge integration review was conducted across the SPACE EXSPACE codebase. The platform exhibits robust foundations in database constraints, rate stripping, append-only ledgers, role enforcement, and modular frontend structure. However, there are **three critical blockers** at the integration boundary between the frontend offline subsystem and the backend sync/equipment APIs:

1. **[BLOCKER] Disconnected Offline Sync Endpoint & Protocol**: The frontend sync client (`syncClient.ts`) is currently a mock targeting a nonexistent mock URL (`POST /api/sync/events`) with an incompatible payload schema (`{ accepted: string[], rejected: [] }`) instead of the real backend endpoint (`POST /api/sync`) which returns `{ processed: number, results: SyncPerEventResult[] }`.
2. **[BLOCKER] Missing Client Clock Skew Compensation**: `docs/API.md` (Endpoint 24) explicitly requires the client to compute $\Delta t = \text{server\_time} - \text{client\_now}$ from `/api/sync/snapshot` and calibrate `occurred_at`. The frontend outbox (`outbox.ts`) records raw local device time, causing rejection (`CLOCK_SKEW_EXCEEDED`) whenever the technician's device clock drifts > 5 minutes.
3. **[BLOCKER] Equipment Contract & Unhandled Live Fetch Failure**: `docs/API.md` documents `data` and `total_pages` for `GET /api/equipment`, whereas `equipmentController.ts` outputs `{ items, pagination: { totalPages, hasNext, ... } }`. Furthermore, `equipmentSource.ts` silently falls back to snapshot cache on network errors without notifying the user of degraded/stale state.

---

## Finding Severity Matrix

| Severity | Count | Summary |
|---|:---:|---|
| **Blocker** | 3 | Disconnected sync client mock, uncompensated client clock skew, equipment API contract drift & silent catch |
| **Major** | 3 | Sequential 200-page burst on live equipment fetch, JWT in `localStorage` without CSRF/XSS defense, generic 403 handling |
| **Minor** | 3 | Incomplete frontend run steps in root README, mock data file leftover (`equipmentMock.ts`), missing continuous scanner debounce |

---

## 1. Contract Review (Frontend vs `docs/API.md`)

### Endpoint Audit

#### A. `POST /api/auth/login`
- **Frontend Caller**: `frontend/src/api/client.ts` -> `loginRequest(email, password)`
- **Backend Handler**: `backend/src/controllers/authController.ts` -> `login`
- **Contract Status**: **MATCH (PASS)**
- **Findings**:
  - Request format matches `{ email, password }`.
  - Response parses `{ token, user: { id, name, email, role } }`.
  - Rate limiting (429) and bad credentials (401) error messages are propagated to the login UI.

#### B. `GET /api/auth/me`
- **Frontend Caller**: `frontend/src/api/client.ts` -> `meRequest()`
- **Backend Handler**: `backend/src/controllers/authController.ts` -> `me`
- **Contract Status**: **MATCH (PASS)**
- **Findings**:
  - Validates active token, returning `{ user }`.
  - Frontend boots offline session from IndexedDB cache if network fails, or purges session on 401.

#### C. `GET /api/equipment`
- **Frontend Caller**: `frontend/src/data/equipmentSource.ts` -> `fetchLiveEquipment()`
- **Backend Handler**: `backend/src/controllers/equipmentController.ts` -> `listEquipment`
- **Docs**: `docs/API.md` Endpoint 6
- **Contract Status**: **[BLOCKER] Contract Field Drift & Silent Catch**
- **Findings**:
  - **Field Mismatch**: `docs/API.md` specifies response root `{ data: [...], pagination: { page, limit, total, total_pages } }`. The backend implementation in `equipmentController.ts` actually returns `{ items: [...], pagination: { page, limit, total, totalPages, hasNext, hasPrev } }`.
  - While `equipmentSource.ts` aligns with the backend code's `items`, the divergence from `docs/API.md` creates a broken contract for external integrators.
  - **Error Suppression**: In `equipmentSource.ts`:
    ```ts
    try {
      const items = await fetchLiveEquipment();
      await saveSnapshot(userId, SNAPSHOT_NAME, items);
      return { items, source: 'live', savedAt: new Date().toISOString() };
    } catch {
      // Network or server error mid-load: fall through to the snapshot.
    }
    ```
    If the backend returns a 500 error or authentication error, the frontend silently swallows the error and renders whatever is in IndexedDB without indicating an error occurred.

#### D. `GET /api/sync/snapshot`
- **Frontend Caller**: Missing from `frontend/src`
- **Backend Handler**: `backend/src/controllers/syncController.ts` -> `getSyncSnapshot`
- **Docs**: `docs/API.md` Endpoint 24
- **Contract Status**: **[BLOCKER] Missing Endpoint Integration**
- **Findings**:
  - The frontend never calls `GET /api/sync/snapshot`. Instead, `equipmentSource.ts` paginates through `GET /api/equipment` page-by-page.
  - `GET /api/sync/snapshot` is designed specifically to provide atomic offline data (equipment, locations, materials) and crucially provides `server_time` for clock drift calibration.

#### E. `POST /api/sync`
- **Frontend Caller**: `frontend/src/sync/syncClient.ts`
- **Backend Handler**: `backend/src/controllers/syncController.ts` -> `processSyncBatch`
- **Docs**: `docs/API.md` Endpoint 25
- **Contract Status**: **[BLOCKER] Endpoint Disconnected (Mock Implemented)**
- **Findings**:
  - `frontend/src/sync/syncClient.ts` does NOT make an HTTP request. It contains a mock timer (`setTimeout`) and hardcoded rejection logic for `send_to_repair`.
  - Comments in `syncClient.ts` state `TODO(backend): replace with the real call once POST /api/sync/events exists`. The backend endpoint already exists at `POST /api/sync`.
  - The request body expected by `syncController.ts`:
    ```json
    {
      "events": [
        {
          "client_event_id": "<uuid>",
          "user_id": <int>,
          "type": "equipment.move" | "equipment.return" | "equipment.repair" | "material.goods_received" | "material.issue",
          "payload": { ... },
          "occurred_at": "<iso-timestamp>"
        }
      ]
    }
    ```
  - The response returned by `syncController.ts`:
    ```json
    {
      "processed": 1,
      "results": [
        {
          "client_event_id": "<uuid>",
          "status": "accepted" | "duplicate" | "rejected",
          "result": { ... },
          "error": "<error-code>",
          "message": "<human-message>"
        }
      ]
    }
    ```
  - The mock in `syncClient.ts` expects `{ accepted: string[], rejected: { id: string, reason: string }[] }`. These schemas are completely incompatible.

#### F. Error Handling: 401 & 403 Behaviour
- **401 Unauthorized**: Handled correctly across `AuthContext` and `syncManager`. On 401, `syncManager` stops syncing, flags `authExpired: true`, preserves the outbox, and alerts the user to re-authenticate.
- **403 Forbidden**: [MAJOR] `client.ts` throws `ApiRequestError(403)`. `RequireAuth` redirects unprivileged users to `/admin` or `/staff`, but in-page actions lack fine-grained permission alert dialogs.

---

## 2. Security Review

### 2.1 JWT Storage & XSS Risk ([MAJOR])
- **Current Implementation**: The JWT token is saved in browser `localStorage` under `sx_token` (`frontend/src/api/client.ts`).
- **Risk Assessment**: Any successful Cross-Site Scripting (XSS) attack could access `localStorage` and exfiltrate credentials.
- **Mitigation & Future Work**:
  - React's JSX escaping currently protects against HTML injection.
  - The CSP configured in Caddy (`Step 6c`) restricts script origins.
  - In production, transitioning to an `httpOnly`, `Secure`, `SameSite=Strict` cookie should be prioritized.

### 2.2 `dangerouslySetInnerHTML` ([PASS])
- Zero occurrences of `dangerouslySetInnerHTML` across all frontend code.
- All DOM insertions use React's default text node encoding.

### 2.3 Financial Fields Leakage ([PASS])
- Verification confirms that staff responses never receive money or rate fields.
- Backend serializer `sanitizeFinancials()` scrubs `daily_rate`, `rates`, `final_agreed_rate`, `unit_cost`, and `amount` whenever `req.user.role === 'staff'`.
- Frontend `MockEquipment` and card displays do not contain or request any financial data.

### 2.4 IndexedDB & Cache Wiped on Logout ([PASS])
- `clearAllOfflineData()` in `frontend/src/offline/db.ts` wipes both `snapshots` and `session` object stores upon sign-out or when another user logs in on the same device.
- Pending outbox actions are preserved across normal session expiration to prevent data loss, but are cleared if the user explicitly confirms "Sign out and discard".

### 2.5 Per-User Cache Keys ([PASS])
- IndexedDB snapshot cache keys are formatted as `${userId}:${snapshotName}`.
- Outbox events include an index on `byUser` (`userId`), ensuring `listEvents(userId)` strictly isolates one technician's events from another on a shared device.

---

## 3. Offline & Sync Protocol Review

### 3.1 Client Clock Skew Correction ([BLOCKER])
- **Requirement**: `docs/API.md` Endpoint 24 states:
  $$\Delta t = \text{server\_time} - \text{client\_now}$$
  Clients must add $\Delta t$ to local time when recording `occurred_at`.
- **Finding**: `frontend/src/offline/outbox.ts` line 49 executes `occurredAt: new Date().toISOString()` without applying any clock offset.
- **Impact**: If a technician's phone clock is set > 5 minutes ahead of server time, the backend `syncController.ts` clock skew check immediately rejects all queued events with `CLOCK_SKEW_EXCEEDED`.

### 3.2 UUID Per Event ([PASS])
- `newEventId()` generates a standard RFC 4122 v4 UUID with cryptographic entropy (`crypto.randomUUID` with fallback to `crypto.getRandomValues`).

### 3.3 Outbox Persistence ([PASS])
- Events are persisted to IndexedDB store `outbox` before any network activity is attempted.

### 3.4 Concurrency Guard ([PASS])
- `syncManager.ts` enforces an `inFlight` module boolean guard. Multiple sync triggers (e.g. rapid network reconnection) cannot trigger overlapping requests.

### 3.5 Exponential Backoff with Jitter ([PASS])
- `backoffDelay(attempt)` computes $2^n \times \text{BASE\_DELAY} \times (0.5 + \text{random})$ capped at 60s for up to 5 attempts.

### 3.6 Rejection Visibility & Review ([PASS])
- The `OutboxBadge.tsx` component displays rejected events in red with the server-supplied failure reason, offering an explicit "Discard" button.

### 3.7 Offline Polling Guard ([PASS])
- Zero interval polling. Sync runs strictly upon app boot, browser `online` event, and manual user click.

---

## 4. Request Leaks & Performance

### 4.1 Interval Polling ([PASS])
- No `setInterval` loops exist in the frontend.

### 4.2 Effect Loops ([PASS])
- All `useEffect` hooks include clean dependency arrays and cancellation flags (`cancelled = true`).

### 4.3 Search Debounce ([PASS])
- `EquipmentListPage` debounces text input via `useDebounce(search, 300)` before filtering.

### 4.4 Camera Scanner Stream Debounce ([MINOR])
- Dedicated QR camera scanner hook should ensure continuous video stream decodes are debounced to prevent duplicate outbox entries upon multi-frame detection.

### 4.5 Sequential Fleet Pagination Bursts ([MAJOR])
- `fetchLiveEquipment` in `equipmentSource.ts` loops sequentially from page 1 to 200 requesting 100 items per page (`MAX_PAGES = 200`). For a 5,000 asset fleet, this produces 50 roundtrips on cold start. Migrating initial cache population to `GET /api/sync/snapshot` is recommended.

---

## 5. Feature Status Table (F1 through F-O4)

| Feature | Scope / Requirements | Status | Notes / Gaps |
|---|---|:---:|---|
| **F1** | Scaffold, API Client, Login, Role Routing, `/me`, Logout | **DONE** | Fully verified against backend auth API. |
| **F2** | Equipment List, Debounced Search, Status Filter | **PARTIAL** | UI works with mock/live fallback; response field naming discrepancies. |
| **F-O1** | Installable PWA, Offline App Shell, Online/Offline Badge | **DONE** | Service worker caches static assets; offline indicator functions reactively. |
| **F-O2** | IndexedDB Snapshot, Per-User Keying, Wipe on Logout | **DONE** | `sx-offline` database with `snapshots` and `session` stores working. |
| **F-O3** | Outbox: Staff Actions Stored Locally First | **DONE** | Local persistence, UUID v4 generation, and rejection state management. |
| **F-O4** | Sync Manager: Batch Send Queued Events to Server | **PARTIAL** | Manager orchestration (backoff, locks, 401 stop) is complete, but `syncClient.ts` is a mock that does not call `POST /api/sync`. |

---

## 6. Code Hygiene & Deployment

### 6.1 Leftover Mock Data
- `frontend/src/mocks/equipmentMock.ts` contains a static 10-item equipment array.
- `syncClient.ts` contains simulated mock responses.
- `OutboxBadge.tsx` contains dev-only event generator buttons (safely gated behind `import.meta.env.DEV`).

### 6.2 Hardcoded URLs & Secrets
- No hardcoded backend URLs or production credentials found in source files.
- Demo passwords are gated strictly behind `import.meta.env.DEV` in `LoginPage.tsx`.

### 6.3 Console Statements
- Clean: only defensive `console.warn` and `console.error` logs in `db.ts` and `AuthContext.tsx`.

### 6.4 README Run Steps ([MINOR])
- Root `README.md` details backend setup, migrations, and seed commands, but lacks explicit commands for frontend development (`npm run dev:frontend`) and frontend build (`npm run build:frontend`).

---

## Prioritized Action Plan (Fixing Blockers Only)

In accordance with instructions, only **Blocker** items will be remediated immediately, one by one, with verified tests:

1. **Fix Blocker 1: Connect `syncClient.ts` to `POST /api/sync`**:
   - Replace mock `sendBatch` with real HTTP call to `POST /api/sync`.
   - Map frontend outbox events to the backend schema:
     `{ events: [{ client_event_id: e.id, user_id: e.userId, type: e.type, payload: { ...e.payload, asset_code: e.assetCode }, occurred_at: e.occurredAt }] }`.
   - Parse `res.results`, mapping `status === 'accepted' | 'duplicate'` to `accepted` IDs, and `status === 'rejected'` to `rejected` items with `reason`.
   - Add automated test verifying the live payload formatting and response parsing.

2. **Fix Blocker 2: Add Client Clock Skew Calibration in `outbox.ts`**:
   - Provide an offset module/helper `setServerClockOffset(serverTimeIso)` and `getCalibratedIsoTime()`.
   - Calculate $\Delta t = \text{Date.parse}(server\_time) - \text{Date.now()}$.
   - Ensure `enqueueEvent` generates `occurredAt` using calibrated time so events are never rejected for `CLOCK_SKEW_EXCEEDED`.
   - Add automated unit tests verifying that positive and negative clock skew offsets correctly adjust `occurred_at`.

3. **Fix Blocker 3: Align `equipmentSource.ts` with Real Backend Response**:
   - Update `fetchLiveEquipment` and response interfaces to properly handle the backend equipment list response structure (`items` or `data`, total counts).
   - Ensure proper error surfacing so network failures are distinguishable from empty data.
