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
