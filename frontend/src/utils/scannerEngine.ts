/**
 * ScannerEngine — Native getUserMedia + jsQR scanner state machine (F-S6).
 *
 * SPECIFICATION:
 * - Single guarded lifecycle state machine: 'idle' | 'starting' | 'running' | 'stopping'
 * - Constraints: { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
 * - Attaches to <video playsInline muted autoPlay>, awaits metadata and play()
 * - Decode loop: requestAnimationFrame throttled to 5-8 fps (~140ms interval)
 * - Offscreen canvas scaled to max 640px wide (willReadFrequently: true)
 * - Run jsQR, ignore same code for 3,000 ms, brief vibration (50ms) on success
 * - Idempotent start(): if running or already starting with current session, returns
 * - Cancelable retry(): cancels in-flight start and starts afresh
 * - Clean stop(): stops every track, cancels RAF, clears srcObject, clears timers
 * - 8-second watchdog: triggers WatchdogTimeoutError if no video frames arrive
 */

import { decodeFrame, computeScaledDimensions } from './qrDecoder';
import { parseCameraError, CameraDiagnosticInfo } from './cameraErrors';

export type ScannerLifecycleState = 'idle' | 'starting' | 'running' | 'stopping';

export interface ScannerEngineConfig {
  videoElement: HTMLVideoElement | null;
  onScan: (assetCode: string) => void;
  onError: (diagnostic: CameraDiagnosticInfo) => void;
  onStateChange?: (state: ScannerLifecycleState) => void;
  maxCanvasWidth?: number;
  throttleIntervalMs?: number;
  scanCooldownMs?: number;
  watchdogTimeoutMs?: number;
}

export const DEFAULT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

export const FALLBACK_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: true,
  audio: false,
};

export class ScannerEngine {
  private state: ScannerLifecycleState = 'idle';
  private videoElement: HTMLVideoElement | null = null;
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private canvasContext: CanvasRenderingContext2D | null = null;

  private onScan: (assetCode: string) => void;
  private onError: (diagnostic: CameraDiagnosticInfo) => void;
  private onStateChange?: (state: ScannerLifecycleState) => void;

  private maxCanvasWidth: number;
  private throttleIntervalMs: number;
  private scanCooldownMs: number;
  private watchdogTimeoutMs: number;

  private activeStream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  private sessionId = 0;
  private lastDecodeTime = 0;
  private lastScannedCode: string | null = null;
  private lastScannedTime = 0;
  private hasReceivedFrame = false;

  constructor(config: ScannerEngineConfig) {
    this.videoElement = config.videoElement;
    this.onScan = config.onScan;
    this.onError = config.onError;
    this.onStateChange = config.onStateChange;

    this.maxCanvasWidth = config.maxCanvasWidth ?? 640;
    this.throttleIntervalMs = config.throttleIntervalMs ?? 140; // ~7 fps
    this.scanCooldownMs = config.scanCooldownMs ?? 3000;
    this.watchdogTimeoutMs = config.watchdogTimeoutMs ?? 8000;
  }

  public getState(): ScannerLifecycleState {
    return this.state;
  }

  public setVideoElement(video: HTMLVideoElement | null) {
    this.videoElement = video;
  }

  private setState(newState: ScannerLifecycleState) {
    this.state = newState;
    this.onStateChange?.(newState);
  }

  private clearWatchdog() {
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Starts the camera scanner.
   * Idempotent: If already running or a start with the active session is in flight, does nothing.
   */
  public async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      return;
    }

    const currentSession = ++this.sessionId;
    this.setState('starting');
    this.hasReceivedFrame = false;
    this.clearWatchdog();

    // Start 8-second watchdog timer
    this.watchdogTimer = setTimeout(() => {
      if (this.sessionId !== currentSession) return;
      if (!this.hasReceivedFrame) {
        console.warn('[ScannerEngine] Watchdog timed out: no video frames received within 8 seconds.');
        this.stop();
        const diag = parseCameraError(
          'WatchdogTimeoutError: Camera stream was established but delivered no video frames within 8 seconds.'
        );
        this.onError(diag);
      }
    }, this.watchdogTimeoutMs);

    try {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        throw new Error('NotSupportedError: navigator.mediaDevices.getUserMedia is not available.');
      }

      // Request media stream with ideal environmental constraint
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(DEFAULT_CAMERA_CONSTRAINTS);
      } catch (err: unknown) {
        // Fall back to generic video if ideal constraints failed
        if (
          err instanceof Error &&
          (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError')
        ) {
          console.warn('[ScannerEngine] Environmental constraints unsatisfied. Retrying with fallback video constraints.');
          stream = await navigator.mediaDevices.getUserMedia(FALLBACK_CAMERA_CONSTRAINTS);
        } else {
          throw err;
        }
      }

      // Check if start was canceled while awaiting getUserMedia
      if (this.sessionId !== currentSession) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.activeStream = stream;

      const video = this.videoElement;
      if (!video) {
        throw new Error('NotFoundError: Video DOM element is not mounted.');
      }

      video.srcObject = stream;

      // Await metadata and play()
      if (video.readyState < 1) {
        await new Promise<void>((resolve) => {
          const onLoaded = () => {
            video.removeEventListener('loadedmetadata', onLoaded);
            resolve();
          };
          video.addEventListener('loadedmetadata', onLoaded);
        });
      }

      if (this.sessionId !== currentSession) {
        this.cleanupStream();
        return;
      }

      try {
        await video.play();
      } catch (playErr) {
        // Ignore AbortError if session changed
        if (this.sessionId !== currentSession) {
          this.cleanupStream();
          return;
        }
        throw playErr;
      }

      if (this.sessionId !== currentSession) {
        this.cleanupStream();
        return;
      }

      this.setState('running');
      this.lastDecodeTime = 0;
      this.scheduleNextFrame(currentSession);
    } catch (err) {
      if (this.sessionId !== currentSession) {
        return;
      }
      this.stop();
      const diag = parseCameraError(err);
      this.onError(diag);
    }
  }

  /**
   * Cancels any in-flight startup or running stream and starts again cleanly.
   */
  public async retry(): Promise<void> {
    this.stop();
    await this.start();
  }

  /**
   * Stops the camera stream, cancels animation frames, clears srcObject and resets to 'idle'.
   */
  public stop(): void {
    if (this.state === 'idle') {
      return;
    }

    this.setState('stopping');
    // Invalidate any in-flight start sequence or RAF loop
    this.sessionId++;
    this.clearWatchdog();

    if (this.animationFrameId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.animationFrameId);
      }
      this.animationFrameId = null;
    }

    this.cleanupStream();

    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    this.setState('idle');
  }

  private cleanupStream(): void {
    if (this.activeStream) {
      this.activeStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      this.activeStream = null;
    }
  }

  private scheduleNextFrame(session: number) {
    if (this.sessionId !== session || this.state !== 'running') {
      return;
    }

    if (typeof requestAnimationFrame === 'function') {
      this.animationFrameId = requestAnimationFrame(() => {
        this.decodeLoop(session);
      });
    }
  }

  private decodeLoop(session: number) {
    if (this.sessionId !== session || this.state !== 'running') {
      return;
    }

    const video = this.videoElement;
    if (!video) {
      this.scheduleNextFrame(session);
      return;
    }

    // Check if video is receiving frames
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      if (!this.hasReceivedFrame) {
        this.hasReceivedFrame = true;
        this.clearWatchdog();
      }

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - this.lastDecodeTime >= this.throttleIntervalMs) {
        this.lastDecodeTime = now;
        this.processCurrentFrame(video);
      }
    }

    this.scheduleNextFrame(session);
  }

  private processCurrentFrame(video: HTMLVideoElement) {
    try {
      const { width, height } = computeScaledDimensions(
        video.videoWidth,
        video.videoHeight,
        this.maxCanvasWidth
      );

      if (width <= 0 || height <= 0) return;

      if (!this.offscreenCanvas && typeof document !== 'undefined') {
        this.offscreenCanvas = document.createElement('canvas');
      }

      if (!this.offscreenCanvas) return;

      if (this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
        this.offscreenCanvas.width = width;
        this.offscreenCanvas.height = height;
      }

      if (!this.canvasContext) {
        this.canvasContext = this.offscreenCanvas.getContext('2d', {
          willReadFrequently: true,
        });
      }

      if (!this.canvasContext) return;

      this.canvasContext.drawImage(video, 0, 0, width, height);
      const imageData = this.canvasContext.getImageData(0, 0, width, height);

      const code = decodeFrame(imageData);
      if (code) {
        this.handleDecodedCode(code);
      }
    } catch (err) {
      console.warn('[ScannerEngine] Frame processing error:', err);
    }
  }

  private handleDecodedCode(code: string) {
    const clean = code.trim();
    if (!clean) return;

    const now = Date.now();
    // 3-second cooldown on identical code
    if (
      this.lastScannedCode?.toLowerCase() === clean.toLowerCase() &&
      now - this.lastScannedTime < this.scanCooldownMs
    ) {
      return;
    }

    this.lastScannedCode = clean;
    this.lastScannedTime = now;

    // Vibrate briefly on success if supported (50ms)
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(50);
      } catch (_) {}
    }

    this.onScan(clean);
  }
}
