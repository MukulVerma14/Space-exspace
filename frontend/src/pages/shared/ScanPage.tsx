/**
 * ScanPage — QR Code scanning & manual asset lookup.
 *
 * SPECIFICATION (F-S1 & F-S5):
 * - Staff and Admin accessible: /admin/scan and /staff/scan
 * - Camera QR scanning (html5-qrcode):
 *   - Limited to ~5 frames per second
 *   - Ignores repeat scans of the same code for 3 seconds
 *   - Halts camera stream immediately on unmount or pause
 *   - Gracefully handles permission denial & unsupported browsers
 *   - Diagnostic error mapping and dev-only ?debug=1 inspection panel
 * - ALWAYS offers a manual asset-code entry fallback
 * - Resolution strategy:
 *   - Checks local IndexedDB snapshot first (instant response, offline resilient)
 *   - Then queries GET /api/equipment/:asset_code when online
 *   - Displays resolved equipment card with status, location, condition, and source tag
 */

import { useState, FormEvent, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Html5Qrcode, CameraDevice } from 'html5-qrcode';
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
  const [debugCameras, setDebugCameras] = useState<CameraDevice[]>([]);
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

  // Fetch debug camera devices if ?debug=1
  useEffect(() => {
    if (isDebug) {
      Html5Qrcode.getCameras()
        .then((devices) => {
          setDebugCameras(devices || []);
        })
        .catch((err: unknown) => {
          setDebugCameraError(err instanceof Error ? err.message : String(err));
        });
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
        setErrorMessage(
          res.error || `Equipment with asset code '${code}' was not found.`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setResolvedResult(null);
    } finally {
      setResolving(false);
    }
  }, [userId]);

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    if (manualCode.trim()) {
      handleResolveCode(manualCode.trim());
    }
  }

  function handleReset() {
    setResolvedResult(null);
    setResolvedCode(null);
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
                    <li key={cam.id || idx}>
                      <strong>{cam.label || `Camera #${idx + 1}`}</strong>
                      <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '0.7rem' }}>
                        ID: {cam.id ? `${cam.id.slice(0, 20)}…` : 'default'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Main Resolution Container */}
      {!equipment && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Camera Scanner View */}
          <div
            className="card"
            style={{
              padding: 'var(--space-4)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <CameraScanner
              active={cameraActive && !resolving}
              onScan={(scannedCode) => {
                handleResolveCode(scannedCode);
              }}
              onToggleActive={(active) => setCameraActive(active)}
              testPageUrl={testPageUrl}
            />
          </div>

          {/* Resolving Status Indicator */}
          {resolving && (
            <div
              className="card"
              style={{
                padding: 'var(--space-4)',
                textAlign: 'center',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="spinner spinner-md" style={{ margin: '0 auto var(--space-2)' }} />
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                Resolving asset code: <strong style={{ color: 'var(--color-text)' }}>{resolvedCode}</strong>…
              </p>
            </div>
          )}

          {/* Resolution Error Banner */}
          {errorMessage && !resolving && (
            <div
              className="card"
              role="alert"
              style={{
                padding: 'var(--space-4)',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--color-danger)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-3)',
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--color-danger)', fontSize: 'var(--text-sm)' }}>
                  Lookup Failed
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text)', marginTop: '2px' }}>
                  {errorMessage}
                </div>
              </div>
            </div>
          )}

          {/* Manual Entry Fallback Form */}
          <div
            className="card"
            style={{
              padding: 'var(--space-5)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
              ⌨ Manual Asset Code Entry
            </h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-4)' }}>
              If camera scanning is unavailable or the QR label is damaged, type the asset code printed on the machine tag.
            </p>

            <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                id="manual-asset-input"
                type="text"
                className="input"
                placeholder="e.g. CRN-50-001 or GEN-250-001"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                disabled={resolving}
                style={{ flex: 1, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
              />
              <button
                id="manual-asset-submit"
                type="submit"
                className="btn btn-primary"
                disabled={resolving || !manualCode.trim()}
              >
                Look Up Asset
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Resolved Equipment Card View */}
      {equipment && (
        <div
          className="card animate-fade-up"
          style={{
            padding: 'var(--space-6)',
            background: 'var(--color-surface)',
            border: '2px solid var(--color-primary)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {/* Card Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-4)',
              borderBottom: '1px solid var(--color-border-subtle)',
              paddingBottom: 'var(--space-4)',
            }}
          >
            <div>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Asset Tag Detected
              </span>
              <h2
                style={{
                  fontSize: 'var(--text-2xl)',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-primary)',
                  letterSpacing: '0.05em',
                }}
              >
                {equipment.asset_code}
              </h2>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span className={`status-badge ${STATUS_CLASSES[equipment.status] || ''}`}>
                {STATUS_LABELS[equipment.status] || equipment.status}
              </span>
              <span
                className={`badge ${
                  resolvedResult?.source === 'snapshot' ? 'badge-warning' : 'badge-success'
                }`}
                style={{ fontSize: 'var(--text-xs)' }}
              >
                {resolvedResult?.source === 'snapshot' ? '⚡ Local Snapshot' : '● Live API'}
              </span>
            </div>
          </div>

          {/* Machine Details Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 'var(--space-4)',
              marginBottom: 'var(--space-6)',
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
