# ADR 019: Replacement of html5-qrcode with Custom Native getUserMedia Scanner and jsQR Engine

## Status
Accepted

## Context
During physical device validation and field testing of the QR Scan page (`/admin/scan` and `/staff/scan`), the camera subsystem exhibited severe operational instability when powered by the third-party `html5-qrcode` library:

1. **Deadlock Exception ("Cannot transition to a new state, already under transition")**:
   - On Android Chrome (Pixel, Samsung Galaxy) and laptop webcams, `html5-qrcode` repeatedly crashed with unhandled state exceptions:
     `Cannot transition to a new state, already under transition`
   - Once this error occurred, the internal finite state machine of `html5-qrcode` entered a permanent deadlock; subsequent calls to `stop()`, `clear()`, or `start()` (such as tapping the UI "Retry" button) hung indefinitely without ever opening the camera stream or recovering.
2. **Discrepancy with Minimal Test Page**:
   - In Step F-S5, we introduced a minimal fallback diagnostic page (`/staff/camera-test`) utilizing raw `navigator.mediaDevices.getUserMedia` attached directly to an HTML5 `<video playsInline muted autoPlay>` element.
   - On the exact same hardware, browsers, and permissions contexts where `html5-qrcode` crashed, the raw `getUserMedia` test page initialized instantly, delivered smooth 60fps video, and allowed rapid start/stop/toggle transitions with zero errors.
3. **Root Cause**:
   - `html5-qrcode` wraps WebRTC media streams, canvas creation, and barcode decoding in a complex, monolithic asynchronous state machine. Rapid React 18 lifecycle events (such as `StrictMode` double-mounts in development, component unmounts on tab switches, or user retries) collide with in-flight internal promise chains, locking the library in an unrecoverable state.

---

## Alternatives Considered

| Alternative | Pros | Cons / Reason for Rejection |
| :--- | :--- | :--- |
| **1. Pinning or Patching `html5-qrcode`** | Minimal code diff in the frontend component. | **Rejected.** The state machine flaw is deeply embedded across its internal promise chains and private class flags. Patching via `patch-package` introduces fragile vendor forks and ongoing maintenance liability without fixing the underlying architectural fragility. |
| **2. Native `BarcodeDetector` Web API** | Hardware accelerated, zero external bundle dependencies, native browser implementation. | **Rejected.** `BarcodeDetector` is **not supported on iOS Safari / WebKit** without experimental flags enabled in advanced settings, and is missing on multiple enterprise Android WebViews. Relying on it would break iOS technician devices in the field. |
| **3. `@zxing/browser`** | Feature-rich barcode and QR decoding suite with active maintenance. | **Rejected.** Heavy bundle footprint (~450KB minified), high CPU consumption, and documented memory leak issues during long-running video frame decoding loops on low-memory mobile handsets. |
| **4. Custom `getUserMedia` Scanner + `jsQR` Engine** | **Chosen.** Ultra-lightweight (~40KB), zero-DOM dependencies, fast pure-JavaScript QR matrix decoding, complete control over state machine and lifecycle. | **Accepted.** We own the lifecycle end-to-end. Furthermore, `jsQR` is already proven in our project—we use it in backend automated integration tests (`backend/src/__tests__/labels.test.ts`) to verify printed equipment label QR sheets. |

---

## Decisions

### 1. Dedicated Single Guarded Lifecycle State Machine (`ScannerEngine`)
We replaced `html5-qrcode` with our own lightweight `ScannerEngine` (`frontend/src/utils/scannerEngine.ts`), governed by a single explicit 4-state lifecycle:
```
           +---------------- start() ----------------+
           |                                         |
           v                                         |
       [ starting ] --------> [ running ]            |
           |                      |                  |
   error / |                      | stop() / pause   |
   watchdog|                      v                  |
           +----------------> [ stopping ]           |
                                  |                  |
                                  v                  |
                               [ idle ] <------------+
```

Key lifecycle guarantees:
- **Idempotency**: Calling `start()` while in `'running'` or `'starting'` is a no-op that reuses the current session.
- **Cancelable Startup & StrictMode Safety**: Every start invocation increments a monotonic `sessionId`. If `stop()` or `retry()` is called while `navigator.mediaDevices.getUserMedia(...)` is pending, the returning media stream is immediately aborted (`track.stop()`) and discarded without ever touching the `<video>` element. This completely immunizes the scanner against React 18 `StrictMode` double-mount hardware locks.
- **Cancelable Retry**: Calling `retry()` cancels any in-flight startup and immediately re-initializes hardware capture cleanly.
- **Visibility-Aware Throttling**: Listens to `document.visibilitychange`. When the user switches tabs or backgrounds the PWA, camera tracks are immediately stopped to conserve mobile battery; when the tab becomes visible again, the camera cleanly resumes.

### 2. Standardized Media Constraints & Video Binding
- Stream constraints request environmental camera with balanced resolution:
  ```ts
  {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  }
  ```
- If ideal environmental constraints fail (e.g. single-camera desktop workstations or laptops), the engine automatically falls back to `{ video: true, audio: false }`.
- Bound directly to `<video playsInline muted autoPlay>`, awaiting metadata readiness and `video.play()` before entering `'running'`.

### 3. Throttled Offscreen Canvas Decode Loop with `jsQR`
- The decoding loop runs on `requestAnimationFrame` throttled to **5–8 frames per second** (~140ms interval), preventing mobile CPU throttling and thermal buildup.
- Frames are drawn to an offscreen canvas dynamically scaled down to **maximum 640px wide** (`willReadFrequently: true` enabled) preserving aspect ratio.
- Extracted `ImageData` is passed to pure `decodeFrame()` powered by `jsQR`.
- **Deduplication Cooldown**: Ignores identical decoded asset codes for **3 seconds (3,000 ms)** after a successful read.
- **Haptic Feedback**: Triggers a brief 50ms pulse (`navigator.vibrate(50)`) upon successful recognition on supported mobile browsers.

### 4. 8-Second Frame Watchdog
- If `getUserMedia` succeeds and starts the video pipeline, but no video frames actually arrive within **8 seconds** (due to frozen camera drivers or browser video pipeline stalls), an internal watchdog cancels the stream, transitions to `'idle'`, and raises a `WatchdogTimeoutError`.
- The user is presented with a clear diagnostic card with actionable hints and a working `Retry Camera` button that invokes `engine.retry()`.

### 5. Native Hardware Enumeration for Diagnostics
- Removed `Html5Qrcode.getCameras()`.
- The dev-only `?debug=1` inspection panel now queries `navigator.mediaDevices.enumerateDevices()` filtered by `kind === 'videoinput'`, rendering real hardware IDs, labels, and secure context status without third-party dependencies.

---

## Consequences

### Positive
- **Elimination of Deadlocks**: Completely eradicated the "Cannot transition to a new state" crash and Retry button freezes.
- **Bundle Size Reduction**: Removing `html5-qrcode` dropped the production client bundle from **780 kB down to 577 kB** (~200 kB / 26% reduction).
- **Uniform QR Stack**: Both frontend camera scanning and backend integration testing now share the exact same battle-tested `jsQR` decoding algorithms.
- **Superior Diagnostic Visibility**: 8-second watchdog timer guarantees that frozen camera feeds fail fast with clear plain-language recovery options instead of spinning indefinitely.
- **Battery & Performance Efficiency**: 5–8 fps throttling and background visibility pausing drastically reduce power consumption in hot outdoor yard environments.

### Negative / Trade-Offs
- We maintain the scanning loop, canvas scaling, and WebRTC lifecycle code in-house rather than delegating to an external wrapper. Given that the entire implementation is under 350 lines of clean, testable TypeScript, this is a net positive for long-term platform stability.
