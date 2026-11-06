/**
 * CameraScanner — QR Code scanner component powered by html5-qrcode.
 *
 * SPECIFICATION (F-S1):
 * - Frame rate: limited to ~5 frames per second (fps: 5)
 * - Cooldown: ignores the same decoded asset code for 3 seconds (3,000 ms) after a read
 * - Lifecycle: reliably stops the camera stream on unmount or pause
 * - Resilience: detects unsupported browsers and handles permission-denied gracefully
 */

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export interface CameraScannerProps {
  onScan: (assetCode: string) => void;
  active: boolean;
  onToggleActive?: (active: boolean) => void;
}

export type ScannerStatus = 'initializing' | 'scanning' | 'paused' | 'error' | 'unsupported';

const READER_ELEMENT_ID = 'sx-qr-reader';
const SCAN_COOLDOWN_MS = 3000;
const SCAN_FPS = 5;

export function CameraScanner({ onScan, active, onToggleActive }: CameraScannerProps) {
  const [status, setStatus] = useState<ScannerStatus>('initializing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScannedCodeRef = useRef<string | null>(null);
  const lastScannedTimeRef = useRef<number>(0);
  const isStoppingRef = useRef<boolean>(false);

  // Check browser mediaDevices support
  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  useEffect(() => {
    if (!isSupported) {
      setStatus('unsupported');
      setErrorMessage(
        'Camera access is not supported by your browser or environment. Please use manual asset-code entry below.'
      );
      return;
    }

    if (!active) {
      setStatus('paused');
      return;
    }

    let isMounted = true;
    isStoppingRef.current = false;
    setStatus('initializing');
    setErrorMessage(null);

    const html5Qr = new Html5Qrcode(READER_ELEMENT_ID);
    scannerRef.current = html5Qr;

    const config = {
      fps: SCAN_FPS,
      qrbox: { width: 240, height: 240 },
      aspectRatio: 1.0,
    };

    html5Qr
      .start(
        { facingMode: 'environment' },
        config,
        (decodedText: string) => {
          if (!isMounted) return;
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

          // Trigger scan callback
          onScan(cleanText);
        },
        () => {
          // Normal frame misses; silently ignore
        }
      )
      .then(() => {
        if (isMounted) {
          setStatus('scanning');
        } else {
          // If unmounted while starting
          html5Qr.stop().catch(() => {}).finally(() => html5Qr.clear());
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg = String(err);
        if (
          msg.includes('NotAllowedError') ||
          msg.includes('Permission denied') ||
          msg.includes('PermissionDeniedError')
        ) {
          setErrorMessage(
            'Camera permission was denied. Please allow camera permissions in your browser address bar or use manual entry below.'
          );
        } else if (
          msg.includes('NotFoundError') ||
          msg.includes('DevicesNotFoundError')
        ) {
          setErrorMessage(
            'No physical camera was detected on this device. Please use manual entry below.'
          );
        } else if (
          msg.includes('NotReadableError') ||
          msg.includes('TrackStartError')
        ) {
          setErrorMessage(
            'Camera is currently in use by another application. Please close other camera apps and retry.'
          );
        } else {
          setErrorMessage(`Could not access camera: ${msg}. Please use manual entry below.`);
        }
        setStatus('error');
      });

    return () => {
      isMounted = false;
      isStoppingRef.current = true;
      if (scannerRef.current) {
        const scannerInstance = scannerRef.current;
        scannerRef.current = null;
        if (scannerInstance.isScanning) {
          scannerInstance
            .stop()
            .catch(() => {})
            .finally(() => {
              try {
                scannerInstance.clear();
              } catch {
                // Ignore clear errors during teardown
              }
            });
        } else {
          try {
            scannerInstance.clear();
          } catch {
            // Ignore clear errors
          }
        }
      }
    };
  }, [active, isSupported, onScan]);

  function handleRetry() {
    setStatus('initializing');
    setErrorMessage(null);
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
        {/* html5-qrcode camera stream container */}
        <div
          id={READER_ELEMENT_ID}
          style={{
            width: '100%',
            height: '100%',
            display: status === 'scanning' ? 'block' : 'none',
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
        {(status === 'error' || status === 'unsupported') && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-3)',
              color: '#FFFFF0',
              padding: 'var(--space-5)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 36 }}>⚠️</div>
            <div style={{ fontWeight: 600, color: '#F87171' }}>
              {status === 'unsupported' ? 'Camera Not Supported' : 'Camera Unavailable'}
            </div>
            <p
              style={{
                fontSize: 'var(--text-xs)',
                color: '#E5E7EB',
                lineHeight: 1.4,
              }}
            >
              {errorMessage}
            </p>
            {status === 'error' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleRetry}
                style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}
              >
                Retry Camera
              </button>
            )}
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
