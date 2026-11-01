# SPACE EXSPACE — Frontend (PWA & Mobile-First UI)

Mobile-first Progressive Web Application (PWA) for field technicians, yard coordinators, and operations staff at **SPACE EXSPACE Company**.

Built with **React 18**, **TypeScript**, **Vite 6**, **vite-plugin-pwa (Workbox)**, and **IndexedDB (`idb`)**.

---

## Features

- **Field QR Scanner**: In-app camera scanner for rapid equipment check-in/out and yard moves.
- **Offline First**:
  - Application shell precached for instant loading even without cell coverage.
  - IndexedDB outbox queue holds equipment location moves and status updates while offline, syncing automatically with exponential backoff and jitter once connectivity is restored.
  - API responses are never cached by Service Worker to avoid displaying stale financial or booking data.
- **Role-Based Views**:
  - **Admin**: Full access to equipment, rate cards, active rentals, maintenance tickets, material inventory, and invoices.
  - **Staff**: Streamlined interface focusing on scanning, moves, and condition inspections with financial data masked.

---

## Quickstart

### 1. Install Dependencies
From the repository root or the `frontend` directory:
```bash
npm install
```

### 2. Run the Development Server
From the repository root:
```bash
npm run dev:frontend
```
Or from within `frontend/`:
```bash
npm run dev
```

The application will be accessible at:
```
http://localhost:5173
```

---

## API Proxy Configuration

During development, Vite proxies all requests starting with `/api` and `/health` directly to the backend Express server:

```typescript
// vite.config.ts
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    },
    '/health': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    },
  },
}
```

> [!NOTE]
> Ensure the backend API is running on `http://localhost:3000` (via `npm run dev:backend`) so that API requests succeed.

---

## Camera QR Scanning & HTTPS Security Context

Modern mobile and desktop browsers strictly enforce the **Secure Context** standard for media capture APIs (`navigator.mediaDevices.getUserMedia`):

1. **Localhost**: Browsers treat `http://localhost:5173` as a secure origin, allowing camera access during local desktop testing.
2. **Mobile Device Over LAN**: Accessing the dev server via local IP (e.g. `http://192.168.1.50:5173`) from a smartphone or tablet will **block** the camera with a security error.
3. **Field & Mobile Testing Options**:
   - Use Android Chrome Remote Debugging via USB (`chrome://inspect`) with port forwarding `5173 -> localhost:5173`.
   - Run the production Docker Compose stack (`docker-compose.prod.yml`) with Caddy for automatic HTTPS certificates.
   - Use a local HTTPS reverse proxy (such as `mkcert` or `cloudflared tunnel`).

---

## Building for Production

To create an optimized production build:
```bash
npm run build
```
This runs TypeScript validation (`tsc`) and compiles static assets into `frontend/dist/`.

In production, Caddy serves this directory statically and proxies `/api/*` to the backend on the same domain, eliminating CORS overhead.
