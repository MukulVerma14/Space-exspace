# SPACE EXSPACE — Frontend Build Log

This log records every frontend implementation step: what was built, why each decision was made, what alternatives were rejected, how to test, and a 30-second plain-English explanation.

---

## F1 — Scaffold, API Client, Login, Role-Aware Routing, `/me` Check, Logout

**Date:** 2026-10-28  
**Status:** ✅ Complete

---

### What Was Built

| File | Purpose |
|---|---|
| `frontend/index.html` | HTML entry point with PWA meta tags, Inter + JetBrains Mono fonts |
| `frontend/public/manifest.json` | PWA web app manifest (standalone mode, theme colour) |
| `frontend/vite.config.ts` | Vite config with dev proxy `/api → localhost:3000` |
| `frontend/tsconfig.json` | Strict TypeScript config with `baseUrl` + path aliases |
| `frontend/tsconfig.node.json` | TS config for Vite build tooling |
| `frontend/src/index.css` | Full design system: CSS custom properties, buttons, inputs, badges, cards, nav, animations |
| `frontend/src/main.tsx` | React 18 `createRoot` entry point |
| `frontend/src/api/client.ts` | Centralised API client with token storage, error class, `api.get/post`, `loginRequest`, `meRequest` |
| `frontend/src/context/AuthContext.tsx` | Auth context: `booting → unauthenticated → authenticated` state machine, `/me` rehydration on load, `login`, `logout` |
| `frontend/src/router/RequireAuth.tsx` | Route guard: handles booting spinner, unauthenticated redirect, wrong-role redirect |
| `frontend/src/router/AppRouter.tsx` | Full router: `/login`, `/`, `/admin/*`, `/staff/*`, 404 |
| `frontend/src/pages/layouts/AppLayout.tsx` | Sticky top nav shell with brand, nav links, user avatar, role badge, logout button |
| `frontend/src/pages/LoginPage.tsx` | Login form: email/password, show/hide password, loading state, server error display, demo credential fill |
| `frontend/src/pages/admin/AdminHomePage.tsx` | Admin landing: quick-nav cards to Equipment, Rentals, Materials, Invoices |
| `frontend/src/pages/staff/StaffHomePage.tsx` | Staff landing: quick-nav cards to Equipment, Rentals, Stock |
| `frontend/src/pages/PlaceholderPage.tsx` | Generic placeholder for routes not yet implemented |
| `frontend/src/App.tsx` | Root: `<AuthProvider>` wrapping `<AppRouter>` |
| `package.json` (root) | Added `dev:frontend` and `build:frontend` scripts |

---

### Why — Key Design Decisions

#### 1. Vite Dev Proxy instead of hardcoded API URL
**Decision:** `vite.config.ts` proxies `/api/*` and `/health` to `http://localhost:3000` during dev.  
**Why:** The browser makes requests to the same origin (`localhost:5173`) so there are zero CORS preflight issues during development. No `.env` variable needed. The `API.md` says base URL is `localhost:5000` but the backend `PORT=3000` in `.env.example` is what actually runs — the proxy bridges this.  
**Alternative rejected:** Hardcoding `VITE_API_URL=http://localhost:3000` and calling it directly — would require CORS to be correctly configured and would also mean every `fetch` call prepends the variable. The proxy is cleaner.

#### 2. Three-state Auth: `booting → unauthenticated → authenticated`
**Decision:** The auth context starts in `'booting'` while it validates the stored token via `GET /api/auth/me`.  
**Why:** Without this, a user with a valid stored token would see a flash to the login page before the token check completes. The `booting` state lets `RequireAuth` show a spinner instead.  
**Alternative rejected:** Just check if a token string is present in localStorage — this would accept expired or revoked tokens and only fail when the first real API call is made. The server returns 401, but the user would already have navigated past the login page.

#### 3. `/me` check on every page load
**Decision:** `AuthContext` calls `GET /api/auth/me` on mount if a token exists.  
**Why:** The backend checks `users.active` on every JWT verification. If an admin deactivates a staff account, the staff member's token is still structurally valid for 8 hours. The `/me` call on load gives the server a chance to reject it immediately on the next session.  
**Alternative rejected:** Decode the JWT on the client and trust it — this is the classic mistake. The JWT payload is not a source of truth; the server is.

#### 4. Centralised API client (`src/api/client.ts`)
**Decision:** All HTTP calls go through a single `request()` function that reads the token, sets `Authorization: Bearer`, parses JSON, and throws typed `ApiRequestError`.  
**Why:** Without this, every component would manually do `localStorage.getItem`, build headers, `JSON.parse`, check `res.ok`. Bugs hide in that repetition.  
**Alternative rejected:** `axios` — unnecessary dependency (modern `fetch` is sufficient, and `axios` adds 40 KB).  
**Alternative rejected:** React Query / SWR — introduced at the data-fetching step once real endpoints exist; over-engineering for a login screen.

#### 5. Role-aware routing vs. role-hiding data
**Decision:** `/admin/*` routes are gated by `RequireAuth(role="admin")`. Staff hitting `/admin/*` are redirected to `/staff`. But within pages, we **never** conditionally render data based on role — we only render what the server sends.  
**Why:** This directly follows the instruction "Never hide data with role checks alone — the server decides what is sent, the UI only displays what arrives." The `sanitizeFinancials()` serializer on the backend is the real guard. The router guard is purely a UX concern (prevent staff from navigating to admin-only pages where they'd get a 403).  
**Example:** `GET /api/rentals/:id` as staff already omits `applied_rate` and `discount_note` — the component simply renders the object it receives without any `if (role === 'admin') show rate` logic.

#### 6. localStorage for token storage
**Decision:** Token stored in `localStorage` under key `sx_token`.  
**Why:** Simple, works across tabs, survives page refresh. Acceptable for this prototype targeting a controlled internal user base.  
**Alternative rejected:** `sessionStorage` — token lost on tab close, poor UX for field staff checking their phone mid-task.  
**Alternative rejected:** `httpOnly` cookie — requires the backend to `Set-Cookie` the token and expose a `/api/auth/logout` endpoint that clears it. This would be the production-correct approach but adds backend changes (not in scope).

---

### How to Test F1

**2. Start the frontend**
```bash
# From repo root:
npm run dev:frontend
# → http://localhost:5173
```

**1. Start the backend (in a separate terminal)**
```bash
npm run dev:backend
# → http://localhost:3000
```

**Manual test checklist:**

| Test | Expected |
|---|---|
| Visit `http://localhost:5173/` | Redirects to `/login` (no token stored) |
| Submit with wrong credentials | Red error alert with server message |
| Click "Use Admin" → Sign in | Redirects to `/admin`, shows admin home |
| Click "Use Staff" → Sign in | Redirects to `/staff`, shows staff home |
| As admin, navigate to `/staff` | Redirected back to `/admin` |
| As staff, navigate to `/admin` | Redirected back to `/staff` |
| Click Sign out | Clears token, redirects to `/login` |
| Sign in as admin, refresh page | Stays on `/admin` (token rehydrated via `/me`) |
| Sign in, manually expire token in localStorage, refresh | Redirected to `/login` (server rejected `/me`) |
| Visit `http://localhost:5173/does-not-exist` | Shows 404 page |

---

### 30-Second Explanation

> The frontend is a React + Vite + TypeScript SPA. There is one design decision above all others: **the server decides what data users see, not the UI**. Staff and admin can visit the same equipment page — it just renders whatever JSON comes back. Financial fields (`applied_rate`, `discount_note`) are stripped by the server's serializer before the response even leaves the backend.
>
> The router separates `/admin/*` from `/staff/*` purely for UX: wrong-role users are redirected, not shown a blank page. The auth context boots, checks the stored JWT with `/me` (so the server can reject expired or revoked tokens), then resolves to `authenticated`. Login saves the token, logout wipes it.

---

## F2 — Equipment List: Debounced Search + Status Filter (Mock Data)

**Date:** 2026-10-28  
**Status:** ✅ Complete

---

### What Was Built

| File | Purpose |
|---|---|
| `frontend/src/mocks/equipmentMock.ts` | 12 realistic mock equipment records matching the `v_equipment_current` API shape |
| `frontend/src/hooks/useDebounce.ts` | Generic debounce hook (300ms default) |
| `frontend/src/pages/shared/EquipmentListPage.tsx` | Equipment list: search, status filter, count summary, card grid, loading skeleton, empty state |
| Router updated | `/admin/equipment` and `/staff/equipment` now render `EquipmentListPage` |

---

### Why — Key Design Decisions

#### 1. Mock data instead of live API
**Decision:** Equipment list uses a client-side mock array that matches the `GET /api/equipment` response shape.  
**Why:** The backend equipment endpoints exist and are tested, but this step is about building the UI pattern correctly — search, filter, debounce, render — independently of backend availability. Swapping to a real `api.get('/api/equipment?...')` call is a one-line change once the backend is running.  
**Alternative rejected:** Making real API calls now — it would couple F2 testing to backend uptime and seed data being present.

#### 2. Debounced search (300ms)
**Decision:** Search input value is debounced 300ms before filtering. When the real API exists, the debounced value will be passed as `?search=` query param.  
**Why:** Without debounce, every keystroke would trigger a fetch — 10 chars typed = 10 API calls. 300ms is the widely accepted threshold: fast enough to feel instant, slow enough to avoid hammering.  
**Alternative rejected:** `onChange` filtering without debounce — fine for client-side arrays, poor for server calls. Building the debounce now means zero refactor when switching to real API.

#### 3. Status filter matches backend enum
**Decision:** The status filter options are `all | available | rented | under_repair | inactive` — exactly the values the `v_equipment_current` SQL view produces.  
**Why:** When the mock is replaced with the real API, `?status=rented` maps directly to the backend query param with no translation layer needed.

#### 4. Shared page for both roles
**Decision:** One `EquipmentListPage` component is used for both `/admin/equipment` and `/staff/equipment`.  
**Why:** The list is identical for both roles — what differs is the *detail page* actions (admin can create rentals; staff can move/return). Duplicating the list for each role would be maintenance overhead with zero benefit.  
**Alternative rejected:** Two separate components — unnecessary duplication.

#### 5. Status badge colours match design system tokens
**Decision:** Badge colours (`available=green`, `rented=yellow`, `under_repair=red`, `inactive=grey`) use `--status-*` CSS variables defined in `index.css`.  
**Why:** Consistent visual language across the whole app. Changing a colour is a single CSS variable update.

---

### How to Test F2

```bash
npm run dev:frontend   # http://localhost:5173
```

Log in as either role, navigate to Equipment.

| Test | Expected |
|---|---|
| Page loads | 12 mock items shown in card grid |
| Type "tadano" in search | Filters to Tadano cranes only |
| Clear search | All 12 items return |
| Select "Rented" status filter | Only rented items shown |
| Select "Available" | Only available items shown |
| Select "All" | Resets to all items |
| Combine search + filter | Both applied simultaneously |
| Resize to mobile width | Single-column card layout |

---

### 30-Second Explanation

> The equipment list page has a debounced text search and a status dropdown filter. Both operate on client-side mock data right now. The mock data deliberately uses the exact same JSON shape as `GET /api/equipment` — `asset_code`, `make`, `model`, `type_name`, `status`, `current_location_name`, `condition`. When the real API endpoint is available, you replace the mock filter logic with a single `api.get('/api/equipment?search=X&status=Y')` call and the UI is unchanged.

---

## F2 — Corrections (made during F-O1)

- **`inactive` status removed.** The API only returns `active = true` equipment, and its status enum is `available | rented | under_repair`. The F2 entry said the filter matched the view; that was wrong. The mock record with `inactive` status was removed, so the mock list is now **11 items**, not 12.
- **Condition values** in the card colour map now match the API enum (`good | fair | needs_repair`). The old `excellent | poor` values were not in the API.

---

## F-O1 — Installable PWA, Offline App Shell, Online/Offline Badge

**Date:** 2026-10-28
**Status:** ✅ Build verified. Offline reload needs a manual browser test (see below).

---

### What Was Built / Fixed

| File | Change |
|---|---|
| `vite.config.ts` | VitePWA with `generateSW`, precaches the app shell (JS, CSS, HTML, icons, fonts). Navigation fallback to `/index.html`, `/api` and `/health` denylisted. Google Fonts cached. |
| `public/icon-192.png`, `public/icon-512.png` | **Added.** The manifest and PWA config referenced them, but they were missing, so install would fail. |
| `src/components/OnlineStatusBadge.tsx` | **Fixed broken import** (`../../hooks` → `../hooks`). This made `vite build` fail. |
| `src/context/AuthContext.tsx` | **Offline bug fixed.** Previously, if `/me` failed for any reason, including no signal, the token was cleared and the user was logged out. Now: 401 clears the session; offline or 5xx keeps the session and uses the cached profile. |
| `src/api/client.ts` | Added `saveCachedUser / loadCachedUser / clearCachedUser` (key `sx_user`). |
| `src/pages/LoginPage.tsx` | Demo credential box wrapped in `import.meta.env.DEV`. Demo passwords no longer ship in production builds. |
| `src/vite-env.d.ts` | **Added.** Vite type declarations so `import.meta.env` type-checks. |
| `src/mocks/equipmentMock.ts`, `EquipmentListPage.tsx` | `inactive` status removed (see F2 corrections). |

---

### Why — Key Decisions

#### 1. `generateSW` (not `injectManifest`)
**Decision:** Workbox generates the service worker from config.
**Why:** F-O1 only needs the app shell cached. Custom SW logic comes later for background sync (F-O4).
**Alternative rejected:** `injectManifest`. It's needed only for custom fetch or sync handlers, which we don't have yet.

#### 2. Cache the shell, never the API
**Decision:** Precache static assets only. `/api/*` is excluded from navigation fallback and not cached.
**Why:** A cached API response would show stale equipment status as if it were live. Equipment data offline is the job of the IndexedDB snapshot (F-O2), which carries a timestamp and gets cleared on logout.
**Alternative rejected:** Workbox `NetworkFirst` for `/api`. It would silently show old data with no timestamp and keep it after logout.

#### 3. Keep the session when offline
**Decision:** The token is cleared only on a 401 from `/me`.
**Why:** The client's staff work at remote yards with poor signal. Logging them out on every dead-zone reload would make the app unusable offline.
**Alternative rejected:** Keeping the old "clear on any error" behaviour. It's safe for a shared device, but breaks the offline requirement. The shared-device risk is handled by clearing data on logout (F-O2) and by the server's `active` check on the next online `/me`.

#### 4. Cached profile in localStorage (temporary)
**Decision:** The user's id, name and role are saved in `localStorage` so the shell can render offline.
**Why:** The shell needs the role to pick the right nav, and `/me` can't be called offline.
**Note:** F-O2 moves this into IndexedDB keyed per user, and logout clears it. Keeping it in localStorage for now is intentional and temporary.

#### 5. Badge is event-driven, no polling
**Decision:** `useOnlineStatus` listens to the window `online` and `offline` events.
**Why:** The client explicitly wants no polling while offline, so there are no timers and no API calls.
**Limitation:** `navigator.onLine` can say "online" on a weak signal. The sync manager (F-O4) handles that at the HTTP layer.

#### 6. Demo credentials only in dev
**Decision:** The "Use Admin / Use Staff" box renders only when `import.meta.env.DEV` is true.
**Why:** Demo passwords in a production UI are a security leak, even for a prototype.

---

### Alternatives Considered and Rejected
- **Caching `/api` with Workbox:** rejected (see decision 2).
- **Native app for offline:** out of v1 scope (see OPEN_QUESTIONS #5). PWA with IndexedDB covers the requirement for now.

---

### How to Test F-O1

```bash
cd frontend
npm run build        # must finish with exit 0 and list icon-192.png / icon-512.png in the precache
npx vite preview     # http://localhost:4173
```

| Test | Expected |
|---|---|
| Chrome DevTools → Application → Manifest | No errors. Both icons listed, installable |
| Application → Service Workers | `sw.js` active and running |
| Log in, then DevTools → Network → Offline, reload | App shell loads. You stay logged in (not redirected to login). Badge shows "Offline — changes queued" |
| Go back online | Badge shows "Online" for 3 seconds, then disappears |
| Offline, `/api/...` request | Fails cleanly. No cached data is shown |
| Production build (`vite preview`) | Login page has no demo credential box |
| Dev server (`npm run dev`) | Demo credential box is visible |

---

### 30-Second Explanation

> The app can now be installed on a phone and loads with no signal. The build caches the app's code and styles, so the shell opens even in a dead zone. A small badge shows "Offline — changes queued" so a technician knows the app is offline. We fixed a bug where losing signal logged staff out, and removed the demo passwords from the production build. Data itself isn't cached yet; that's F-O2.

---

## F-O2 — IndexedDB Snapshot, Per-User, Cleared on Logout

**Status:** ✅ Type-check and build pass. Offline read from IndexedDB needs a manual browser test (see below).

### What Was Built

| File | Purpose |
|---|---|
| `src/offline/db.ts` | IndexedDB via `idb`. Two stores: `snapshots` (key `userId:name`) and `session` (the signed-in profile). Save, load and wipe helpers. |
| `src/data/equipmentSource.ts` | `loadEquipment(userId)`: live when online and saves a snapshot, snapshot when offline, `none` if nothing is cached. |
| `src/context/AuthContext.tsx` | Profile moved from localStorage to IndexedDB. Logout and a different user signing in wipe all offline data. |
| `src/pages/shared/EquipmentListPage.tsx` | Reads from `loadEquipment`. Shows an "Offline, showing saved data from …" notice, or a "no saved data yet" notice. |
| `src/pages/layouts/AppLayout.tsx` | Logout awaits the wipe before navigating away. |
| `src/api/client.ts` | localStorage profile helpers removed. |
| `src/mocks/equipmentMock.ts` | Condition values changed to the API enum (`good / fair / needs_repair`). |
| `package.json` | Added `idb` ^8. |

### Why — Key Decisions

**1. IndexedDB, not localStorage.** localStorage is a small synchronous string store. The equipment list is larger, and IndexedDB is async and doesn't block rendering.

**2. `idb` wrapper, not raw IndexedDB or Dexie.** `idb` is a thin promise wrapper with a typed schema and no magic. Dexie adds a query layer we don't need yet.

**3. Snapshot keyed `userId:name`.** The same phone can hold several users' data over time. Keying by user avoids showing one person another's snapshot. Logout and user switches wipe everything anyway, so this is defence in depth.

**4. Wipe on logout and on user switch.** Phones are shared at client sites. The user-switch wipe covers the case where someone logs out in a way that skips the handler, such as a token expiring.

**5. No network call offline.** `loadEquipment` checks `navigator.onLine` and reads the snapshot without a request. This meets the "no runaway API calls" requirement.

**6. Snapshot shows its age.** The notice shows `savedAt`, so a technician knows the status may be out of date.

**7. Snapshot is not the source of truth.** It's read-only data for viewing. Writes come in F-O3 (outbox).

### Alternatives Rejected
- **Caching `/api` responses with Workbox:** rejected in F-O1. Stale data with no timestamp.
- **Keeping the profile in localStorage:** rejected. It isn't per-user, and it's not cleared with the rest of the offline data.
- **Dexie:** more features than needed right now.

### Known Limits
- Live fetch: `fetchLiveEquipment` pages through `GET /api/equipment` (100 per page, sequential, safety guard of 200 pages). Falls back to the snapshot on any failure.
- If an IndexedDB wipe fails on logout, the error is logged and logout still completes. The token is cleared, but leftover snapshot data could remain on that device.

### How to Test F-O2

```powershell
cd frontend
npx vite build
npx vite preview
```

| Test | Expected |
|---|---|
| Log in online, open Equipment | List loads. No offline notice. DevTools → Application → IndexedDB → `sx-offline` → `snapshots` has `1:equipment-list` (or the user's id) |
| Application → Offline, reload | Equipment list shows "Offline. Showing saved data from …" and the mock rows |
| Log out | DevTools → IndexedDB: both stores empty. Token and `sx_user` gone |
| Log in as staff on the same browser after admin | Admin's snapshot is wiped before staff's profile is saved |
| Clear IndexedDB, then go offline and open Equipment | "No saved data on this device yet" notice, no list |

*Logged-in offline test on the real backend is still pending from F-O1.*

### 30-Second Explanation

> The equipment list is saved on the phone every time it loads online, in a per-user store. When there's no signal, the app reads that copy and says how old it is. When anyone logs out, or a different person logs in, everything is wiped so the next person never sees the last one's data. Nothing is sent to the server while offline.

---

## F-O3 — Outbox: Staff Actions Stored on the Phone First

**Status:** ✅ Clean install, type-check and build pass. Browser tests below are pending.

### What Was Built

| File | Purpose |
|---|---|
| `src/offline/db.ts` | DB version 2. New `outbox` store, keyed by event `id`, indexed by `userId`. |
| `src/offline/outbox.ts` | `enqueueEvent`, `listEvents`, `markRejected`, `discardEvent`, `clearOutboxForUser`. Writes a UUID and `occurredAt` for every event. |
| `src/hooks/useOutbox.ts` | Live list and counts for the current user. Re-reads when the outbox changes. |
| `src/components/OutboxBadge.tsx` | "N pending" (amber) or "N to review" (red) in the top bar. Opens a panel with each event and the server's reason for rejected ones. |
| `src/pages/layouts/AppLayout.tsx` | Badge in the header. Sign out warns if unsent changes exist and only deletes them after confirmation. |

### Why — Key Decisions

**1. Client UUID on every event.** The server will use it to ignore a duplicate when a request is retried after a timeout. Without it, a retried "move" would be saved twice.

**2. `occurredAt` is set on the phone.** Events can sit for hours in a dead zone. The server must record when the action happened, not when it arrived.

**3. Events survive sign-out, expiry and user switch.** Only snapshots and the profile are wiped. The outbox is wiped only when the person confirms "Sign out anyway". Losing an unsent move silently is worse than a confirmation prompt.

**4. Events are scoped per user.** On a shared phone, `listEvents(userId)` returns only the current user's events. Another person never sees them.

**5. Rejected events are kept, not deleted.** The server's reason is shown, and the person decides whether to discard. Nothing is retried automatically, so a rejection can't loop.

**6. Sending is not in this step.** F-O3 only stores and lists events. F-O4 adds the sync manager.

**7. `crypto.randomUUID` fallback.** It only exists on https or localhost. Opening the app over plain http on a LAN IP would otherwise crash.

### Alternatives Rejected
- **Delete the event as soon as it's sent:** not yet. Sending is F-O4, and this list is the only record while events are pending.
- **Use the server's ID as the key:** the phone doesn't have one until the server accepts the event, so the UUID has to come from the phone.
- **Wipe the outbox on sign-out to match the snapshots:** rejected. It would lose work silently.

### Open Decision (for the client)
If a staff member signs out with unsent changes, the changes are lost once they confirm. Alternative: block sign-out until everything is sent. That could trap someone in a dead zone with no way out. Recommend the confirmation for v1; confirm with the client.

### How to Test F-O3

```powershell
cd frontend
npx vite build
npx vite preview
```
Log in as staff, with the backend running.

| Test | Expected |
|---|---|
| Top bar | A "+ test event" and "+ test rejected" panel appears (dev build only) after clicking the badge. Badge is visible in dev builds. |
| Click the badge, then "+ test event" | Badge shows "1 pending". Panel lists "move · CRN-50-001" with a time. |
| Click "+ test rejected" | Badge turns red: "1 to review". Panel shows "Server: Asset is already under repair (test)" with a Discard button. |
| Click Discard | The rejected item is removed. The badge goes back to "1 pending". |
| Reload the page | Events are still listed (stored in IndexedDB, not memory). |
| Sign out with pending events | A confirm dialog appears. Cancel keeps you signed in with events intact. OK deletes them and signs out. |
| Sign in as admin after a staff session with pending events | The staff member's events are NOT shown to admin. |
| Production build (`vite build`, not dev) | No test buttons. Badge only shows when there are events. |

### 30-Second Explanation

> When a staff member does an action with no signal, the app saves it on the phone with a unique ID and the time it happened. A badge shows how many are waiting, and if the server ever rejects one, it shows the reason. Nothing is lost on sign-out without the person confirming. Sending to the server is the next step.

---

## F-O4 — Sync Manager: Send Queued Events to the Server

**Status:** ✅ Clean install, type-check and build pass. Browser tests below pending. The server side is a MOCK until the backend endpoint exists.

### What Was Built

| File | Purpose |
|---|---|
| `src/sync/syncClient.ts` | `sendBatch()`. MOCK. Documents the endpoint contract the backend must implement. Dev helper to simulate a 401. |
| `src/sync/syncManager.ts` | `runSync()`, the retry/backoff logic, `startOnlineSync()` triggers, status store. |
| `src/hooks/useSync.ts` | Live sync status for the UI (`useSyncExternalStore`). |
| `src/offline/outbox.ts` | Added `removeEvents()` for accepted events. |
| `src/components/OutboxBadge.tsx` | Sync status line, "Sync now", "Sign in again" on 401. |
| `src/pages/layouts/AppLayout.tsx` | Starts the sync triggers for the signed-in user. |

### Endpoint Contract (for the backend dev)

```
POST /api/sync/events
Request:  { "events": [ { "id", "type", "assetCode", "payload", "occurredAt" } ] }   (max 50)
Response: { "accepted": ["<id>", ...], "rejected": [ { "id": "<id>", "reason": "..." } ] }

- Every id in the request must appear in accepted or rejected. Missing ids = retry.
- Same id sent twice is ignored, not saved twice (idempotent). REQUIRED before go-live.
- 401 if the token is invalid. 5xx or network failure = retry later.
```

### Why — Key Decisions

**1. One sync at a time.** A module-level guard. Two overlapping syncs could send the same events twice.

**2. Batches of 50.** Matches the backend's paging style and keeps each request small on a weak connection.

**3. Exponential backoff with jitter.** 2s, 4s, 8s… capped at 60s, randomised by ±50%. Jitter stops many phones retrying at the same instant after an outage. After 5 failed attempts it stops and waits for the next `online` event or a manual retry.

**4. A batch with unanswered events counts as failed.** If the server drops an id from its reply, that event is retried, not silently lost.

**5. 401 stops everything.** It doesn't retry (the token is not going to become valid by waiting). Events are kept. The person signs in again, and syncing resumes.

**6. Accepted events are deleted. Rejected events are kept.** Rejected ones go to the review list with the server's reason (F-O3).

**7. No polling.** Triggers: app start (if online), the browser `online` event, and "Sync now". Nothing runs on a timer, so an idle phone makes no requests.

**8. Offline makes no requests.** The check happens before every batch.

### Alternatives Rejected
- **setInterval polling:** rejected. The client wants no runaway API calls.
- **Retry forever:** rejected. A dead server would drain the battery and data.
- **Sync in parallel:** rejected. Duplicate sends and harder-to-follow state.

### Known Limits
- The server is a mock, so the real retry behaviour (5xx, timeouts) is not exercised end to end. Only the 401 path and the rejection path are testable now.
- Duplicate protection depends on the backend. Until the endpoint ignores repeated ids, a retry after a lost response can save an event twice.

### How to Test F-O4

Run the dev server (`npx vite`, port 5173) so the test buttons are visible. Log in as staff with the backend running.

| Test | Expected |
|---|---|
| Badge → "+ test event" → "Sync now" | "Sending…" then "Last sent <time>". The pending event disappears. |
| Badge → "+ test pending repair" → "Sync now" | Event is rejected by the mock. It moves to "1 to review" with "Server: Asset is already under repair (mock)". Discard works. |
| DevTools → Network → Offline → "+ test event" | Badge shows pending. No request is sent. |
| Set Network back to No throttling | The `online` event fires and sync runs with no click. The event is sent and removed. |
| Badge → "sim 401 next" → "+ test event" → "Sync now" | "Your session expired…" and a "Sign in again" button. The event stays pending. |
| Click "Sign in again" | You land on the login page. Sign in again. The event is still in the outbox and is sent. |
| Leave the app open with nothing pending for a minute | Network tab shows no repeated requests (no polling). |
| Production build | Test buttons hidden. Sync still works. |

**Not testable with the mock:** the retry/backoff timing on 5xx. Verify it against the real endpoint when the backend is ready.

### 30-Second Explanation

> Queued actions are sent to the server in small batches when the phone is online. If the connection drops, it retries with increasing waits, not every second. If the server says a session has expired, sending stops and the person is asked to sign in again. Nothing is sent while offline, and the phone doesn't poll the server when idle. The server side is still a mock until the backend ignores duplicate events.

---

## UI-1 — Visual Theme Matched to space-exs.com

**Scope:** colours, fonts and styling only. No logic, routes, API calls or offline behaviour were changed.

### What Changed

| File | Change |
|---|---|
| `src/index.css` | Design tokens replaced with the site palette: ivory background, white cards, gold and bronze accents, charcoal text. Fonts set to Barlow Condensed (headings) and Source Sans 3 (body). Purple accents removed. Shadows lightened. |
| `index.html` | Google Fonts link now loads Barlow Condensed, Source Sans 3 and JetBrains Mono. Theme colour updated. |
| `src/pages/LoginPage.tsx` | Logo gradient uses the brand colours (was purple). |

### Palette Used (converted from the site's stylesheet)

| Role | Hex |
|---|---|
| Background | `#FFFFF0` |
| Surface (cards) | `#FFFFFF` |
| Border | `#D3B678` |
| Primary (buttons, links) | `#8A6914` (darker gold, for readable white text) |
| Text | `#0A0A0A` |
| Muted text | `#493E27` |
| Success / Warning / Danger | `#059669` / `#B45309` / `#DC2626` |

### Why some colours differ from the site
The site's brand gold (`#C8A96F`) and amber (`#F59F0A`) don't have enough contrast for text on a light background. The darker shades keep the same hue and make the text readable, especially outdoors in sunlight on a phone. Confirm with the client if they want the exact brand colours anyway.

### Not Changed
- Logo: still the "SX" badge. The official horizontal logo file is needed to replace it.
- Dark theme: removed in favour of the site's light theme.

### How to Test
```powershell
cd frontend
npx vite build
npx vite preview
```
| Check | Expected |
|---|---|
| Login page | Ivory background, gold "SX" badge, Barlow Condensed heading |
| Equipment list | White cards, gold-tinted borders, readable status badges |
| Admin role tag | Gold tint, not purple |
| All earlier tests (F-O1 to F-O4) | Still pass. Nothing functional changed |

### 30-Second Explanation
> The app now uses the same colours and fonts as the company website: ivory background, gold accents and the same heading font. Only the look changed. The behaviour, offline support and sync work exactly as before.
