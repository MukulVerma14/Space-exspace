/**
 * ScanPage — QR Code scanning & manual asset lookup.
 *
 * SPECIFICATION (F-S1):
 * - Staff and Admin accessible: /admin/scan and /staff/scan
 * - Camera QR scanning (html5-qrcode):
 *   - Limited to ~5 frames per second
 *   - Ignores repeat scans of the same code for 3 seconds
 *   - Halts camera stream immediately on unmount or pause
 *   - Gracefully handles permission denial & unsupported browsers
 * - ALWAYS offers a manual asset-code entry fallback
 * - Resolution strategy:
 *   - Checks local IndexedDB snapshot first (instant response, offline resilient)
 *   - Then queries GET /api/equipment/:asset_code when online
 *   - Displays resolved equipment card with status, location, condition, and source tag
 */

import { useState, FormEvent, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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

  const [cameraActive, setCameraActive] = useState<boolean>(true);
  const [manualCode, setManualCode] = useState<string>('');
  const [resolving, setResolving] = useState<boolean>(false);
  const [resolvedCode, setResolvedCode] = useState<string | null>(null);
  const [resolvedResult, setResolvedResult] = useState<ResolveEquipmentResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const role = user?.role || 'staff';
  const userId = user?.id || 1;

  // Cleanup on unmount: deactivate camera
  useEffect(() => {
    return () => {
      setCameraActive(false);
    };
  }, []);

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
            />
          </div>

          {/* Resolving Status Indicator */}
          {resolving && (
            <div
              className="card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-4)',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div className="spinner spinner-md" />
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                Resolving asset <strong>{resolvedCode}</strong> (snapshot first, then live API)…
              </div>
            </div>
          )}

          {/* Error / Not Found Banner */}
          {errorMessage && !resolving && (
            <div
              role="alert"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
                padding: 'var(--space-4)',
                background: 'var(--color-danger-dim)',
                border: '1px solid var(--color-danger)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-danger)',
                fontSize: 'var(--text-sm)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600 }}>
                <span>⚠️</span>
                <span>Asset Lookup Failed</span>
              </div>
              <div>{errorMessage}</div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setErrorMessage(null)}
                style={{
                  alignSelf: 'flex-start',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-danger)',
                  padding: '2px 8px',
                  marginTop: 'var(--space-1)',
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* ALWAYS OFFERED: Manual Asset-Code Entry Fallback */}
          <div
            className="card"
            style={{
              padding: 'var(--space-5)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>
                Manual Asset Code Entry
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Always available for field equipment without readable labels or camera access.
              </div>
            </div>

            <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                id="manual-asset-code-input"
                type="text"
                className="input"
                placeholder="e.g. CRN-50-001, GEN-250-001"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                disabled={resolving}
                style={{
                  flex: 1,
                  fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase',
                }}
                autoComplete="off"
                autoCapitalize="characters"
              />
              <button
                id="manual-asset-code-btn"
                type="submit"
                className="btn btn-primary"
                disabled={resolving || !manualCode.trim()}
              >
                {resolving ? 'Looking up…' : 'Look Up'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Resolved Equipment Card View */}
      {equipment && (
        <div className="card animate-fade-up" style={{ padding: 'var(--space-6)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
          {/* Header Row: Asset Code & Source Badge */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Asset Code
              </div>
              <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>
                {equipment.asset_code}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-1)' }}>
              <span className={`status-badge ${STATUS_CLASSES[equipment.status] || ''}`}>
                {STATUS_LABELS[equipment.status] || equipment.status}
              </span>
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  fontWeight: 600,
                  background: resolvedResult?.source === 'live' ? 'var(--color-success-dim)' : 'var(--color-warning-dim)',
                  color: resolvedResult?.source === 'live' ? 'var(--color-success)' : 'var(--color-warning)',
                }}
              >
                {resolvedResult?.source === 'live' ? '● Live Server' : '○ Offline Snapshot'}
              </span>
            </div>
          </div>

          {/* Metadata Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 'var(--space-3)',
              background: 'var(--color-surface-2)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-4)',
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
