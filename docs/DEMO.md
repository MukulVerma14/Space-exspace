# Space Exspace Platform: End-to-End Demonstration Guide

This guide provides instructions for demonstrating the Space Exspace equipment rental and materials tracking platform, including field operations, multi-device concurrency, and simulating offline mode using browser DevTools.

---

## 1. Prerequisites & Starting the Application

Ensure the PostgreSQL database and backend server are running:
```bash
# Verify database connection and seed state
npm --workspace=backend run test

# Start backend server (listening on port 3000)
npm --workspace=backend run dev
```

### Pre-configured Demo Accounts
| Role | Email | Password | Scope & Visibility |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@spaceexspace.com` | `Admin#2026!Dev` | Full commercial access: rentals, rates, quotations, invoices, and fleet audit. |
| **Staff** | `staff@spaceexspace.com` | `Staff#2026!Dev` | Yard operations: QR code scanning, relocation, check-in, repair dispatch, stock issue. **Zero rates or prices visible.** |

---

## 2. How to Demo Offline Mode with Browser DevTools

In real field operations across Dammam, Jubail, and desert construction sites, yard technicians frequently lose cellular connectivity. The platform enables staff to continue recording physical actions while completely offline and replay them safely when reconnected.

> [!IMPORTANT]
> **First-Ever Login Requires Internet Connectivity:**
> An offline device cannot perform an initial login without an active network connection. Credential validation (bcrypt password hash verification) and cryptographic issuance of the signed JWT token happen strictly on the server. Technicians must log in and download their initial operational snapshot before heading into offline coverage dead zones. Once authenticated, the JWT token and operational snapshot are stored locally on the device.

---

### Step-by-Step Offline Demo Walkthrough

#### Step 1: Initial Online Login & Snapshot Download
1. Open Google Chrome, Microsoft Edge, or Firefox and open the web application (or API client).
2. Log in with the **Staff** account:
   - Email: `staff@spaceexspace.com`
   - Password: `Staff#2026!Dev`
3. Upon login, the application queries `GET /api/sync/snapshot` to cache:
   - Fleet equipment list with derived status (`available`, `rented`, `under_repair`) and location IDs.
   - Active yard and workshop locations.
   - Materials inventory items with current `stock_on_hand`.
   - `server_time` (used by the mobile app to detect and calibrate local clock drift).
   - An `ETag` content hash header (e.g. `W/"7a9f8c..."`).
4. **Inspect Response in DevTools Network Tab**:
   - Notice that the snapshot response body for staff contains **zero rates, prices, unit costs, or standard rate cards**. Commercial terms are stripped server-side.

---

#### Step 2: Simulate Going Offline in DevTools
1. Press `F12` (or `Ctrl + Shift + I` / `Cmd + Option + I` on macOS) to open **Browser Developer Tools**.
2. Click on the **Network** tab.
3. In the network throttling dropdown (which defaults to **"No throttling"**), select **"Offline"**.
4. The browser is now simulated as having zero cellular or Wi-Fi connectivity.

```
+-----------------------------------------------------------------------+
|  Elements  Console  Sources  [Network]  Performance  Application  >>  |
+-----------------------------------------------------------------------+
|  [x] Preserve log   [x] Disable cache   Throttling: [ Offline v ]     |
+-----------------------------------------------------------------------+
```

---

#### Step 3: Perform Yard Operations Offline
While the network is toggled to **Offline**, perform physical yard actions in the field app:
1. **Relocate Equipment**:
   - Scan or select crane `CRN-50-003` (currently at Dammam Yard).
   - Relocate the asset to **Jubail Yard**.
   - Note: The app immediately records this action in local storage (IndexedDB) with a client-generated UUID `client_event_id: crypto.randomUUID()` and physical timestamp `occurred_at: new Date().toISOString()`.
2. **Issue Consumable Material**:
   - Issue 5 meters of heavy welding cable to a workshop task.
   - The deduction is queued locally in the offline outbox.
3. **Dispatch Machine to Workshop**:
   - Mark an available generator as needing repair (e.g. oil leak).
   - The maintenance request and workshop relocation are added to the outbox queue.

Observe that the application does not hang or display an error modal. It informs the technician: *"3 actions saved locally (Offline mode active)"*.

---

#### Step 4: Restore Connectivity & Trigger Batch Sync
1. In DevTools **Network** tab, switch the throttling dropdown from **"Offline"** back to **"No throttling"** (or restore Wi-Fi).
2. The client detects connectivity (`navigator.onLine === true`) and automatically flushes its offline outbox by dispatching a single batch request:
   ```http
   POST /api/sync
   Authorization: Bearer <STAFF_JWT>
   Content-Type: application/json

   {
     "events": [
       {
         "client_event_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
         "user_id": 2,
         "type": "equipment.move",
         "payload": { "asset_code": "CRN-50-003", "location_id": 2 },
         "occurred_at": "2026-10-29T08:30:00.000Z"
       },
       ...
     ]
   }
   ```
3. **Examine Server Processing**:
   - The server sorts events by `occurred_at ASC` to preserve real-world chronological sequence.
   - Each event runs inside its own isolated database transaction (`BEGIN ... COMMIT`).
   - Domain preconditions are re-verified at sync time (e.g. verifying stock does not go below zero, verifying return is from an active rental).
   - The response returns per-event receipts:
     ```json
     {
       "processed": 3,
       "results": [
         {
           "client_event_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
           "status": "accepted",
           "result": { "action": "equipment.move", "asset_code": "CRN-50-003", "new_location_id": 2 }
         },
         ...
       ]
     }
     ```

---

#### Step 5: Demonstrate Replay Idempotency (Duplicate Prevention)
To show that network retries never duplicate physical moves or double-charge stock:
1. In DevTools or curl, resend the exact same `POST /api/sync` payload with the same `client_event_id` UUIDs.
2. The server detects that each UUID was already processed in `sync_events`.
3. The response returns:
   ```json
   {
     "client_event_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
     "status": "duplicate",
     "result": { "action": "equipment.move", "asset_code": "CRN-50-003", "new_location_id": 2 }
   }
   ```
4. Querying the database confirms that `location_log` and `stock_movements` row counts did **not** increase. Zero duplicate rows are written.

---

#### Step 6: Demonstrate Multi-Device Stale Sync Conflict Resolution
To demonstrate why `v_equipment_current` orders by physical occurrence time (`moved_at DESC`):
1. **Device A (Offline at 08:00 AM)**: Worker A moves Crane #10 to Yard 2 while offline.
2. **Device B (Online at 09:30 AM)**: Worker B moves Crane #10 to Workshop. Device B syncs immediately. `v_equipment_current` displays **Workshop**.
3. **Device A syncs late at 11:00 AM**: Worker A's device finally gets cell signal and syncs the 08:00 AM move.
4. **Result**:
   - Worker A's move is accepted into `location_log` as a permanent audit trail.
   - However, `v_equipment_current` **continues to display Workshop** because 09:30 AM is later than 08:00 AM.
   - The stale device sync did not overwrite the newer physical location!

---

#### Step 7: Demonstrate ETag Bandwidth Caching (HTTP 304)
1. In DevTools, observe the next snapshot poll:
   ```http
   GET /api/sync/snapshot
   Authorization: Bearer <STAFF_JWT>
   If-None-Match: W/"7a9f8c..."
   ```
2. When no equipment has moved and no inventory has changed, the server responds with:
   ```http
   HTTP/1.1 304 Not Modified
   ETag: W/"7a9f8c..."
   ```
3. The response body is **0 bytes**, demonstrating near-zero cellular data overhead during idle periods.

---

## 3. Automated Test Verification

All offline capabilities, idempotency guarantees, and edge cases are verified through automated integration tests:

```bash
# Run the dedicated offline sync and snapshot test suite (24 tests)
npm --workspace=backend run test -- src/__tests__/offline_events.test.ts

# Run the complete test suite across all modules (79 tests)
npm --workspace=backend run test

# Run TypeScript linter
npm --workspace=backend run lint
```
