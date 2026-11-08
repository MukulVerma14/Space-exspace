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

---

---

## F-I1 — Materials Page: Stock List, Low-Stock Badge & Price History

**Date:** 2026-11-04  
**Status:** ✅ Complete

---

### What Was Built

| File | Purpose |
|---|---|
| `frontend/src/data/materialsSource.ts` | Materials data layer: `loadMaterials` (live + IndexedDB snapshot), `fetchMaterialPriceHistory` (admin-only guard), `fetchMaterialMovements` (physical ledger), and `formatMoney` strict role-based currency formatter. |
| `frontend/src/pages/shared/MaterialsPage.tsx` | Shared materials page: responsive stock list, 300ms debounced search, category filter, low-stock badges, quick metric cards, and slide-out item detail drawer (purchase price history + valuation for admin; physical movement quantities only for staff). |
| `frontend/src/router/AppRouter.tsx` | Mounted `MaterialsPage` under `/admin/materials` and `/staff/materials`, replacing generic placeholders. |
| `frontend/src/__tests__/materialsSource.test.ts` | 11 unit tests verifying strict role policy (no money rendered for staff, price history network call blocked for non-admin), live fetching, filter params, and offline snapshot fallbacks. |
| `frontend/package.json` & `package.json` | Added `test: vitest run` and `test:frontend: npm --workspace=frontend run test`. |

---

### Why — Key Design Decisions

#### 1. Strict Role Policy: Admin Only for Prices, Staff See Quantities Only
**Decision:** Purchase price history (`GET /api/materials/:id/price-history`), unit prices, line totals, average cost, and valuation cards are strictly restricted to admin users. Staff users see physical quantities only.  
**Why:** Client requirements mandate zero price visibility for yard staff. Even if an API mistakenly returns price fields, `formatMoney(amount, userRole)` strictly returns `''` unless `userRole === 'admin'`. In `MaterialsPage.tsx`, price table columns and valuation metrics are conditionally excluded from the DOM when `isAdmin === false`.  
**Alternative rejected:** Hiding columns via CSS `display: none` — insecure because inspect element reveals financial numbers. The fields are completely omitted from rendering.

#### 2. Item Detail Drawer: Price History (Admin) vs. Stock Ledger (Staff)
**Decision:** Clicking an item opens a slide-out drawer:
- For **Admin**: Displays Valuation Summary (Average Cost, Total Valuation, Priced Quantity, Receipts Count) and a chronological table of supplier purchase invoices (`invoice_date`, `invoice_no`, `supplier_name`, `quantity`, `unit_price`, `line_total`), plus a tab to switch to the physical ledger.
- For **Staff**: Displays item details and physical movements only (`date`, `type`, `qty`, `moved_by`, `note`), reading from `GET /api/materials/:id/movements` with no price columns rendered.  
**Why:** Provides operational and financial transparency for management while giving yard staff the audit trail they need without leaking commercial margins.

#### 3. Low-Stock Alert Badge & One-Click Filter
**Decision:** Items with `current_stock <= reorder_level` (or `is_low_stock = true`) receive a high-visibility amber/red `Low Stock` badge. A metric card in the top summary bar shows the exact low-stock count and toggles the list to low-stock items only.  
**Why:** Warehouse operators need to immediately identify replenishment requirements without manually comparing current stock against reorder thresholds.

#### 4. Shared Page Component Across Roles
**Decision:** A single `MaterialsPage.tsx` powers both `/admin/materials` and `/staff/materials`.  
**Why:** Keeps inventory layout, search, filters, and badge formatting DRY while delegating financial visibility to role-aware view switches.

#### 5. Offline Snapshot Resilience
**Decision:** `loadMaterials` caches the materials list into IndexedDB (`materials-list` per user). If offline or disconnected, it serves the cached snapshot with a timestamp badge.  
**Why:** Consistent with the F-O2 offline architecture for equipment, allowing staff in remote yards to check specifications and reorder levels without signal.

---

### How to Test F-I1

**1. Automated tests**
```bash
npm run test:frontend
# 25/25 tests pass (including 11 in materialsSource.test.ts)
npm run build:frontend
# tsc && vite build succeeds with exit code 0
```

**2. Manual testing checklist**
```bash
npm run dev:frontend   # http://localhost:5173
```

| Role | Test Step | Expected Result |
|---|---|---|
| Admin | Log in as admin (`admin@space-exs.com`) → Navigate to **Materials** (`/admin/materials`) | Materials stock list loads with SKU, name, category, current stock, reorder level, and status badges. |
| Admin | Click "Filter Low Stock" toggle | Only items with stock at or below reorder level are displayed. |
| Admin | Click "Price History" on a material item | Side drawer opens. Shows Average Cost, Total Valuation, Priced Quantity, and table of supplier purchase invoices with unit prices in SAR. |
| Admin | Switch drawer tab to "Physical Stock Ledger" | Table of receipts, issues, adjustments, and void reversals appears. |
| Staff | Log in as staff (`staff@space-exs.com`) → Navigate to **Stock** (`/staff/materials`) | Materials list loads showing quantities only. Button is labelled "Stock Ledger" (no "Price History" button). |
| Staff | Click "Stock Ledger" on a material item | Side drawer opens showing item specification and physical movements table only (`date`, `type`, `quantity`, `moved_by`, `note`). **Zero** currency symbols or price columns exist. |
| Staff | Inspect DOM / Network | Confirm no price history API call is made and no money values appear in markup. |

---

### 30-Second Explanation

> The Materials page gives yard operations a live view of consumable stock and reorder thresholds. Items running low automatically display an alert badge and can be isolated with a single click. For administrators, selecting an item opens full purchase price history and inventory valuation calculated from supplier invoices. For staff, commercial prices are completely locked down — staff see physical stock levels and ledger movements only, with no prices or money ever rendered on their screens.


---

## F-I2 — Invoices Page (Admin): Received/Issued Tabs, Detail Drawer & Status Badges

**Date:** 2026-11-04  
**Status:** ✅ Complete

---

### What Was Built

| File | Purpose |
|---|---|
| `frontend/src/data/invoicesSource.ts` | Invoices data layer: `fetchInvoices` (paginated with direction and status filters) and `fetchInvoiceById` (full line items and audit metadata), with strict admin-only client guards. |
| `frontend/src/pages/admin/InvoicesPage.tsx` | Admin invoice management screen: direction tabs (All, Received / Supplier, Issued / Customer), status filters (`unpaid`, `paid`, `void`), 300ms debounced search, plain text file references, and a slide-out line items drawer. |
| `frontend/src/router/AppRouter.tsx` | Replaced placeholder route `/admin/invoices` with `<InvoicesPage />`. |
| `frontend/src/__tests__/invoicesSource.test.ts` | 5 unit tests asserting admin fetching, query parameter serialization, and non-admin rejection without network requests. |

---

### Why — Key Design Decisions

#### 1. Direction Tabs: Received (Supplier) vs. Issued (Customer)
**Decision:** Top-level navigation tabs switch between **Received (Supplier)** and **Issued (Customer)** invoices, as well as an "All Invoices" overview.  
**Why:** Supplier invoices represent stock replenishment receipts and material purchases, while customer invoices represent equipment rental and service billings. Segmenting them by tab prevents cognitive clutter while maintaining a unified accounting view.

#### 2. Detail Drawer with Dynamic Line Items
**Decision:** Clicking any invoice opens a slide-out drawer containing full party details, VAT registration number, related rental contract reference, file references, payment/void audit trails, and a complete line items table (`line_no`, `description`, `quantity`, `unit_price`, `line_total`).  
**Why:** Quick inspection without full page reloads preserves filter and scroll positions on the main list.

#### 3. Status Badges
**Decision:** Distinct status badges for invoice lifecycle states:
- `unpaid`: Amber warning badge (`--color-warning`)
- `paid`: Emerald success badge (`--color-success`)
- `void`: Neutral muted badge (`--color-text-muted`)  
**Why:** Immediate visual clarity for accounting status across lists and drawers.

#### 4. Plain Text File References & Strict Zero-Money-For-Staff Rule
**Decision:** Attached file references (`file_url`) are rendered strictly as plain text (e.g. `<span>{file_url}</span>`) and never as executable or clickable `<a>` links. Furthermore, non-admin accounts cannot access the page (gated by `RequireAuth(role="admin")`) and `formatMoney` returns empty strings for non-admin callers.  
**Why:** Eliminates client-side URL scheme execution vulnerabilities (XSS via `javascript:` / `data:`) and guarantees that staff members never see commercial figures.

---

### How to Test F-I2

**1. Automated tests**
```bash
npm run test:frontend
# 30/30 tests pass (including 5 in invoicesSource.test.ts)
npm run build:frontend
# tsc && vite build succeeds with exit code 0
```

**2. Manual testing checklist**
```bash
npm run dev:frontend   # http://localhost:5173
```

| Role | Test Step | Expected Result |
|---|---|---|
| Admin | Log in as admin (`admin@space-exs.com`) → Navigate to **Invoices** (`/admin/invoices`) | Invoices ledger loads with Summary Counters, Direction Tabs, and Table of Invoices. |
| Admin | Click "Received (Supplier)" tab | Only supplier purchase invoices (`direction = 'received'`) are displayed. |
| Admin | Click "Issued (Customer)" tab | Only customer billing invoices (`direction = 'issued'`) are displayed. |
| Admin | Filter by Status: "Unpaid" | Only invoices with `status = 'unpaid'` are shown. |
| Admin | Click "View Details" on an invoice | Side drawer slides open showing subtotal, 15% VAT, total in SAR, and the table of line items. |
| Admin | Check file reference on an invoice with `file_url` | Rendered strictly as a plain text string; cannot be clicked as a hyperlink. |
| Staff | Attempt to access `/admin/invoices` directly in browser | Automatically caught by `RequireAuth` and redirected to `/staff`. |

---

### 30-Second Explanation

> The Invoices page provides administrators with a centralised commercial ledger for supplier purchases and customer rental billings. Direction tabs cleanly separate incoming vendor receipts from outgoing customer invoices. Selecting an invoice opens a detailed drawer with line-item breakdowns, tax calculations, and payment or void audit trails. Status badges highlight unpaid invoices, while file references are rendered safely as plain text strings.


---

## F-I3 — "New Supplier Invoice" Form: Dynamic Lines, Server Authority & Error Clarity

**Date:** 2026-11-04  
**Status:** ✅ Complete

---

### What Was Built

| File | Purpose |
|---|---|
| `frontend/src/components/NewSupplierInvoiceModal.tsx` | Modal form for recording received supplier invoices: supplier party selection (presets or custom ID), invoice date, due date, optional plain-text file reference, inventory receipt toggle, dynamic line items with 300ms debounced material search, computed totals preview, and clear server error formatting. |
| `frontend/src/data/invoicesSource.ts` | Added `computeInvoiceTotals` helper (accurate half-up decimal math) and `createSupplierInvoice` API caller (guarded to Admin role only). |
| `frontend/src/pages/admin/InvoicesPage.tsx` | Added "+ New Supplier Invoice" trigger button, success alert banner, and auto-refresh + drawer navigation upon successful invoice creation. |
| `frontend/src/__tests__/invoicesSource.test.ts` | Unit tests verifying `computeInvoiceTotals` accuracy without floating point drift, `createSupplierInvoice` payload submission, and non-admin rejection without network requests. |

---

### Why — Key Design Decisions

#### 1. Dynamic Lines with 300ms Debounced Material Catalog Search
**Decision:** Users can add and remove line items dynamically (minimum 1 line). For each line, typing in the item search field is debounced by 300ms before filtering the warehouse material catalog. Selecting an item automatically sets `item_id`, fills `description`, and assigns `unit_id` and `unit_code`.  
**Why:** Prevents rapid keystroke filtering re-renders on large catalogs and ensures lines are accurately bound to valid database items and unit constraints.

#### 2. Server Authority on Financial Reconciliation
**Decision:** While the UI previews subtotal, 15% VAT, and grand total in real-time, the server remains the single authority on commercial reconciliation. The computed numbers are submitted in the payload, and any server-side validation or precision error is returned and displayed explicitly.  
**Why:** The frontend should never pretend to be the single source of truth on tax or accounting numbers. The server validates line items and decimal precision in a single database transaction.

#### 3. Clear Server Error Formatting
**Decision:** All API errors from `POST /api/invoices/supplier` are caught and formatted into a prominent red alert banner at the top of the form:
- Duplicate (409) returns: *"Duplicate Invoice (409): Invoice '<number>' already exists for this supplier."*
- Totals mismatch (400) surfaces the exact discrepancy message from the server.
- Validation failures highlight missing line items or invalid party IDs.  
**Why:** Users get immediate, actionable feedback without having to inspect DevTools or decipher HTTP error codes.

#### 4. Disable Submit While in Flight
**Decision:** Submitting sets `submitting = true`, which disables the submit button, displays an active spinner, and disables form fields until the server responds.  
**Why:** Prevents double submissions and duplicate database transactions on slow network links.

#### 5. Plain Text File References & Optional Stock Intake
**Decision:** The `file_url` field accepts a plain text reference string (max 500 characters, no executable URL schemes). The `record_stock_receipt` checkbox (defaults to checked) allows warehouse admins to choose whether received items immediately record positive inventory receipts in the stock ledger.  
**Why:** Protects against XSS/phishing vectors and provides operational flexibility when recording invoices retroactively.

---

### How to Test F-I3

**1. Automated tests**
```bash
npm run test:frontend
# 34/34 tests pass (including 9 in invoicesSource.test.ts)
npm run build:frontend
# tsc && vite build succeeds with exit code 0
```

**2. Manual testing checklist**
```bash
npm run dev:frontend   # http://localhost:5173
```

| Role | Test Step | Expected Result |
|---|---|---|
| Admin | Log in as admin (`admin@space-exs.com`) → Invoices page (`/admin/invoices`) | "+ New Supplier Invoice" button is visible in the page header. |
| Admin | Click "+ New Supplier Invoice" | Modal opens with Supplier Party, Invoice #, Dates, File Ref, and one empty line. |
| Admin | Type "Hydraulic" in line 1 item search | After 300ms debounce, suggestion dropdown shows matched items (e.g. `[MAT-001] Hydraulic Oil ISO 46`). |
| Admin | Click an item from dropdown | Item SKU, name, unit (L), and description are populated automatically. |
| Admin | Set Qty: `5`, Unit Price: `45.50` | Line total shows `227.50 SAR`. Computed Subtotal shows `227.50 SAR`, VAT (15%) shows `34.13 SAR`, Total shows `261.63 SAR`. |
| Admin | Click "+ Add Line" | Adds Line #2. Fill item and values; preview totals update dynamically. |
| Admin | Click "Remove" on Line #2 | Removes Line #2; totals adjust back. Remove button is disabled when only 1 line remains. |
| Admin | Click "Record Supplier Invoice" | Submit button changes to "Recording Invoice..." with spinner and inputs are disabled. |
| Admin | On success | Modal closes, green success banner appears on Invoices page, list re-fetches, and new invoice opens in the detail drawer. |
| Admin | Enter duplicate invoice # for same supplier | Modal displays: *"Duplicate Invoice (409): Invoice '...' already exists for this supplier."* Submit button re-enables. |
| Staff | Log in as staff | Invoices route is inaccessible (redirects to `/staff`). No invoice buttons exist. |

---

### 30-Second Explanation

> Administrators can now record received supplier invoices through a responsive modal with dynamic line items. Typing in the item search field debounces across the material catalog and auto-fills descriptions and unit specifications. Subtotal, 15% VAT, and total amounts are previewed in real-time while submitting delegates final reconciliation to the server. Double-submissions are prevented while requests are in flight, and server rejections (such as duplicate invoice numbers or precision mismatches) are displayed in a clear error alert.


---

## F-I4 — "New Customer Invoice" Form & "Mark Paid" Action

**Date:** 2026-11-04  
**Status:** ✅ Complete

---

### What Was Built

| File | Purpose |
|---|---|
| `frontend/src/components/NewCustomerInvoiceModal.tsx` | Modal form for recording issued customer invoices: customer party selection (seeded presets or custom ID), optional linked rental contract ID (`rental_id`), invoice dates, plain-text file reference, dynamic line items with optional debounced material search or custom service descriptions, computed totals preview, and clear server error formatting. |
| `frontend/src/data/invoicesSource.ts` | Added `createCustomerInvoice` and `markInvoicePayment` API callers, with strict Admin-role authorization guards. |
| `frontend/src/pages/admin/InvoicesPage.tsx` | Added "+ Customer Invoice" trigger button, "Mark Paid" action in the invoice detail drawer and table rows, settlement date modal, and automatic list re-fetch + drawer state sync upon completion. |
| `frontend/src/__tests__/invoicesSource.test.ts` | Unit tests verifying `createCustomerInvoice` and `markInvoicePayment` payload submission and non-admin rejection without network requests (38/38 tests passing). |

---

### Why — Key Design Decisions

#### 1. Store-Only Customer Invoicing Workflow
**Decision:** Customer invoices use a store-only recording workflow (`POST /api/invoices/customer`). No generation or ZATCA XML is triggered. Unlike supplier invoices, customer invoices never generate stock receipts.  
**Why:** Directly aligns with confirmed client requirements: commercial invoices are stored for billing audits, equipment rentals, and margin analysis without coupling to external tax agency gateways in Phase 1.

#### 2. "Mark Paid" Settlement Action
**Decision:** Both received and issued invoices can be marked paid via `PATCH /api/invoices/:id/payment`. A modal dialog prompts for the settlement date (`paid_on`, defaulting to today and disallowing future dates).  
**Why:** Captures payment reconciliation with clear audit metadata (`paid_by` and `paid_on`) while preventing erroneous future dates.

#### 3. Foreign Rental & Duplicate Validation Feedback
**Decision:** The UI surfaces specific server rejections in prominent alert banners:
- Foreign Rental (400): If a `rental_id` belongs to a different customer than selected, the server's exact message is displayed.
- Duplicate (409): Flags identical invoice numbers for the same customer.  
**Why:** Prevents accounting mix-ups where billing records are attached to unrelated rental contracts.

#### 4. Dynamic Billing Lines with Optional Item Linking
**Decision:** Lines can either link to a material item (auto-populating SKU and unit specifications via debounced search) or serve as free-text rental/service descriptions.  
**Why:** Customer invoices frequently bill for time-based equipment rentals or services rather than discrete inventory items.

#### 5. Strict Zero-Money-For-Staff & Plain-Text File References
**Decision:** Gated entirely to administrators. File references (`file_url`) remain plain text strings in inputs, tables, and drawers, avoiding clickable or executable URL schemes.  
**Why:** Strict XSS prevention and absolute protection of commercial pricing margins from field staff.

---

### How to Test F-I4

**1. Automated tests**
```bash
npm run test:frontend
# 38/38 tests pass (including 13 in invoicesSource.test.ts)
npm run build:frontend
# tsc && vite build succeeds with exit code 0
```

**2. Manual testing checklist**
```bash
npm run dev:frontend   # http://localhost:5173
```

| Role | Test Step | Expected Result |
|---|---|---|
| Admin | Log in as admin (`admin@space-exs.com`) → Invoices page (`/admin/invoices`) | Both "+ Supplier Invoice" and "+ Customer Invoice" buttons are visible in the header. |
| Admin | Click "+ Customer Invoice" | Modal opens with Customer Party selector, Invoice #, Rental ID (optional), Dates, File Ref, and line items. |
| Admin | Select Customer: "Apex Infrastructure Partners (ID: 4)", Invoice #: "INV-CUST-2026-001" | Form fields update. |
| Admin | In Line 1, type description: "Crane Rental Fee", Qty: 1, Unit Price: 1000 | Line total shows `1,000.00 SAR`. Computed Subtotal shows `1,000.00 SAR`, VAT (15%) shows `150.00 SAR`, Total shows `1,150.00 SAR`. |
| Admin | Click "Record Customer Invoice" | Submit button displays spinner and "Recording Invoice...". On success, modal closes, green success banner appears, list re-fetches, and invoice opens in detail drawer. |
| Admin | Open unpaid invoice in detail drawer | "✓ Mark Paid" button is visible in the drawer header. |
| Admin | Click "✓ Mark Paid" | Modal prompts for settlement date (defaults to today). Future dates are blocked. |
| Admin | Click "Confirm Paid" | Button changes to "Recording Payment..." with spinner. On success, modal closes, status updates to "Paid", `paid_on` is displayed, and "Mark Paid" button disappears. |
| Admin | On main invoices list | Table row for the invoice shows green "Paid" badge. |
| Staff | Log in as staff | Invoices page remains completely inaccessible (redirects to `/staff`). Zero invoice or money data is accessible. |

---

### 30-Second Explanation

> Administrators can now record issued customer billing invoices with dynamic line items linked either to catalog items or custom equipment rental services. Subtotals, VAT, and totals reconcile with the server, which strictly guards against duplicate numbers and mismatched rental IDs. Any unpaid invoice (received or issued) can be marked as paid through a verified settlement action with audit logging. Staff remain barred from accessing commercial invoices, and file references remain secure plain text.

---

## F-S1 — Scan Page (Staff & Admin), Camera QR Scanning, 5 FPS Limit, 3-Second Cooldown, Snapshot-First Resolution

**Date:** 2026-11-06  
**Status:** ✅ Complete

---

### What Was Built

| File | Purpose |
|---|---|
| `frontend/src/components/CameraScanner.tsx` | Camera QR scanner powered by `html5-qrcode`: configured for 5 fps frame rate, 3-second (3000ms) repeat-read cooldown, unmount stream cleanup, and permission-denied / unsupported browser detection with friendly retry controls. |
| `frontend/src/pages/shared/ScanPage.tsx` | Shared Scan page for staff and admin: renders camera viewfinder with targeting crosshairs, instant resolution banner, ALWAYS-available manual asset-code entry fallback, and resolved asset preview card with status badges, location, condition, and data source indicator (`● Live Server` vs `○ Offline Snapshot`). |
| `frontend/src/data/equipmentSource.ts` | Added `EquipmentDetail`, `ResolveEquipmentResult`, `getSnapshotEquipmentByCode`, `fetchLiveEquipmentByCode`, and `resolveEquipmentByCode` (resolves from local IndexedDB snapshot first, then queries `GET /api/equipment/:asset_code`). |
| `frontend/src/router/AppRouter.tsx` | Added `/admin/scan` and `/staff/scan` routes for both roles, plus preliminary `/equipment/:asset_code` route placeholders for F-S2. |
| `frontend/src/pages/layouts/AppLayout.tsx` | Added "Scan QR" NavItem in main navigation for both Admin and Staff. |
| `frontend/src/pages/staff/StaffHomePage.tsx` | Added prominent "Scan QR Code" quick-nav card to staff dashboard. |
| `frontend/src/pages/admin/AdminHomePage.tsx` | Added "Scan QR Code" quick-nav card to admin dashboard. |
| `frontend/src/pages/shared/EquipmentListPage.tsx` | Added "📷 Scan QR Code" button in the header toolbar linking to the scan page. |
| `frontend/src/__tests__/equipmentSource.test.ts` | Added unit tests verifying `getSnapshotEquipmentByCode`, `fetchLiveEquipmentByCode`, and `resolveEquipmentByCode` offline/live fallback. |
| `frontend/src/__tests__/scan.test.ts` | Test suite verifying the 3-second debounce rule, 5 fps rate limit, camera cleanup on unmount, permission denied handling, and validation against QR codes printed from `/api/labels/sheet`. |

---

### Why — Key Design Decisions

#### 1. 5 FPS Frame Rate & 3-Second Repeat Read Cooldown
**Decision:** The camera scanner is strictly throttled to 5 frames per second (`fps: 5`), and identical decoded strings are ignored for 3 seconds (`3000ms`).  
**Why:** Continuous 30 or 60 fps camera decoding causes thermal throttling and rapid battery drain on field mobile devices. Throttling to 5 fps consumes negligible CPU while scanning instantly. The 3-second cooldown prevents accidental duplicate resolutions when a technician aims the camera at an equipment tag.

#### 2. Snapshot-First Resolution (`resolveEquipmentByCode`)
**Decision:** When an asset code is scanned or entered, the client queries the local IndexedDB snapshot store (`equipment-list`) first. If offline, the snapshot resolution is returned immediately. If online, the server's `GET /api/equipment/:asset_code` is fetched to retrieve live status, location history, active rental details, and open maintenance tickets.  
**Why:** Technicians frequently operate in concrete yards or remote desert sites with spotty network coverage. Checking the local snapshot first guarantees instant asset identification even when offline.

#### 3. ALWAYS-Available Manual Asset-Code Fallback
**Decision:** A manual entry form with uppercase auto-normalization is prominently rendered alongside the camera view, and remains fully functional even if camera access is denied, unsupported, or paused.  
**Why:** Physical QR tags in heavy industrial yards can get scratched, painted over, or coated in grease and sand. Technicians must never be blocked by optical tag failures.

#### 4. Clean Camera Stream Lifecycle Management
**Decision:** The camera stream is bound to React's component lifecycle. When the technician navigates away from the scan page, the stream is explicitly stopped (`scanner.stop()`) and DOM elements are cleared. A manual "Pause Camera" toggle is also provided.  
**Why:** Prevents hardware camera indicators from staying on, preserves mobile battery life, and eliminates memory leaks.

#### 5. Compatibility with Plain-Text QR Labels (`/api/labels/sheet`)
**Decision:** The scanner accepts the exact plain-text `asset_code` payload generated by the backend label sheet service (e.g. `CRN-50-001`, `GEN-250-001`) as specified in ADR 014.  
**Why:** Keeps QR payloads short and high-entropy, allowing High error correction (`H`, 30% recovery) on compact printable tags.

---

### How to Test F-S1

**1. Automated tests**
```bash
npm run test:frontend
# 57/57 tests pass across 6 test suites (including 11 in scan.test.ts)
npm run build:frontend
# tsc && vite build succeeds with exit code 0
```

**2. Manual testing checklist**
```bash
npm run dev:frontend   # http://localhost:5173
```

| Role | Test Step | Expected Result |
|---|---|---|
| Staff | Log in as staff (`staff@spaceexspace.com`) → Click "Scan QR" in top nav or home card | Navigates to `/staff/scan`. Viewfinder initializes with 5 fps overlay and targeting crosshairs. |
| Staff | Deny camera permission in browser popup | Viewfinder switches to clear alert: *"Camera permission was denied... Please use manual entry below."* |
| Staff | Type "CRN-50-001" in the manual asset-code input → Click "Look Up" | Resolves asset `CRN-50-001`. Card displays "Tadano GR-500EX", status badge, location, and data source indicator. |
| Staff | Toggle network to Offline in DevTools → Enter "GEN-250-001" | Resolves instantly from local IndexedDB snapshot; displays `○ Offline Snapshot` tag and cached timestamp. |
| Staff | Click "Scan Another Asset" | Resets the view and returns to the scanner/manual form. |
| Admin | Log in as admin (`admin@spaceexspace.com`) → Equipment page | Top header displays "📷 Scan QR Code" button. Clicking it navigates to `/admin/scan`. |
| Admin | Enter non-existent code "INVALID-999" | Displays clear error banner: *"Equipment with asset code 'INVALID-999' was not found on the server."* |

---

### 30-Second Explanation

> Both staff and administrators now have access to a dedicated QR Scan page featuring real-time camera scanning limited to 5 frames per second with a 3-second repeat cooldown to conserve device battery and avoid duplicate reads. The resolution pipeline checks the local IndexedDB snapshot first for instant offline identification, then queries the live server when online. An accessible manual asset-code entry form is always available for damaged or unreadable physical tags, and the camera stream cleanly shuts down the moment a user leaves the page.

---

## F-S2 — Asset Detail Page, Offline-First Outbox Actions (Move, Return, Repair), Status Sync & Role-Gated Rates

**Date:** 2026-11-06  
**Status:** ✅ Complete

---

### What Was Built

| File | Purpose |
|---|---|
| `frontend/src/pages/shared/EquipmentDetailPage.tsx` | Dedicated asset detail page for `/admin/equipment/:asset_code` and `/staff/equipment/:asset_code`. Displays type, model, serial no, capacity, current status, location, condition, last moved info, movement history log, active rental terms, open maintenance tickets, and admin rate cards. Embeds action modals for Move, Return, and Send to Repair with outbox status banners. |
| `frontend/src/data/equipmentSource.ts` | Added `AppLocation`, `DEFAULT_LOCATIONS`, and `fetchLocations` (queries `GET /api/sync/snapshot`, caches in IndexedDB snapshot, and falls back to resilient defaults when offline). |
| `frontend/src/offline/outbox.ts` | Guarded `notify()` against `undefined window` in headless/node environments to ensure seamless test execution. |
| `frontend/src/pages/shared/EquipmentListPage.tsx` | Enhanced equipment cards with keyboard and click navigation to `/${role}/equipment/${encodeURIComponent(eq.asset_code)}`. |
| `frontend/src/router/AppRouter.tsx` | Wired `<EquipmentDetailPage />` into `/admin/equipment/:asset_code` and `/staff/equipment/:asset_code` routes. |
| `frontend/src/__tests__/equipmentDetail.test.ts` | Comprehensive unit tests (14 tests) verifying role gating on rates (zero rates/currency for staff, rates visible for admin), offline fallback, outbox event generation (move, return, send_to_repair), server rejection handling, and action preconditions. |

---

### Why — Key Design Decisions

#### 1. Zero Rates for Staff Everywhere
**Decision:** Staff users never see rate cards, agreed rates (`applied_rate`), discount notes, or maintenance repair costs anywhere on the detail page or subcomponents. For admin users, standard rate cards (`standard_rates`) and active rental commercial terms are clearly rendered.  
**Why:** Commercial rate sensitivity is paramount. Yard technicians and field staff manage physical movements and machine condition, but must never see negotiated rates or rate cards. The frontend strictly guards rendering in addition to the backend's `sanitizeFinancials()` serializer.

#### 2. Offline-First Outbox Actions via `enqueueEvent`
**Decision:** All three fleet operations—**Move**, **Return**, and **Send to Repair**—write directly to the client IndexedDB outbox via `enqueueEvent`. Every action receives a client UUID and calibrated timestamp (`occurredAt`). If online, `runSync` is triggered in the background; if offline, the action remains safe in the outbox until connectivity is restored.  
**Why:** Heavy machinery relocation and yard check-ins often occur in dead zones without cell signal. Field staff cannot wait for network connectivity to record physical movements.

#### 3. Action Preconditions and Domain Rules
**Decision:**
- **Move:** Always permitted across any active asset (relocations between yards, sites, and workshops).
- **Return:** Permitted only when `status === 'rented'`. Disabled with explanatory text for available or in-repair equipment.
- **Send to Repair:** Permitted only when `status !== 'rented'` and `status !== 'under_repair'`. Rented assets must be returned to a yard before opening maintenance, and machines already under repair cannot have duplicate open orders.  
**Why:** Prevents invalid fleet states and aligns with backend validation rules in `syncController.ts`.

#### 4. Real-time Outbox Status Banners
**Decision:** The asset detail page listens to `useOutbox(userId)` and filters events for this specific asset code:
- **Pending sync:** Shows an amber warning banner with the action type and timestamp, along with a manual "Sync Now" button if online.
- **Rejected sync:** Shows a red alert banner displaying the exact server rejection reason (e.g., *"Equipment is actively rented. Return it to a yard first"*), with an immediate "Discard" button calling `discardEvent(id)` to review and clear the error.  
**Why:** Provides transparent visibility into asynchronous background sync progress without requiring the user to open the global outbox dropdown.

#### 5. Resilient Location Pickers (`fetchLocations`)
**Decision:** Location pickers load locations from `GET /api/sync/snapshot`, cache them in local snapshot storage (`locations-list`), and fall back to hardcoded `DEFAULT_LOCATIONS` if no cache exists offline.  
**Why:** Action dialogs require valid destination `location_id`s. Even when starting the app completely offline, technicians can immediately select valid yards and workshops.

---

### How to Test F-S2

**1. Automated tests**
```bash
npm run test:frontend
# 71/71 tests pass across 7 test suites (including 14 in equipmentDetail.test.ts)
npm run build:frontend
# tsc && vite build passes with 0 errors
```

**2. Manual testing checklist**
```bash
npm run dev:frontend   # http://localhost:5173
```

| Role | Test Step | Expected Result |
|---|---|---|
| Admin | Log in as admin (`admin@spaceexspace.com`) → Navigate to `/admin/equipment` → Click "CRN-50-001" | Navigates to `/admin/equipment/CRN-50-001`. Header displays status "Rented", condition "Good", serial number, capacity, and current location. |
| Admin | Inspect Active Rental & Rates sections | Active Rental shows Aramco customer details, site name, dates, agreed rate (`2,800.00 SAR / day`), and discount note. Standard Rate Cards table displays day/week/month rates with VAT status. |
| Staff | Log in as staff (`staff@spaceexspace.com`) → Navigate to `/staff/equipment/CRN-50-001` | Navigates to `/staff/equipment/CRN-50-001`. Machine specs and rental customer/dates are shown, but **NO rates or currency figures appear anywhere**. Standard rate card table is absent. |
| Staff | Click "📍 Move" | Opens Move Modal. Select "Jubail Industrial Yard", enter note "Relocated for project", submit. Modal closes. If offline, amber "Pending Sync" banner appears immediately. |
| Staff | Click "🔄 Return" on rented machine | Opens Return Modal. Select receiving yard, condition ("Fair"), enter note, submit. Action enqueues to outbox. |
| Staff | Check "🔧 Send to Repair" on rented machine | Button is disabled with explanatory note: *"This machine is currently rented. To open maintenance, it must first be returned."* |
| Staff | Simulate Rejected Event (or outbox rejection) | Outbox displays red alert banner: *"Sync Rejected: [server reason]"* with a "Discard" button that clears it on click. |

---

### 30-Second Explanation

> The Asset Detail page gives staff and administrators a comprehensive view of any machine in the fleet—including specifications, current status, location, condition, full movement history, active rental terms, and maintenance work orders. Three offline-first actions (Move, Return, Send to Repair) write immediately to the local IndexedDB outbox with client UUIDs and calibrated timestamps, showing clear "Pending sync" or server "Sync Rejected" feedback banners with a discard option. Staff are strictly barred from seeing any rental rates or monetary amounts, while administrators have full access to agreed rates and standard rate cards.


---

## F-S3 — Admin Dashboard (Fleet Status Breakdown, Overdue Returns, Low-Stock Inventory & Outbox Monitor)

**Date:** 2026-11-06  
**Status:** ✅ Complete

---

### What Was Built

| File | Purpose |
|---|---|
| `frontend/src/data/dashboardSource.ts` | Operational intelligence aggregation module: calculates fleet status counts (Available, Rented, Under Repair, Total), detects overdue rental returns based on expected return dates, filters low-stock materials, and provides offline fallback using IndexedDB snapshots. |
| `frontend/src/pages/admin/AdminHomePage.tsx` | Rebuilt Operations Director Dashboard featuring live/offline status indicator, 4 fleet status metric cards linking to equipment filters, real-time offline sync & outbox monitor with server rejection banners and immediate discard buttons, overdue equipment returns table, low-stock inventory table, and quick operational action cards. |
| `frontend/src/mocks/equipmentMock.ts` | Enhanced `MockEquipment` interface with optional rental fields (`current_rental_id`, `current_customer_name`, `current_site_name`, `current_rental_expected_end`) matching server SQL view `v_equipment_current`. |
| `frontend/src/__tests__/dashboardSource.test.ts` | Test suite (8 tests) verifying status counters aggregation, date-overdue logic, overdue returns extraction, low-stock filtering, outbox tracking with discard, and snapshot fallback. |

---

### Why — Key Design Decisions

#### 1. Real-time Status Breakdown with One-Click Fleet Filtering
**Decision:** The dashboard aggregates derived machine states from `loadEquipment()` into four distinct cards: Total Fleet, Available (in yard, ready for dispatch), Rented (deployed on client site), and Under Repair (workshop work order). Clicking any card navigates to `/admin/equipment`.  
**Why:** Operations directors need immediate situational awareness of fleet availability at a glance without navigating through multiple pages or running manual queries.

#### 2. Proactive Overdue Equipment Return Tracking
**Decision:** Active rented assets whose `current_rental_expected_end` precedes current date are automatically flagged as overdue with the exact number of days overdue. Each row displays the asset code (linking to its detail page), equipment make/model, customer name, project site, and a direct "Check In" button.  
**Why:** Equipment overstaying rental agreements directly compromises turnaround schedules and asset availability for upcoming reservations. Surfacing overdue units immediately allows administrators to follow up with clients or record returns.

#### 3. Low-Stock Materials Alerting
**Decision:** The materials ledger is evaluated against `current_stock <= reorder_level` or `is_low_stock`. Items at or below threshold are listed with SKU, category, stock on hand vs reorder level, and a link to `/admin/materials`.  
**Why:** Heavy machinery operations depend on critical maintenance consumables (filters, hydraulic oil, lubricants). Preventing stock-outs avoids costly maintenance delays.

#### 4. Real-time Outbox & Sync Monitor with Immediate Discard
**Decision:** Built directly into the dashboard using `useOutbox(userId)`:
- When staff actions are rejected by the server, an alert banner displays the exact server error reason with an inline **Discard** button that removes the event from IndexedDB via `discardEvent(id)`.
- When pending actions exist, an amber status banner shows queued operations with a manual "Sync Now" button.
- When all events are synced, a clean green confirmation displays.  
**Why:** Gives administrators total visibility into field sync activity, ensuring rejected offline actions are never silently forgotten.

#### 5. Offline Snapshot Resilience
**Decision:** The entire dashboard aggregates its metrics from cached IndexedDB snapshots (`equipment-list` and `materials-list`) when offline, displaying an offline snapshot indicator with cached timestamp.  
**Why:** Executive dashboard visibility remains uninterrupted even during network dropouts or field inspections in remote areas.

---

### How to Test F-S3

**1. Automated tests**
```bash
npm run test:frontend
# 79/79 tests pass across 8 test suites (including 8 in dashboardSource.test.ts)
npm run build:frontend
# tsc && vite build passes with 0 errors
```

**2. Manual testing checklist**
```bash
npm run dev:frontend   # http://localhost:5173
```

| Role | Test Step | Expected Result |
|---|---|---|
| Admin | Log in as admin (`admin@spaceexspace.com`) | Lands on `/admin`. Dashboard renders welcome greeting, live sync status badge, and 4 status metric cards (Total, Available, Rented, Under Repair). |
| Admin | Click "Available" card | Navigates to `/admin/equipment` with fleet list ready. |
| Admin | Inspect Overdue Returns section | Overdue items (e.g. `CRN-50-001`) are listed with red due date and days overdue tag. Clicking "Check In" or asset code navigates to `/admin/equipment/CRN-50-001`. |
| Admin | Inspect Low-Stock Materials section | Items below reorder level (e.g. `OIL-15W40-DRUM`) are displayed with current stock vs reorder level. |
| Admin | Inspect Outbox Monitor | If no events, displays "✓ Outbox Synchronized". If rejected events exist, shows red banner with server reason and "Discard" button that clears it immediately. |
| Admin | Toggle DevTools network to Offline | Status switches to "○ Offline Mode (Cached Snapshot)". Dashboard continues rendering metrics from local IndexedDB snapshot. |
| Staff | Log in as staff (`staff@spaceexspace.com`) | Staff landing remains restricted to operational staff home (`/staff`); cannot access admin dashboard. |

---

### 30-Second Explanation

> The Admin Dashboard provides operations directors with real-time operational intelligence across four key pillars: high-level equipment fleet status counts, proactive alerting for overdue rental returns with days-overdue tracking, inventory warnings for materials at or below reorder levels, and a live offline sync monitor showing queued actions or server-rejected events with one-click discard. All metrics compute seamlessly whether connected to the live server or running offline from IndexedDB snapshots.



---

## F-S4 — Cold Start ETag Snapshot, Searchable Party Picker, Editable VAT with decimal.js, Clock Offset Reset, Dead Code Removal & ADR 018

**Date:** 2026-11-06  
**Status:** ✅ Complete

---

### What Was Built / Changed

| File | Purpose |
|---|---|
| `backend/src/controllers/partiesController.ts` | Minimal admin-only `GET /api/parties?role=customer|supplier` controller returning id, name, and role. |
| `backend/src/routes/partiesRoutes.ts` | Parties router with `authenticateToken` and `requireRole(['admin'])`. |
| `backend/src/app.ts` | Mounted `/api/parties` router. |
| `backend/src/__tests__/parties.test.ts` | Integration test suite (7 tests) verifying customer/supplier filtering, admin-only authorization, 401 unauthenticated, and 403 staff rejection. |
| `frontend/src/api/client.ts` | Added `fetchSnapshotWithEtag<T>(path, cachedEtag)` handling conditional `If-None-Match` with HTTP 304 response, plus clear 403 Forbidden messages. |
| `frontend/src/offline/db.ts` | Enhanced `saveSnapshot` and `loadSnapshot` with ETag metadata persistence. |
| `frontend/src/data/equipmentSource.ts` | Refactored `loadEquipment(userId)` to use `GET /api/sync/snapshot` with conditional `If-None-Match` ETag validation instead of paging. Moved `MockEquipment`, `EquipmentStatus`, and `EquipmentCondition` types here. |
| `frontend/src/components/SearchablePartyPicker.tsx` | Searchable customer/supplier picker querying `/api/parties?role=` with search filtering and clear selection. |
| `frontend/src/data/invoicesSource.ts` | Updated `computeInvoiceTotals(lines, vatRatePercent)` using `decimal.js` arbitrary-precision arithmetic for unit prices, line totals, subtotal, VAT, and invoice total. |
| `frontend/src/components/NewSupplierInvoiceModal.tsx` | Integrated `SearchablePartyPicker` and editable VAT rate input (15.00% default) with live decimal calculation. |
| `frontend/src/components/NewCustomerInvoiceModal.tsx` | Integrated `SearchablePartyPicker` and editable VAT rate input (15.00% default) with live decimal calculation. |
| `frontend/src/context/AuthContext.tsx` | Reset calibrated clock offset to 0 (`resetClockOffset()`) on logout and 401 session invalidation. |
| `frontend/src/router/RequireAuth.tsx` | Rendered clear 403 Access Denied explanation and return link when staff access admin routes. |
| `frontend/src/mocks/equipmentMock.ts` | **Deleted.** Removed static equipment mock data completely. |
| `frontend/src/sync/syncClient.ts` | Removed unused `simulateNext401` export. |
| `docs/decisions/018-prototype-jwt-localstorage-and-production-cookie-strategy.md` | Created ADR 018 documenting prototype localStorage JWT storage, XSS mitigations, and production httpOnly Secure SameSite cookie strategy. |
| `README.md` | Linked ADR 018 in Architectural Decision Records section. |

---

### Why — Key Design Decisions

#### 1. Equipment Cold Start with HTTP 304 / ETag
**Decision:** Instead of multiple paginated queries (`GET /api/equipment?page=1...N`), the client calls `GET /api/sync/snapshot` passing the local cached snapshot's ETag in the `If-None-Match` header.  
**Why:** If the equipment fleet has not changed on the server, the server immediately returns HTTP 304 Not Modified (zero entity body). The client reuses the existing IndexedDB snapshot with zero bandwidth and minimal database load.

#### 2. Searchable Party Picker & Admin-Only Minimal Endpoint
**Decision:** Added `GET /api/parties?role=supplier` and `GET /api/parties?role=customer` guarded by `requireRole(['admin'])`. The frontend `SearchablePartyPicker` fetches the relevant party records, lets the administrator type to filter, and selects the party ID.  
**Why:** Replaces brittle hardcoded party IDs with actual customer/supplier records from PostgreSQL while maintaining strict administrative isolation (staff receive 403 Forbidden).

#### 3. Editable VAT Rate with Arbitrary-Precision Math (decimal.js)
**Decision:** Invoice creation forms now allow administrators to edit the VAT rate (defaulting to 15.00%). Calculations for line totals, subtotal, VAT amount, and grand total are performed using `decimal.js` with half-up rounding.  
**Why:** Standard JavaScript IEEE 754 floating-point math causes rounding inaccuracies (e.g. 0.1 + 0.2 = 0.30000000000000004). Financial totals in Saudi Riyals must be mathematically sound and match server-side ledger invariants (ADR 016 & ADR 017).

#### 4. Reset Clock Offset on Logout
**Decision:** When a user logs out or has their session invalidated by a 401, `resetClockOffset()` resets the calibrated clock offset to 0.  
**Why:** Ensures that clock skew calibration from one session does not leak or contaminate a different user's session or subsequent logins on shared yard devices.

#### 5. Clear 403 Explanations
**Decision:** Added user-friendly explanations in both the API client (`ApiRequestError`) and route guard (`RequireAuth.tsx`) stating that the action or route requires Administrator privileges.  
**Why:** Prevents confusion when field staff attempt to navigate to administrative features or call restricted endpoints.

#### 6. Removal of Dead Mock Data
**Decision:** Deleted `frontend/src/mocks/equipmentMock.ts` and removed `simulateNext401` from `syncClient.ts`. Updated all imports across components and test suites.  
**Why:** Eliminates leftover mock data and ensures the app relies solely on live API data and real IndexedDB offline snapshots.

---

### How to Test F-S4

**1. Automated tests**
```bash
npm run test:backend
# 162/162 passed (including 7 new tests in parties.test.ts)
npm run test:frontend
# 82/82 passed across all 8 test suites
npm run build:frontend
# tsc && vite build passes with 0 errors
```

**2. Manual testing checklist**
```bash
npm run dev:frontend   # http://localhost:5173
```

| Role | Test Step | Expected Result |
|---|---|---|
| Admin | Log in as admin (`admin@spaceexspace.com`) → Navigate to Invoices → "New Supplier Invoice" | Modal opens. Supplier field is a searchable picker with live suppliers. VAT rate is editable (defaults to 15.00%). Changing VAT % recalculates tax and total instantly using `decimal.js`. |
| Admin | Check Network Tab on reload of `/admin/equipment` | First load: 200 OK with ETag. Subsequent load: `If-None-Match: <etag>` header sent; server returns 304 Not Modified; client uses cached IndexedDB snapshot. |
| Staff | Log in as staff (`staff@spaceexspace.com`) → attempt to navigate to `/admin/invoices` | `RequireAuth` blocks route and displays clear 403 Forbidden card: *Access Denied. Your account (Staff) does not have permission to view this page.* |
| Staff | Log in as staff → Click Log Out | IndexedDB wiped, token removed, and clock offset reset to 0. |

---

### 30-Second Explanation

> Step F-S4 completes the frontend transition to production-grade architecture: equipment cold starts now use `GET /api/sync/snapshot` with HTTP 304 conditional ETag validation to eliminate redundant data transfer; hardcoded party pickers are replaced with an admin-only searchable customer/supplier selector; VAT rates are editable and previewed with `decimal.js` arbitrary precision; clock offsets reset on logout; 403 errors surface human-readable explanations; and all leftover mock equipment files and test helpers are cleaned up.

---

## F-S5 — Camera Diagnostics, Permissions Policy, Fallback getUserMedia Harness & Repair Kind Resolution

**Date:** 2026-11-08  
**Status:** ✅ Complete

---

### What Was Built / Changed

| File | Purpose |
|---|---|
| `frontend/src/utils/cameraErrors.ts` | Diagnostic parser `parseCameraError()` mapping `NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError`, `SecurityError`, and `AbortError` to `{ name, message, hint }`. |
| `frontend/vite.config.ts` | Configured `Permissions-Policy: camera=(self)` headers on dev and preview servers. |
| `backend/src/app.ts` | Configured `Permissions-Policy: camera=(self)` middleware for Express API. |
| `frontend/src/components/CameraScanner.tsx` | Replaced `display: none` container with persistent absolute layout to prevent 0x0 size errors; relaxed constraints to `{ facingMode: { ideal: 'environment' } }` with fallback to `cameras[0].id`; added React 18 StrictMode double-mount lifecycle guard with `stopAndClear()`; added diagnostic error UI card with plain hints and test page link. |
| `frontend/src/pages/shared/ScanPage.tsx` | Added dev-only `?debug=1` panel displaying `isSecureContext`, `userAgent`, enumerated hardware cameras, and shortcut link to the test page. |
| `frontend/src/pages/shared/CameraTestPage.tsx` | Created minimal standalone test page using raw `navigator.mediaDevices.getUserMedia` (`<video playsInline muted autoPlay>`), camera toggle, and live track diagnostics. |
| `frontend/src/router/AppRouter.tsx` | Mounted `CameraTestPage` at `/admin/camera-test` and `/staff/camera-test`. |
| `frontend/src/pages/shared/EquipmentDetailPage.tsx` | Fixed "Send to Repair" modal to provide explicit `<select id="repair-kind">` choosing between `'repair'` (default) and `'modification'`, and reset modal state on open/close cycles. |
| `backend/src/controllers/equipmentController.ts` | Fixed `maintId` scope in `sendToRepair` and returned `{ id, kind, description }` under `maintenance` in the response payload. |
| `backend/src/__tests__/equipment.test.ts` | Added integration tests verifying `kind: 'repair'` and `kind: 'modification'` writes to the maintenance table. |
| `frontend/src/__tests__/equipmentDetail.test.ts` | Added frontend unit tests verifying outbox event enqueue captures `kind: 'modification'`. |
| `frontend/src/__tests__/scan.test.ts` | Added unit tests verifying `parseCameraError()` mappings for all WebRTC exception types and generic strings. |
| `docs/CAMERA_DEBUG.md` | Comprehensive investigation and diagnosis report documenting the findings, root causes, permissions policy, and solutions. |

---

### Why — Key Design Decisions

#### 1. Zero-Dimension Container Fix
**Decision:** Instead of hiding `<div id="sx-qr-reader">` with `display: none` during initializing state, the container is styled with `position: absolute; inset: 0; visibility: status === 'scanning' ? 'visible' : 'hidden'`.  
**Why:** `html5-qrcode` requires non-zero bounding box dimensions during `start()` to calculate aspect ratios and canvas coordinates. `display: none` evaluates to `0x0`, causing geometry calculation exceptions.

#### 2. Ideal FacingMode with Device ID Fallback
**Decision:** Changed constraint from `{ facingMode: 'environment' }` to `{ facingMode: { ideal: 'environment' } }`, catching overconstrained errors and automatically falling back to `cameras[0].id` from `Html5Qrcode.getCameras()`.  
**Why:** Single-camera laptops and desktops lack an environmental (rear) camera. Exact constraints throw `OverconstrainedError`, while ideal constraints allow the browser to use whatever camera is available.

#### 3. StrictMode Double-Mount Guard
**Decision:** Implemented `mountIdRef` and `stopAndClear()` that safely awaits `scannerRef.current.stop()` before allowing re-initialization.  
**Why:** React 18 in dev mode unmounts and remounts components instantly. Because stopping hardware media tracks is asynchronous, the second mount collided with the un-stopped first mount, throwing `NotReadableError` (device busy).

#### 4. Plain-Language Diagnostic Feedback & ?debug=1 Inspection
**Decision:** Technicians now see clear, actionable hints (e.g. check browser URL lock icon, close competing apps like Teams) rather than silent stalls or cryptic DOMException strings. The `?debug=1` parameter provides an immediate HUD showing secure context status and hardware enumeration.

#### 5. Raw getUserMedia Test Harness
**Decision:** Built `/admin/camera-test` and `/staff/camera-test` using raw `<video>` and `getUserMedia`.  
**Why:** Provides an unambiguous test bed to prove whether camera failure is an OS/browser permission issue or a third-party scanning library bug.

#### 6. Maintenance Record Kind Disambiguation
**Decision:** Added repair kind selector (`repair` vs `modification`) in `EquipmentDetailPage.tsx`, reset state on open/close, and verified database persistence.  
**Why:** Field technicians can now properly classify vehicle/equipment modifications separately from corrective maintenance overhauls, preventing data corruption in maintenance logs.

---

### How to Test F-S5

**1. Automated tests**
```bash
npm run test:backend
# 163/163 passed (including repair/modification kind assertions)
npm run test:frontend
# 89/89 passed (including 7 new parseCameraError tests and modification outbox tests)
npm run build:frontend
# tsc && vite build passes with 0 errors
```

**2. Manual testing checklist**
```bash
npm run dev:frontend   # http://localhost:5173
```

| Role | Test Step | Expected Result |
|---|---|---|
| Admin / Staff | Visit `/admin/scan?debug=1` or `/staff/scan?debug=1` | Diagnostic HUD shows Secure Context: true, User Agent string, and enumerated cameras. |
| Admin / Staff | Deny camera permission in browser | Card shows `NotAllowedError` with hint: *"Camera permission was denied. Please allow camera access in your browser settings (URL bar lock icon) and refresh."* |
| Admin / Staff | Visit `/admin/camera-test` or `/staff/camera-test` | Minimal test page renders raw video feed with live track diagnostics (label, width, height, aspect ratio). |
| Admin / Staff | Navigate to `/admin/equipment/CRN-50-001` → Click "Send to Repair" | Modal defaults to "Repair / Overhaul". Changing to "Engineering Modification" and submitting logs `kind: 'modification'` in outbox/backend. |

---

### 30-Second Explanation

> Step F-S5 makes the equipment QR scanner rock-solid across field hardware: it eliminates zero-dimension container bugs and StrictMode double-mount collisions; falls back gracefully from ideal rear camera constraints to any available camera on single-lens workstations; provides plain-English troubleshooting advice for all camera errors; introduces an isolated raw `getUserMedia` test harness; and fixes the maintenance workflow so work orders correctly distinguish repairs from engineering modifications.
