# Camera Debugging, Diagnostics & Repair Workflow Report (F-S5 & F-S6)

**Date**: 2026-11-10  
**Scope**: Camera QR scanner stability, permissions policy, runtime hardware failure diagnostics, raw `getUserMedia` test harness, html5-qrcode state transition deadlock resolution, and native jsQR scanner replacement.  
**Author**: Antigravity Assistant  

---

## 1. Executive Summary

During mobile and desktop operational testing of the Scan Page (`/admin/scan` and `/staff/scan`), two primary classes of issues were identified and addressed:

1. **Camera Initialization & Lifecycle Instability**:
   - Camera failed to stream reliably on various devices, occasionally failing silently without presenting actionable diagnostic feedback to technicians in the field.
   - On desktop workstations and laptops with only a front-facing webcam, the camera initialization failed immediately.
   - React 18 development mode (`StrictMode`) caused rapid double-mount collisions resulting in hardware locks (`NotReadableError`).
   - The scanner DOM element had `0x0` dimensions at the instant `Html5Qrcode.start()` was invoked, causing canvas rendering failures.
   - **Critical html5-qrcode Deadlock (F-S6)**: On Android Chrome and laptop webcams, `html5-qrcode` threw `"Cannot transition to a new state, already under transition"` and caused the Retry button to hang indefinitely, even though the raw `getUserMedia` test page worked flawlessly.

2. **Maintenance Record Creation Bug ("Send to Repair")**:
   - Dispatching equipment via "Send to Repair" in `EquipmentDetailPage.tsx` inadvertently produced a maintenance record with `kind = 'modification'` instead of `'repair'`.
   - The user had no interactive control to distinguish genuine maintenance overhauls/repairs from vehicle/equipment engineering modifications.

This document details the root causes identified, architectural fixes implemented across frontend and backend services, the diagnostic inspection tools introduced (`?debug=1` panel and minimal fallback camera test page), the replacement of `html5-qrcode` with our native `getUserMedia` + `jsQR` engine (ADR 019), and automated test coverage.

---

## 2. Root Cause Analysis: Camera & QR Scanner

### 2.1 Scanner Container Zero-Dimension Bug (`0x0` Box)
- **Symptom**: `html5-qrcode` library threw internal geometry calculation errors or rendered blank viewfinders on initial mount.
- **Root Cause**: In `frontend/src/components/CameraScanner.tsx`, the scanner container `<div id="sx-qr-reader">` used inline CSS:
  ```tsx
  display: status === 'scanning' ? 'block' : 'none'
  ```
  Because `status` begins as `'initializing'`, the element had `display: none` (`clientWidth = 0`, `clientHeight = 0`) when `scanner.start(...)` was executed. The underlying video canvas could not compute aspect ratios against an unrendered DOM node.
- **Fix**: Replaced `display: none` with persistent absolute framing and CSS visibility toggling:
  ```css
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  visibility: status === 'scanning' ? 'visible' : 'hidden';
  ```
  This guarantees non-zero layout geometry during the initialization handshake while keeping the UI clean until the video feed is live.

### 2.2 Exact vs Ideal `facingMode` Constraints (`OverconstrainedError`)
- **Symptom**: `OverconstrainedError: Constraints could not be satisfied` was thrown on development laptops, desktop workstations, and tablets with only a single front-facing camera.
- **Root Cause**: The scanner passed `{ facingMode: 'environment' }` directly. Standard WebRTC semantics interpret a string constraint as an exact requirement. If no physical back camera exists, `navigator.mediaDevices.getUserMedia` rejects the request.
- **Fix**:
  1. Updated the primary constraint to use `{ facingMode: { ideal: 'environment' } }`.
  2. Wrapped device selection in an automatic fallback: if device selection fails, query `Html5Qrcode.getCameras()` and bind to the first available physical camera ID (`cameras[0].id`).

### 2.3 React 18 StrictMode Double-Mount Hardware Collision (`NotReadableError`)
- **Symptom**: In development mode, the camera stream frequently failed with `NotReadableError: Could not start video source` or `Device in use`.
- **Root Cause**: React 18 StrictMode mounts, immediately unmounts, and remounts components. Because stopping a media track is asynchronous, the second mount called `start()` before the first mount completed `stop()`, creating a concurrent lock on the OS camera handle.
- **Fix**:
  - Implemented an incremental `mountIdRef` and `unmountedRef` guard in `CameraScanner.tsx`.
  - Implemented `stopAndClear()` which safely awaits `scannerRef.current.stop()` before allowing any subsequent `start()` sequence.
  - Added full cleanup on unmount.

### 2.4 Browser Security Context & Response Headers
- **Requirement**: `navigator.mediaDevices.getUserMedia` requires a **Secure Context** (`window.isSecureContext === true`: `https://` or `http://localhost`). Additionally, modern browsers block camera access if prohibited by `Permissions-Policy`.
- **Response Headers Verified & Configured**:
  - **Vite Preview / Dev Server** (`frontend/vite.config.ts`):
    ```ts
    server: {
      headers: { 'Permissions-Policy': 'camera=(self)' },
    },
    preview: {
      headers: { 'Permissions-Policy': 'camera=(self)' },
    }
    ```
  - **Express API** (`backend/src/app.ts`):
    Added middleware injecting `Permissions-Policy: camera=(self)`.
  - **Caddy Reverse Proxy** (`Caddyfile`):
    Verified header `Permissions-Policy "camera=(self)"` is active on production endpoints.

---

## 3. Diagnostic & Inspection Tools

### 3.1 Plain-Language Error Translation (`parseCameraError`)
A dedicated diagnostic parser was created at [`frontend/src/utils/cameraErrors.ts`](file:///D:/IdeaProjects/Space%20Exspace/frontend/src/utils/cameraErrors.ts):

| Error Name | Technical Cause | Plain-Language UI Hint |
|---|---|---|
| `NotAllowedError` | Camera permission rejected or revoked by user / OS. | *"Camera permission was denied. Please allow camera access in your browser settings (URL bar lock icon) and refresh."* |
| `NotFoundError` | No video input hardware detected on system. | *"No physical camera was detected. Please plug in a webcam or switch to manual asset code entry."* |
| `NotReadableError` | Hardware stream busy, locked, or OS driver crash. | *"Camera is already in use by another application (e.g. Teams, Zoom, or another tab). Close other apps and retry."* |
| `OverconstrainedError` | Device does not meet ideal camera parameters. | *"The requested camera constraints could not be satisfied. Retrying with default camera..."* |
| `SecurityError` | Insecure context (HTTP) or disallowed iframe origin. | *"Camera access requires a secure context (HTTPS or localhost) and Permissions-Policy permissions."* |
| `WatchdogTimeoutError` | Camera stream started but delivered no video frames within 8 seconds. | *"The camera stream was established but delivered no video frames within 8 seconds. Please click Retry or use manual entry below."* |

The UI displays an informative alert card showing the exact error name, message, troubleshooting hint, a working "Retry Camera" button, and a link to the raw test page.

### 3.2 Dev-Only Inspection Panel (`?debug=1`)
Appending `?debug=1` to the Scan page URL (`/admin/scan?debug=1` or `/staff/scan?debug=1`) mounts a real-time debugging HUD displaying:
- `Secure Context (window.isSecureContext)`: `true` / `false`
- `Browser User Agent`: Full string
- `Available Cameras`: Array of enumerated hardware devices (`deviceId`, `label`) from native `navigator.mediaDevices.enumerateDevices()`
- Fallback shortcut to `/admin/camera-test` or `/staff/camera-test`.

### 3.3 Raw `getUserMedia` Minimal Fallback Test Page
Created [`frontend/src/pages/shared/CameraTestPage.tsx`](file:///D:/IdeaProjects/Space%20Exspace/frontend/src/pages/shared/CameraTestPage.tsx), mounted at `/admin/camera-test` and `/staff/camera-test`:
- Uses direct browser API: `navigator.mediaDevices.getUserMedia({ video: { facingMode: mode } })`.
- Renders minimal `<video playsInline muted autoPlay>` without any third-party library wrappers.
- Displays live track metrics: `track.label`, `readyState`, `aspectRatio`, `width`, `height`.
- Allows toggling between Environment and User facing modes.
- **Purpose**: Instantly distinguishes whether camera failure stems from OS/browser permissions vs third-party scanning library wrappers.

---

## 4. Root Cause & Resolution: "Send to Repair" Maintenance Kind

### 4.1 Bug Root Cause
In `frontend/src/pages/shared/EquipmentDetailPage.tsx`:
1. The maintenance creation modal did not provide a dropdown selector to choose between `kind: 'repair'` and `kind: 'modification'`, defaulting to hardcoded or untracked state.
2. The modal state did not reset `repairKind` on close/open cycles, causing unintended values to persist across submissions.
3. In `backend/src/controllers/equipmentController.ts`, `recordMaintenance()` executed `INSERT INTO maintenance (..., kind, ...)`, but the response JSON did not surface the created maintenance record properties to the client for confirmation.

### 4.2 Fix Implementation
1. **Frontend Form**:
   - Added interactive `<select id="repair-kind">` with options:
     - `repair` ("Repair / Overhaul (Default)")
     - `modification` ("Engineering Modification")
   - Reset `repairKind` to `'repair'` on modal initialization and form submission.
   - Enqueued outbox event `equipment_repair` with explicit `kind: repairKind`.
2. **Backend Controller**:
   - `recordMaintenance()` now returns `{ message, equipment: { ... }, maintenance: { id, kind, description } }`.
3. **Database & API Tests**:
   - Backend test (`backend/src/__tests__/equipment.test.ts`):
     - Confirms default repair dispatch sets `kind: 'repair'`.
     - Confirms explicit `{ kind: 'modification' }` payload writes `kind = 'modification'` into `maintenance` table.
   - Frontend test (`frontend/src/__tests__/equipmentDetail.test.ts`):
     - Confirms `enqueueEvent` captures `payload.kind: 'modification'` when selected in the modal.

---

## 5. Root Cause Analysis: html5-qrcode Deadlock & Native jsQR Replacement (F-S6)

### 5.1 The html5-qrcode Deadlock Symptom
During live testing on Android Chrome and laptop webcams:
- The scanner frequently failed with unhandled exception:
  `Cannot transition to a new state, already under transition`
- Subsequent clicks on the "Retry" button hung indefinitely without starting the camera or updating UI status.
- Crucially, on the exact same physical devices and browser sessions, the minimal test page using raw `navigator.mediaDevices.getUserMedia` worked instantly without error.

### 5.2 Root Cause
`html5-qrcode` implements a monolithic internal state machine that attempts to sequence WebRTC stream acquisition, canvas creation, and barcode decoding using private flags and un-cancelable promise chains. When React 18 mounts, unmounts, and remounts components (or when a user taps "Retry" while a startup attempt is still resolving), `html5-qrcode` attempts concurrent state transitions that trigger its internal invariant assertion (`Cannot transition to a new state, already under transition`). The library enters a permanent deadlock, refusing all subsequent `start()`, `stop()`, or `clear()` calls.

### 5.3 Architectural Resolution (ADR 019)
We completely uninstalled `html5-qrcode` and built our own native, robust scanner architecture:
1. **Lightweight Engine (`ScannerEngine`)**:
   - Explicit 4-state lifecycle machine: `idle`, `starting`, `running`, `stopping`.
   - `start()` is fully idempotent.
   - `sessionId` token guards every asynchronous boundary (`getUserMedia`, `loadedmetadata`, `play()`).
   - If `retry()` or `stop()` is called while `getUserMedia` is resolving, the in-flight session is canceled and tracks are stopped immediately upon resolution.
   - Pauses on `document.visibilityState === 'hidden'` and resumes on `visible`.
2. **Decode Pipeline (`qrDecoder`)**:
   - Direct `<video playsInline muted autoPlay>` element binding.
   - `requestAnimationFrame` loop throttled to 5–8 fps (~140ms interval).
   - Offscreen canvas dynamically downscaled to maximum 640px wide (`willReadFrequently: true`).
   - Pure QR decoding with `jsQR` (~40KB, zero DOM dependencies).
   - 3-second deduplication cooldown on identical codes.
   - 50ms haptic vibration pulse (`navigator.vibrate(50)`) on successful recognition.
3. **8-Second Watchdog Timer**:
   - If the camera stream starts but no video frames arrive within 8 seconds, `WatchdogTimeoutError` is raised with a working Retry button.
4. **Native Hardware Diagnostics**:
   - Replaced `Html5Qrcode.getCameras()` with native `navigator.mediaDevices.enumerateDevices()`.

---

## 6. Automated Test Suite Results

1. **Frontend Vitest Suites**:
   - `clock.test.ts` (5 passed)
   - `syncClient.test.ts` (5 passed)
   - `equipmentSource.test.ts` (13 passed)
   - `invoicesSource.test.ts` (15 passed)
   - `dashboardSource.test.ts` (8 passed)
   - `equipmentDetail.test.ts` (15 passed) — includes repair vs modification outbox assertions.
   - `materialsSource.test.ts` (11 passed)
   - `scan.test.ts` (27 passed):
     - Pure `decodeFrame()` against real QR PNGs generated via `qrcode` and read via `pngjs`
     - Scaled canvas dimension calculations
     - `ScannerEngine` state machine tests: start twice (idempotent), stop while starting, retry while starting, unmount cleanup, and 8s watchdog timeout
     - 3-second debounce cooldown
     - `parseCameraError` diagnostics for all WebRTC errors
   - **Total Frontend**: **8 suites, 99 passed, 0 failed**.
   - **Client Build**: Clean Vite production build (bundle size dropped from 780 kB to 577 kB).

2. **Backend Vitest Suites**:
   - Verified against live PostgreSQL 18 instance on port 5433.
   - **Total Backend**: **11 suites, 163 passed, 0 failed**.
