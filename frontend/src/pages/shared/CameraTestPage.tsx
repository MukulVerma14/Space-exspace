/**
 * CameraTestPage — Minimal raw getUserMedia fallback test page.
 *
 * SPECIFICATION (F-S5):
 * Uses raw navigator.mediaDevices.getUserMedia (video with playsinline, muted, autoplay)
 * to immediately isolate library issues (html5-qrcode) from browser / OS permission or hardware issues.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { parseCameraError, CameraDiagnosticInfo } from '../../utils/cameraErrors';

export default function CameraTestPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role || 'staff';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [errorInfo, setErrorInfo] = useState<CameraDiagnosticInfo | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [trackDetails, setTrackDetails] = useState<string | null>(null);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);

  const isSecureContext = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false;
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';

  async function startRawCamera(preferredFacing: 'environment' | 'user') {
    setErrorInfo(null);
    setTrackDetails(null);

    // Stop existing stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorInfo({
        name: 'NotSupportedError',
        message: 'navigator.mediaDevices.getUserMedia is undefined',
        hint: 'Your browser or context does not support mediaDevices.getUserMedia.',
      });
      setIsStreaming(false);
      return;
    }

    try {
      console.info(`[CameraTestPage] Requesting raw getUserMedia with facingMode: { ideal: '${preferredFacing}' }`);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: preferredFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch((playErr) => {
          console.warn('[CameraTestPage] video.play() warning:', playErr);
        });
      }

      setIsStreaming(true);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings ? videoTrack.getSettings() : {};
        const details = `Track: "${videoTrack.label}" | ReadyState: ${videoTrack.readyState} | ${
          settings.width || '?'
        }x${settings.height || '?'} @ ${settings.frameRate || '?'}fps | facingMode: ${
          settings.facingMode || preferredFacing
        }`;
        setTrackDetails(details);
        console.info('[CameraTestPage] Camera active:', details);
      }

      // Enumerate available devices
      if (navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAvailableDevices(devices.filter((d) => d.kind === 'videoinput'));
      }
    } catch (err: unknown) {
      console.error('[CameraTestPage] Raw getUserMedia failed:', err);
      const parsed = parseCameraError(err);
      setErrorInfo(parsed);
      setIsStreaming(false);
    }
  }

  function stopRawCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setTrackDetails(null);
  }

  function toggleFacingMode() {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    startRawCamera(nextFacing);
  }

  useEffect(() => {
    startRawCamera(facingMode);

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return (
    <div className="animate-fade-up" style={{ maxWidth: 640, margin: '0 auto', paddingBottom: 'var(--space-8)' }}>
      {/* Navigation Header */}
      <div style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigate(`/${role}/scan`)}
          style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-2)' }}
        >
          ← Return to Scanner
        </button>
        <span className="badge badge-info" style={{ fontSize: 'var(--text-xs)' }}>
          F-S5 Diagnostic Tool
        </span>
      </div>

      <div style={{ marginBottom: 'var(--space-6)', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
          Raw Camera Stream Test
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Direct native <code>navigator.mediaDevices.getUserMedia</code> test without external scanning libraries.
        </p>
      </div>

      {/* Video Viewport Card */}
      <div
        className="card"
        style={{
          padding: 'var(--space-4)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-lg)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '16 / 9',
            maxWidth: 580,
            background: '#0B0B0C',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            margin: '0 auto',
            border: '2px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: isStreaming ? 'block' : 'none',
            }}
          />

          {!isStreaming && !errorInfo && (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
              <div className="spinner spinner-lg" style={{ margin: '0 auto var(--space-2)' }} />
              Connecting to video hardware…
            </div>
          )}

          {!isStreaming && errorInfo && (
            <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: '#F87171' }}>
              <div style={{ fontSize: 32, marginBottom: 'var(--space-2)' }}>⚠️</div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>
                {errorInfo.name}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  background: 'rgba(0,0,0,0.4)',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                {errorInfo.message}
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                {errorInfo.hint}
              </p>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginTop: 'var(--space-4)',
          }}
        >
          {isStreaming ? (
            <button type="button" className="btn btn-secondary" onClick={stopRawCamera}>
              ⏹ Stop Stream
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => startRawCamera(facingMode)}>
              ▶ Start Camera
            </button>
          )}

          <button type="button" className="btn btn-ghost" onClick={toggleFacingMode} disabled={!isStreaming}>
            🔄 Switch to {facingMode === 'environment' ? 'Front (User)' : 'Rear (Environment)'}
          </button>
        </div>

        {trackDetails && (
          <div
            style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-surface-2)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-success)',
              textAlign: 'center',
            }}
          >
            ✓ {trackDetails}
          </div>
        )}
      </div>

      {/* Diagnostics Panel */}
      <div
        className="card"
        style={{
          padding: 'var(--space-4)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          fontSize: 'var(--text-xs)',
        }}
      >
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span>🛠</span> Environment & Hardware Inspection
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 'var(--space-2)', columnGap: 'var(--space-2)' }}>
          <span style={{ color: 'var(--color-text-muted)' }}>Secure Context:</span>
          <span style={{ fontWeight: 600, color: isSecureContext ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {isSecureContext ? '✓ Yes (HTTPS / localhost)' : '✗ No (Plain HTTP blocks camera)'}
          </span>

          <span style={{ color: 'var(--color-text-muted)' }}>Stream State:</span>
          <span style={{ fontWeight: 600 }}>{isStreaming ? 'Streaming Active' : 'Idle / Stopped'}</span>

          <span style={{ color: 'var(--color-text-muted)' }}>Target FacingMode:</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{facingMode} (ideal)</span>

          <span style={{ color: 'var(--color-text-muted)' }}>Detected Cameras:</span>
          <span>
            {availableDevices.length === 0 ? (
              <em>None enumerated or permission not yet granted</em>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
                {availableDevices.map((d, i) => (
                  <li key={d.deviceId || i}>
                    <strong>{d.label || `Camera #${i + 1}`}</strong>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', display: 'block' }}>
                      ID: {d.deviceId ? `${d.deviceId.slice(0, 16)}…` : 'hidden until granted'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </span>

          <span style={{ color: 'var(--color-text-muted)' }}>User Agent:</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', wordBreak: 'break-all' }}>
            {userAgent}
          </span>
        </div>

        {/* Diagnosis interpretation guide */}
        <div
          style={{
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
          }}
        >
          <strong>Interpreting Results:</strong>
          <ul style={{ margin: 'var(--space-1) 0 0 0', paddingLeft: 'var(--space-4)' }}>
            <li>
              If the video streams here but the Scan Page fails: the issue is with the QR library configuration or container dimensions.
            </li>
            <li>
              If this test fails with <code>NotAllowedError</code>: camera permission was denied in your browser or operating system settings.
            </li>
            <li>
              If this test fails with <code>SecurityError</code>: the connection is not running in a Secure Context (HTTPS or localhost).
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
