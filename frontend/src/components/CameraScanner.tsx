/**
 * CameraScanner — QR Code scanner component powered by html5-qrcode.
 *
 * SPECIFICATION (F-S1 & F-S5):
 * - Frame rate: limited to ~5 frames per second (fps: 5)
 * - Cooldown: ignores the same decoded asset code for 3 seconds (3,000 ms) after a read
 * - Lifecycle: reliably stops the camera stream on unmount or pause
 * - Constraints: facingMode "environment" as ideal constraint (not exact), falling back to getCameras()[0]
 * - Mount guard: container is mounted and has non-zero size before start(); guards against React StrictMode double mounts
 * - Diagnosis: logs exact error to console and displays error name, message, and plain-language hint on screen
 */

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { parseCameraError, CameraDiagnosticInfo } from '../utils/cameraErrors';

export interface CameraScannerProps {
  onScan: (assetCode: string) => void;
  active: boolean;
  onToggleActive?: (active: boolean) => void;
  testPageUrl?: string;
}

export type ScannerStatus = 'initializing' | 'scanning' | 'paused' | 'error' | 'unsupported';

const READER_ELEMENT_ID = 'sx-qr-reader';
const SCAN_COOLDOWN_MS = 3000;
const SCAN_FPS = 5;

export function CameraScanner({
  onScan,
  active,
  onToggleActive,
  testPageUrl = '/staff/camera-test',
}: CameraScannerProps) {
  const [status, setStatus] = useState<ScannerStatus>('initializing');
  const [diagnosticError, setDiagnosticError] = useState<CameraDiagnosticInfo | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastScannedCodeRef = useRef<string | null>(null);
  const lastScannedTimeRef = useRef<number>(0);
  const mountIdRef = useRef<number>(0);

  // Check browser mediaDevices support
  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  useEffect(() => {
    if (!isSupported) {
      setStatus('unsupported');
      setDiagnosticError({
        name: 'NotSupportedError',
        message: 'navigator.mediaDevices.getUserMedia is not available in this environment',
        hint: 'Camera access is not supported by your browser or environment. Please use manual asset-code entry below.',
      });
      return;
    }

    if (!active) {
      setStatus('paused');
      return;
    }

    const currentMountId = ++mountIdRef.current;
    let isCancelled = false;

    setStatus('initializing');
    setDiagnosticError(null);

    async function initScanner() {
      // 1. Guard against React StrictMode double mount: stop & clear any previous instance
      if (scannerRef.current) {
        const oldInstance = scannerRef.current;
        scannerRef.current = null;
        try {
          if (oldInstance.isScanning) {
            await oldInstance.stop();
          }
        } catch (stopErr) {
          console.warn('[CameraScanner] Teardown stop error:', stopErr);
        }
        try {
          oldInstance.clear();
        } catch (clearErr) {
          console.warn('[CameraScanner] Teardown clear error:', clearErr);
        }
      }

      // Check if unmounted while awaiting previous teardown
      if (isCancelled || mountIdRef.current !== currentMountId) {
        return;
      }

      // 2. Ensure container element exists and has non-zero size before start()
      if (!containerRef.current) {
        await new Promise((r) => requestAnimationFrame(r));
      }

      if (isCancelled || mountIdRef.current !== currentMountId) {
        return;
      }

      const containerEl = document.getElementById(READER_ELEMENT_ID);
      if (!containerEl) {
        console.error('[CameraScanner] Target DOM container element missing:', READER_ELEMENT_ID);
        return;
      }

      const html5Qr = new Html5Qrcode(READER_ELEMENT_ID);
      scannerRef.current = html5Qr;

      const config = {
        fps: SCAN_FPS,
        qrbox: { width: 240, height: 240 },
        aspectRatio: 1.0,
      };

      const handleScanSuccess = (decodedText: string) => {
        if (isCancelled || mountIdRef.current !== currentMountId) return;
        const cleanText = decodedText.trim();
        if (!cleanText) return;

        const now = Date.now();
        // Ignore repeat reads of identical asset code within 3 seconds
        if (
          cleanText.toLowerCase() === lastScannedCodeRef.current?.toLowerCase() &&
          now - lastScannedTimeRef.current < SCAN_COOLDOWN_MS
        ) {
          return;
        }

        lastScannedCodeRef.current = cleanText;
        lastScannedTimeRef.current = now;
        setLastScannedCode(cleanText);

        onScan(cleanText);
      };

      try {
        // 3. Use facingMode "environment" as ideal constraint (not exact)
        try {
          await html5Qr.start(
            { facingMode: { ideal: 'environment' } },
            config,
            handleScanSuccess,
            () => {
              // Normal frame misses; silently ignore
            }
          );
        } catch (idealFacingErr: unknown) {
          console.warn(
            '[CameraScanner] facingMode { ideal: "environment" } start failed, attempting getCameras() fallback:',
            idealFacingErr
          );

          // Fallback to the first available camera from getCameras()
          const cameras = await Html5Qrcode.getCameras().catch(() => []);
          if (cameras && cameras.length > 0) {
            console.info('[CameraScanner] Falling back to camera device ID:', cameras[0].id, cameras[0].label);
            await html5Qr.start(
              cameras[0].id,
              config,
              handleScanSuccess,
              () => {}
            );
          } else {
            // No camera fallback available; rethrow initial error for diagnostic reporting
            throw idealFacingErr;
          }
        }

        if (isCancelled || mountIdRef.current !== currentMountId) {
          // Unmounted while start() was in flight
          try {
            if (html5Qr.isScanning) {
              await html5Qr.stop();
            }
          } catch {
            // Ignore
          }
          try {
            html5Qr.clear();
          } catch {
            // Ignore
          }
          return;
        }

        setStatus('scanning');
      } catch (err: unknown) {
        if (isCancelled || mountIdRef.current !== currentMountId) return;

        // Log exact error name and message to console
        console.error('[CameraScanner] Failed to start camera stream:', err);

        const diagnostic = parseCameraError(err);
        setDiagnosticError(diagnostic);
        setStatus('error');
      }
    }

    initScanner();

    return () => {
      isCancelled = true;
      const instance = scannerRef.current;
      scannerRef.current = null;
      if (instance) {
        if (instance.isScanning) {
          instance
            .stop()
            .catch(() => {})
            .finally(() => {
              try {
                instance.clear();
              } catch {
                // Ignore clear error during unmount
              }
            });
        } else {
          try {
            instance.clear();
          } catch {
            // Ignore
          }
        }
      }
    };
  }, [active, isSupported, onScan]);

  function handleRetry() {
    setStatus('initializing');
    setDiagnosticError(null);
    if (onToggleActive) {
      onToggleActive(true);
    }
  }

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
        {/* html5-qrcode camera stream container: NEVER display:none so clientWidth/clientHeight are always > 0 */}
        <div
          id={READER_ELEMENT_ID}
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            visibility: status === 'scanning' ? 'visible' : 'hidden',
          }}
        />

        {/* Viewfinder crosshairs / targeting overlay when scanning */}
        {status === 'scanning' && (
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

        {/* Initializing State */}
        {status === 'initializing' && (
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
              Starting camera (5 fps)…
            </div>
          </div>
        )}

        {/* Paused State */}
        {status === 'paused' && (
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

        {/* Error / Permission Denied State */}
        {(status === 'error' || status === 'unsupported') && diagnosticError && (
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
              {status === 'error' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleRetry}
                  style={{ fontSize: 'var(--text-xs)', width: '100%' }}
                >
                  🔄 Retry Camera
                </button>
              )}

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
              backgroundColor: status === 'scanning' ? 'var(--color-success)' : 'var(--color-text-subtle)',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {status === 'scanning'
              ? 'Aim at equipment QR tag'
              : status === 'paused'
              ? 'Camera paused'
              : 'Manual entry available'}
          </span>
        </div>

        {onToggleActive && status === 'scanning' && (
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

      {lastScannedCode && status === 'scanning' && (
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
