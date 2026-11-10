/**
 * ScanPage — QR Code scanning & manual asset lookup.
 *
 * SPECIFICATION (F-S1, F-S5, F-S6):
 * - Staff and Admin accessible: /admin/scan and /staff/scan
 * - Camera QR scanning (native getUserMedia + jsQR engine):
 *   - Limited to ~5-8 frames per second (~140ms throttle)
 *   - Ignores repeat scans of the same code for 3 seconds
 *   - Single guarded lifecycle state machine (idle, starting, running, stopping)
 *   - Halts camera stream immediately on unmount or pause
 *   - Gracefully handles permission denial, timeout watchdog & unsupported browsers
 *   - Diagnostic error mapping and dev-only ?debug=1 inspection panel via enumerateDevices()
 * - ALWAYS offers a manual asset-code entry fallback
 * - Resolution strategy:
 *   - Checks local IndexedDB snapshot first (instant response, offline resilient)
 *   - Then queries GET /api/equipment/:asset_code when online
 *   - Displays resolved equipment card with status, location, condition, and source tag
 */

import { useState, FormEvent, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { CameraScanner } from '../../components/CameraScanner';
import {
  resolveEquipmentByCode,
  EquipmentDetail,
  ResolveEquipmentResult,
} from '../../data/equipmentSource';
import { EquipmentStatus } from '../../data/equipmentSource';

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  available: 'Available',
  rented: 'Rented',
  under_repair: 'Under Repair',
};

const STATUS_CLASSES: Record<EquipmentStatus, string> = {
  available: 'status-badge-available',
  rented: 'status-badge-rented',
  under_repair: 'status-badge-repair',
};

interface DebugDeviceInfo {
  deviceId: string;
  label: string;
}

export default function ScanPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const isDebug = searchParams.get('debug') === '1';

  const [cameraActive, setCameraActive] = useState<boolean>(true);
  const [manualCode, setManualCode] = useState<string>('');
  const [resolving, setResolving] = useState<boolean>(false);
  const [resolvedCode, setResolvedCode] = useState<string | null>(null);
  const [resolvedResult, setResolvedResult] = useState<ResolveEquipmentResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Debug panel state
  const [debugCameras, setDebugCameras] = useState<DebugDeviceInfo[]>([]);
  const [debugCameraError, setDebugCameraError] = useState<string | null>(null);

  const role = user?.role || 'staff';
  const userId = user?.id || 1;
  const testPageUrl = `/${role}/camera-test`;

  // Cleanup on unmount: deactivate camera
  useEffect(() => {
    return () => {
      setCameraActive(false);
    };
  }, []);

  // Fetch debug camera devices via native navigator.mediaDevices.enumerateDevices() if ?debug=1
  useEffect(() => {
    if (isDebug) {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            const videoInputs = devices
              .filter((d) => d.kind === 'videoinput')
              .map((d, idx) => ({
                deviceId: d.deviceId || `default-${idx}`,
                label: d.label || `Camera #${idx + 1}`,
              }));
            setDebugCameras(videoInputs);
          })
          .catch((err: unknown) => {
            setDebugCameraError(err instanceof Error ? err.message : String(err));
          });
      } else {
        setDebugCameraError('navigator.mediaDevices.enumerateDevices is not available');
      }
    }
  }, [isDebug]);

  const handleResolveCode = useCallback(async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) {
      setErrorMessage('Please enter an asset code.');
      return;
    }

    setErrorMessage(null);
    setResolving(true);
    setResolvedCode(code);

    try {
      const res = await resolveEquipmentByCode(code, userId);
      setResolvedResult(res);

      if (res.source === 'not_found' || !res.equipment) {
        setErrorMessage(`Asset '${code}' was not found in local snapshot or on server.`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to resolve asset code';
      setErrorMessage(message);
    } finally {
      setResolving(false);
    }
  }, [userId]);

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    handleResolveCode(manualCode);
  }

  function handleReset() {
    setResolvedCode(null);
    setResolvedResult(null);
    setErrorMessage(null);
    setManualCode('');
    setCameraActive(true);
  }

  function handleNavigateToDetail(assetCode: string) {
    navigate(`/${role}/equipment/${encodeURIComponent(assetCode)}`);
  }

  const equipment: EquipmentDetail | null = resolvedResult?.equipment ?? null;
  const isSecureContext = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false;
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';

  return (
    <div className="animate-fade-up" style={{ maxWidth: 640, margin: '0 auto', paddingBottom: 'var(--space-8)' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 'var(--space-6)', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
          Equipment QR Scanner
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Scan physical asset tag or enter asset code manually (offline-first)
        </p>
      </div>

      {/* Dev-only ?debug=1 Diagnostic Panel */}
      {isDebug && (
        <div
          data-testid="camera-debug-panel"
          className="card"
          style={{
            marginBottom: 'var(--space-6)',
            padding: 'var(--space-4)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-warning)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <span style={{ fontWeight: 700, color: 'var(--color-warning)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              🛠 Camera Diagnostic Panel (?debug=1)
            </span>
            <a href={testPageUrl} style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
              Raw getUserMedia Test →
            </a>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', rowGap: 'var(--space-2)', columnGap: 'var(--space-2)' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>window.isSecureContext:</span>
            <span style={{ fontWeight: 600, color: isSecureContext ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {isSecureContext ? '✓ true (Secure Origin)' : '✗ false (Plain HTTP blocks camera)'}
            </span>

            <span style={{ color: 'var(--color-text-muted)' }}>User Agent:</span>
            <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all', fontSize: '0.7rem' }}>
              {userAgent}
            </span>

            <span style={{ color: 'var(--color-text-muted)' }}>Cameras Enumerated:</span>
            <span>
              {debugCameraError ? (
                <span style={{ color: 'var(--color-danger)' }}>Error: {debugCameraError}</span>
              ) : debugCameras.length === 0 ? (
                <em>No cameras detected (or permission not yet granted)</em>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
                  {debugCameras.map((cam, idx) => (
                    <li key={cam.deviceId || idx}>
                      <strong>{cam.label || `Camera #${idx + 1}`}</strong>
                      <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '0.7rem' }}>
                        ID: {cam.deviceId ? `${cam.deviceId.slice(0, 20)}…` : 'default'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Main Scanner Section */}
      {!resolvedResult && (
        <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-5)' }}>
          <CameraScanner
            onScan={handleResolveCode}
            active={cameraActive}
            onToggleActive={setCameraActive}
            testPageUrl={testPageUrl}
          />
        </div>
      )}

      {/* Manual Entry Fallback Form */}
      <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-5)' }}>
        <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
          Manual Asset Code Lookup
        </h2>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
          Use if the QR tag is damaged, unreadable, or camera permissions are unavailable.
        </p>

        <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            id="manual-asset-code-input"
            type="text"
            className="input"
            placeholder="e.g. CRN-50-001, GEN-250-001"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
            disabled={resolving}
          />
          <button
            id="manual-asset-lookup-btn"
            type="submit"
            className="btn btn-primary"
            disabled={resolving || !manualCode.trim()}
          >
            {resolving ? 'Looking up…' : 'Look Up'}
          </button>
        </form>
      </div>

      {/* Resolution Loading Spinner */}
      {resolving && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <div className="spinner spinner-lg" style={{ margin: '0 auto var(--space-4)' }} />
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            Resolving asset <strong>{resolvedCode}</strong>…
          </p>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
            Checking local offline snapshot, then querying server…
          </span>
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && !resolving && (
        <div
          className="alert alert-error animate-fade-in"
          style={{ marginBottom: 'var(--space-6)' }}
          role="alert"
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
            <div>
              <strong>Lookup Failed:</strong> {errorMessage}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setErrorMessage(null)}
              style={{ padding: '0 var(--space-2)', fontSize: 'var(--text-xs)' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Resolved Equipment Card */}
      {equipment && !resolving && (
        <div className="card animate-scale-in" style={{ padding: 'var(--space-6)', border: '2px solid var(--color-primary)' }}>
          {/* Card Header with Badges */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  {equipment.asset_code}
                </h2>
                <span className={`status-badge ${STATUS_CLASSES[equipment.status] || ''}`}>
                  {STATUS_LABELS[equipment.status] || equipment.status}
                </span>
              </div>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
                {equipment.make} {equipment.model} — {equipment.type_name}
              </p>
            </div>

            {/* Data Source Badge (Live vs Snapshot) */}
            <div style={{ textAlign: 'right' }}>
              {resolvedResult?.source === 'live' ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    color: 'var(--color-success)',
                    background: 'rgba(34, 197, 94, 0.1)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(34, 197, 94, 0.25)',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success)' }} />
                  Live Server Data
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    color: 'var(--color-warning)',
                    background: 'rgba(234, 179, 8, 0.1)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(234, 179, 8, 0.25)',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-warning)' }} />
                  Cached Snapshot (Offline)
                </span>
              )}
            </div>
          </div>

          {/* Asset Key Information Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-5)',
              background: 'var(--color-surface-2)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'block' }}>Make &amp; Model</span>
              <strong style={{ fontSize: 'var(--text-sm)' }}>{equipment.make} {equipment.model}</strong>
            </div>

            <div>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'block' }}>Type</span>
              <span style={{ fontSize: 'var(--text-sm)' }}>{equipment.type_name}</span>
            </div>

            <div>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'block' }}>Serial Number</span>
              <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)' }}>{equipment.serial_no || '—'}</span>
            </div>

            <div>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'block' }}>Current Location</span>
              <span style={{ fontSize: 'var(--text-sm)' }}>{equipment.current_location_name || '—'}</span>
            </div>

            <div>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'block' }}>Condition</span>
              <span style={{ fontSize: 'var(--text-sm)', textTransform: 'capitalize' }}>{equipment.condition}</span>
            </div>

            {equipment.current_customer_name && (
              <div>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'block' }}>Rented To</span>
                <span style={{ fontSize: 'var(--text-sm)' }}>{equipment.current_customer_name}</span>
              </div>
            )}
          </div>

          {/* Snapshot Notice if applicable */}
          {resolvedResult?.source === 'snapshot' && resolvedResult.savedAt && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
              Cached snapshot saved at: {new Date(resolvedResult.savedAt).toLocaleString()}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <button
              id="view-asset-detail-btn"
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={() => handleNavigateToDetail(equipment.asset_code)}
            >
              View Asset Details &amp; Actions →
            </button>
            <button
              id="scan-another-btn"
              type="button"
              className="btn btn-secondary"
              onClick={handleReset}
            >
              Scan Another Asset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
