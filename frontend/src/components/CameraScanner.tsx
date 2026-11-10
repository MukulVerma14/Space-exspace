/**
 * CameraScanner — QR Code scanner component powered by native getUserMedia + jsQR (F-S6).
 *
 * SPECIFICATION (F-S6):
 * - Replaces html5-qrcode with custom native scanner pipeline
 * - Stream: getUserMedia with { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
 * - Attaches to <video playsInline muted autoPlay>, awaits metadata and play()
 * - Decode loop: requestAnimationFrame throttled to 5-8 fps (~140ms), offscreen canvas max 640px wide (willReadFrequently: true)
 * - jsQR decoding: ignores duplicate code for 3 seconds, vibrates 50ms on success if supported
 * - Lifecycle state machine: idle, starting, running, stopping
 *   - start() is idempotent
 *   - Retry cancels in-flight start and starts afresh
 *   - stop() stops every track, cancels RAF, clears srcObject
 *   - Safe under React StrictMode double mounts
 *   - Pauses on document visibility hidden, resumes on visible
 * - Watchdog: if no video frames arrive within 8 seconds, shows clear error with working Retry
 * - Uses cameraErrors.ts for user-friendly diagnostic mapping
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { ScannerEngine, ScannerLifecycleState } from '../utils/scannerEngine';
import { CameraDiagnosticInfo } from '../utils/cameraErrors';

export interface CameraScannerProps {
  onScan: (assetCode: string) => void;
  active: boolean;
  onToggleActive?: (active: boolean) => void;
  testPageUrl?: string;
}

export function CameraScanner({
  onScan,
  active,
  onToggleActive,
  testPageUrl = '/staff/camera-test',
}: CameraScannerProps) {
  const [engineState, setEngineState] = useState<ScannerLifecycleState>('idle');
  const [diagnosticError, setDiagnosticError] = useState<CameraDiagnosticInfo | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<ScannerEngine | null>(null);
  const pausedByVisibilityRef = useRef<boolean>(false);

  // Check browser mediaDevices support
  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  // Instantiate scanner engine once
  if (!engineRef.current && isSupported) {
    engineRef.current = new ScannerEngine({
      videoElement: null,
      onScan: (code: string) => {
        setLastScannedCode(code);
        onScan(code);
      },
      onError: (err: CameraDiagnosticInfo) => {
        setDiagnosticError(err);
      },
      onStateChange: (state: ScannerLifecycleState) => {
        setEngineState(state);
      },
    });
  }

  // Handle stream startup, teardown, and active prop toggling
  useEffect(() => {
    if (!isSupported) {
      setDiagnosticError({
        name: 'NotSupportedError',
        message: 'navigator.mediaDevices.getUserMedia is not available in this environment',
        hint: 'Camera access is not supported by your browser or environment. Please use manual asset-code entry below.',
      });
      return;
    }

    const engine = engineRef.current;
    if (!engine) return;

    if (videoRef.current) {
      engine.setVideoElement(videoRef.current);
    }

    if (active) {
      setDiagnosticError(null);
      engine.start();
    } else {
      engine.stop();
    }

    // Unmount cleanup: safe under React StrictMode double mounts
    return () => {
      engine.stop();
    };
  }, [active, isSupported]);

  // Page visibility listener: pause on hidden, resume on visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      const engine = engineRef.current;
      if (!engine) return;

      if (document.visibilityState === 'hidden') {
        const state = engine.getState();
        if (state === 'running' || state === 'starting') {
          pausedByVisibilityRef.current = true;
          engine.stop();
        }
      } else if (document.visibilityState === 'visible') {
        if (pausedByVisibilityRef.current && active) {
          pausedByVisibilityRef.current = false;
          engine.start();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [active]);

  const handleRetry = useCallback(() => {
    setDiagnosticError(null);
    if (onToggleActive) {
      onToggleActive(true);
    }
    if (engineRef.current) {
      if (videoRef.current) {
        engineRef.current.setVideoElement(videoRef.current);
      }
      engineRef.current.retry();
    }
  }, [onToggleActive]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: 420,
        margin: '0 auto',
      }}
    >
      {/* Viewfinder Card */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1 / 1',
          maxWidth: 380,
          minHeight: 280,
          background: '#1A1813',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          border: '2px solid var(--color-border)',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Direct native <video> element with playsInline muted autoPlay */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            visibility: engineState === 'running' ? 'visible' : 'hidden',
          }}
        />

        {/* Viewfinder crosshairs / targeting overlay when running */}
        {engineState === 'running' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: 240,
                height: 240,
                border: '2px solid rgba(200, 169, 111, 0.8)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
                position: 'relative',
              }}
            >
              {/* Corner accents */}
              <div
                style={{
                  position: 'absolute',
                  top: -2,
                  left: -2,
                  width: 24,
                  height: 24,
                  borderTop: '4px solid #C8A96F',
                  borderLeft: '4px solid #C8A96F',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  width: 24,
                  height: 24,
                  borderTop: '4px solid #C8A96F',
                  borderRight: '4px solid #C8A96F',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: -2,
                  left: -2,
                  width: 24,
                  height: 24,
                  borderBottom: '4px solid #C8A96F',
                  borderLeft: '4px solid #C8A96F',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: -2,
                  right: -2,
                  width: 24,
                  height: 24,
                  borderBottom: '4px solid #C8A96F',
                  borderRight: '4px solid #C8A96F',
                }}
              />
            </div>
          </div>
        )}

        {/* Starting / Initializing State */}
        {engineState === 'starting' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-3)',
              color: '#FFFFF0',
              padding: 'var(--space-4)',
              textAlign: 'center',
              zIndex: 2,
            }}
          >
            <div className="spinner spinner-lg" />
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-border)' }}>
              Starting camera (jsQR engine)…
            </div>
          </div>
        )}

        {/* Paused / Idle State */}
        {engineState === 'idle' && !diagnosticError && !active && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-3)',
              color: '#FFFFF0',
              padding: 'var(--space-4)',
              textAlign: 'center',
              zIndex: 2,
            }}
          >
            <div style={{ fontSize: 40 }}>📷</div>
            <div style={{ fontWeight: 600 }}>Camera Paused</div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-border-subtle)' }}>
              Stream stopped to save battery and performance.
            </p>
            {onToggleActive && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onToggleActive(true)}
                style={{ marginTop: 'var(--space-2)' }}
              >
                Resume Camera
              </button>
            )}
          </div>
        )}

        {/* Error / Watchdog Timeout State */}
        {diagnosticError && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-2)',
              color: '#FFFFF0',
              padding: 'var(--space-4)',
              textAlign: 'center',
              zIndex: 2,
              maxHeight: '100%',
              overflowY: 'auto',
            }}
          >
            <div style={{ fontSize: 32 }}>⚠️</div>
            <div
              style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 700,
                color: '#F87171',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                background: 'rgba(239, 68, 68, 0.15)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              {diagnosticError.name}
            </div>

            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                color: '#FCA5A5',
                background: 'rgba(0, 0, 0, 0.5)',
                padding: 'var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                maxWidth: '100%',
                wordBreak: 'break-word',
              }}
            >
              {diagnosticError.message}
            </div>

            <p
              style={{
                fontSize: 'var(--text-xs)',
                color: '#E5E7EB',
                lineHeight: 1.4,
                margin: 'var(--space-1) 0',
              }}
            >
              {diagnosticError.hint}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '100%', marginTop: 'var(--space-1)' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleRetry}
                style={{ fontSize: 'var(--text-xs)', width: '100%' }}
              >
                🔄 Retry Camera
              </button>

              <a
                href={testPageUrl}
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-primary)',
                  textDecoration: 'underline',
                  padding: '4px',
                }}
              >
                🔬 Try Raw getUserMedia Test Page →
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Control bar: Scanner toggle & Last Scanned indicator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          marginTop: 'var(--space-3)',
          padding: '0 var(--space-2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: engineState === 'running' ? 'var(--color-success)' : 'var(--color-text-subtle)',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {engineState === 'running'
              ? 'Aim at equipment QR tag'
              : !active
              ? 'Camera paused'
              : 'Manual entry available'}
          </span>
        </div>

        {onToggleActive && engineState === 'running' && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onToggleActive(false)}
            style={{ fontSize: 'var(--text-xs)', padding: '2px 8px' }}
          >
            Pause Camera
          </button>
        )}
      </div>

      {lastScannedCode && engineState === 'running' && (
        <div
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Last read: <strong>{lastScannedCode}</strong> (3s debounce active)
        </div>
      )}
    </div>
  );
}
