/**
 * EquipmentDetailPage — Asset detail view & offline-first fleet operations.
 *
 * SPECIFICATION (F-S2):
 * - Accessible to Staff and Admin at /admin/equipment/:asset_code and /staff/equipment/:asset_code
 * - Displays:
 *   - Type, model, serial no, capacity
 *   - Current status, location, condition, last moved info
 *   - Location history log (chronological)
 *   - Active rental details (if rented)
 *   - Open maintenance details (if under repair)
 * - ROLE GATES (Mandatory):
 *   - Staff see NO rates or monetary amounts anywhere.
 *   - Admin also sees commercial rates (applied_rate in active_rental, standard_rates cards, repair costs).
 * - ACTIONS:
 *   - Move: Destination location picker (yards, workshops, sites), optional note.
 *   - Return: Destination location picker, condition picker (good, fair, needs_repair), optional note.
 *   - Send to repair: Kind (repair, modification), description (required), workshop picker, optional note.
 * - OFFLINE & OUTBOX:
 *   - Every action creates an outbox event via enqueueEvent (works 100% offline).
 *   - Shows "Pending sync" banner until accepted by the server.
 *   - Shows server rejection reason banner if rejected, with "Discard" action.
 */

import { useState, useEffect, useCallback, useMemo, FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useOutbox } from '../../hooks/useOutbox';
import { enqueueEvent, discardEvent } from '../../offline/outbox';
import { runSync } from '../../sync/syncManager';
import {
  resolveEquipmentByCode,
  fetchLocations,
  EquipmentDetail,
  AppLocation,
  DataSource,
} from '../../data/equipmentSource';
import { EquipmentStatus, EquipmentCondition } from '../../mocks/equipmentMock';

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  available: 'Available',
  rented: 'Rented',
  under_repair: 'Under Repair',
};

const STATUS_CLASSES: Record<EquipmentStatus, string> = {
  available: 'badge-available',
  rented: 'badge-rented',
  under_repair: 'badge-repair',
};

const CONDITION_COLOUR: Record<EquipmentCondition, string> = {
  good: '#059669',
  fair: '#B45309',
  needs_repair: '#DC2626',
};

export default function EquipmentDetailPage() {
  const { asset_code } = useParams<{ asset_code: string }>();
  const { user } = useAuth();

  const role = user?.role || 'staff';
  const isAdmin = role === 'admin';
  const userId = user?.id || 1;

  // Data state
  const [equipment, setEquipment] = useState<EquipmentDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [source, setSource] = useState<DataSource | 'not_found'>('none');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Locations state
  const [locations, setLocations] = useState<AppLocation[]>([]);

  // Action modals
  const [showMoveModal, setShowMoveModal] = useState<boolean>(false);
  const [showReturnModal, setShowReturnModal] = useState<boolean>(false);
  const [showRepairModal, setShowRepairModal] = useState<boolean>(false);

  // Move Form State
  const [moveLocationId, setMoveLocationId] = useState<string>('');
  const [moveNote, setMoveNote] = useState<string>('');
  const [actionSubmitting, setActionSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Return Form State
  const [returnLocationId, setReturnLocationId] = useState<string>('');
  const [returnCondition, setReturnCondition] = useState<EquipmentCondition>('good');
  const [returnNote, setReturnNote] = useState<string>('');

  // Repair Form State
  const [repairKind, setRepairKind] = useState<'repair' | 'modification'>('repair');
  const [repairDescription, setRepairDescription] = useState<string>('');
  const [repairWorkshopId, setRepairWorkshopId] = useState<string>('');
  const [repairNote, setRepairNote] = useState<string>('');

  // Outbox events for this asset
  const { events } = useOutbox(user?.id ?? null);

  const cleanCode = (asset_code || '').trim();

  const assetEvents = useMemo(() => {
    if (!cleanCode) return [];
    const lower = cleanCode.toLowerCase();
    return events.filter((e) => e.assetCode.toLowerCase() === lower);
  }, [events, cleanCode]);

  const pendingEvents = useMemo(
    () => assetEvents.filter((e) => e.status === 'pending'),
    [assetEvents]
  );
  const rejectedEvents = useMemo(
    () => assetEvents.filter((e) => e.status === 'rejected'),
    [assetEvents]
  );

  // Load locations
  useEffect(() => {
    fetchLocations(user?.id).then((locs) => {
      setLocations(locs);
      if (locs.length > 0) {
        // Set smart default for return (first yard)
        const yard = locs.find((l) => l.kind === 'yard');
        if (yard) setReturnLocationId(String(yard.id));

        // Set smart default for repair (first workshop)
        const workshop = locs.find((l) => l.kind === 'workshop');
        if (workshop) setRepairWorkshopId(String(workshop.id));
      }
    });
  }, [user]);

  // Load equipment
  const loadAsset = useCallback(async () => {
    if (!cleanCode) {
      setError('Asset code is missing.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const res = await resolveEquipmentByCode(cleanCode, userId);
    setEquipment(res.equipment);
    setSource(res.source);
    setSavedAt(res.savedAt ?? null);
    setError(res.error ?? null);
    setLoading(false);

    if (res.equipment?.condition) {
      setReturnCondition(res.equipment.condition as EquipmentCondition);
    }
  }, [cleanCode, userId]);

  useEffect(() => {
    loadAsset();
  }, [loadAsset]);

  // Handle Move Action
  async function handleMoveSubmit(e: FormEvent) {
    e.preventDefault();
    if (!equipment) return;
    const locIdNum = Number(moveLocationId);
    if (!locIdNum || isNaN(locIdNum)) {
      setActionError('Please select a destination location.');
      return;
    }

    setActionSubmitting(true);
    setActionError(null);

    try {
      await enqueueEvent({
        userId,
        type: 'move',
        assetCode: equipment.asset_code,
        payload: {
          location_id: locIdNum,
          note: moveNote.trim() || undefined,
        },
      });

      // Attempt immediate background sync if online
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        runSync(userId).catch(() => {});
      }

      setShowMoveModal(false);
      setMoveNote('');
      setMoveLocationId('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to record movement');
    } finally {
      setActionSubmitting(false);
    }
  }

  // Handle Return Action
  async function handleReturnSubmit(e: FormEvent) {
    e.preventDefault();
    if (!equipment) return;
    const locIdNum = Number(returnLocationId);
    if (!locIdNum || isNaN(locIdNum)) {
      setActionError('Please select a return location.');
      return;
    }

    setActionSubmitting(true);
    setActionError(null);

    try {
      await enqueueEvent({
        userId,
        type: 'return',
        assetCode: equipment.asset_code,
        payload: {
          location_id: locIdNum,
          condition: returnCondition,
          note: returnNote.trim() || undefined,
        },
      });

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        runSync(userId).catch(() => {});
      }

      setShowReturnModal(false);
      setReturnNote('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to record return');
    } finally {
      setActionSubmitting(false);
    }
  }

  // Handle Send to Repair Action
  async function handleRepairSubmit(e: FormEvent) {
    e.preventDefault();
    if (!equipment) return;
    if (!repairDescription.trim()) {
      setActionError('Please describe the reason for repair or maintenance.');
      return;
    }

    const workshopNum = repairWorkshopId ? Number(repairWorkshopId) : undefined;

    setActionSubmitting(true);
    setActionError(null);

    try {
      await enqueueEvent({
        userId,
        type: 'send_to_repair',
        assetCode: equipment.asset_code,
        payload: {
          kind: repairKind,
          description: repairDescription.trim(),
          workshop_location_id: workshopNum,
          note: repairNote.trim() || undefined,
        },
      });

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        runSync(userId).catch(() => {});
      }

      setShowRepairModal(false);
      setRepairDescription('');
      setRepairNote('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to send to repair');
    } finally {
      setActionSubmitting(false);
    }
  }

  // Fallback / Loading view
  if (loading) {
    return (
      <div className="container" style={{ padding: 'var(--space-6) var(--space-4)', textAlign: 'center' }}>
        <div className="spinner spinner-lg" style={{ margin: 'var(--space-12) auto var(--space-4)' }} />
        <p style={{ color: 'var(--color-text-muted)' }}>Loading equipment details for {cleanCode}…</p>
      </div>
    );
  }

  // Not found view
  if (!equipment) {
    return (
      <div className="container" style={{ padding: 'var(--space-6) var(--space-4)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Link to={`/${role}/equipment`} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            ← Back to Fleet
          </Link>
        </div>
        <div
          className="card"
          role="alert"
          style={{
            padding: 'var(--space-8)',
            textAlign: 'center',
            borderColor: 'var(--color-danger)',
          }}
        >
          <div style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-2)' }}>⚠️</div>
          <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            Asset Not Found
          </h2>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
            {error || `Equipment with asset code '${cleanCode}' could not be found.`}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary" onClick={loadAsset}>
              Retry
            </button>
            <Link to={`/${role}/scan`} className="btn btn-secondary">
              Scan another asset
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isRented = equipment.status === 'rented';
  const isUnderRepair = equipment.status === 'under_repair';

  return (
    <div className="container" style={{ padding: 'var(--space-6) var(--space-4)', maxWidth: 1000, margin: '0 auto' }}>
      {/* ── Top Navigation / Breadcrumb ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <Link
          to={`/${role}/equipment`}
          id="btn-back-to-fleet"
          className="btn btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          ← Back to Fleet
        </Link>
        <Link
          to={`/${role}/scan`}
          id="btn-scan-another"
          className="btn btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          📷 Scan QR
        </Link>
      </div>

      {/* ── Offline Snapshot Notice ── */}
      {source === 'snapshot' && (
        <div
          role="status"
          id="equipment-offline-notice"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-warning-dim)',
            border: '1px solid var(--color-warning)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <div>
            <strong>Offline Snapshot:</strong> Showing saved data from{' '}
            {savedAt ? new Date(savedAt).toLocaleString() : 'cached local state'}. Live updates will resume when online.
          </div>
          {typeof navigator !== 'undefined' && navigator.onLine && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={loadAsset}
              style={{ whiteSpace: 'nowrap' }}
            >
              Refresh
            </button>
          )}
        </div>
      )}

      {/* ── Outbox Rejected Banners ── */}
      {rejectedEvents.map((rej) => (
        <div
          key={rej.id}
          role="alert"
          className="outbox-rejected-banner"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-danger-dim)',
            border: '1px solid var(--color-danger)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-danger)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <div>
            <strong>Sync Rejected:</strong> The server rejected your {rej.type.replace('_', ' ')} action recorded at{' '}
            {new Date(rej.occurredAt).toLocaleTimeString()}.
            <div style={{ marginTop: 2, fontWeight: 600 }}>Reason: {rej.rejectReason || 'Unknown error'}</div>
          </div>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => discardEvent(rej.id)}
            style={{ whiteSpace: 'nowrap' }}
          >
            Discard
          </button>
        </div>
      ))}

      {/* ── Outbox Pending Banners ── */}
      {pendingEvents.map((pen) => (
        <div
          key={pen.id}
          role="status"
          className="outbox-pending-banner"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-warning-dim)',
            border: '1px solid var(--color-warning)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <div>
            <strong>⏳ Pending Sync:</strong> Action <strong>{pen.type.replace('_', ' ')}</strong> is stored in local outbox (recorded at{' '}
            {new Date(pen.occurredAt).toLocaleTimeString()}). It will sync automatically when online.
          </div>
          {typeof navigator !== 'undefined' && navigator.onLine && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => runSync(userId)}
              style={{ whiteSpace: 'nowrap' }}
            >
              Sync Now
            </button>
          )}
        </div>
      ))}

      {/* ── Main Asset Header Card ── */}
      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-1)' }}>
              <span
                id="equipment-asset-code"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xl)',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  letterSpacing: '0.04em',
                }}
              >
                {equipment.asset_code}
              </span>
              <span className={`badge ${STATUS_CLASSES[equipment.status]}`} id="equipment-status-badge">
                {STATUS_LABELS[equipment.status]}
              </span>
              <span
                id="equipment-condition-badge"
                style={{
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  color: CONDITION_COLOUR[equipment.condition] ?? 'var(--color-text-muted)',
                  background: `${CONDITION_COLOUR[equipment.condition]}18`,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  border: `1px solid ${CONDITION_COLOUR[equipment.condition]}33`,
                  textTransform: 'capitalize',
                }}
              >
                {equipment.condition.replace('_', ' ')}
              </span>
            </div>
            <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: 0 }}>
              {equipment.make} {equipment.model}
            </h1>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginTop: 2 }}>
              {equipment.type_name}
            </div>
          </div>

          {/* Action Buttons Bar */}
          <div
            id="equipment-action-buttons"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-2)',
              alignItems: 'center',
            }}
          >
            {/* Move Action */}
            <button
              type="button"
              id="btn-action-move"
              className="btn btn-primary"
              onClick={() => {
                setShowMoveModal(true);
                setActionError(null);
              }}
            >
              📍 Move
            </button>

            {/* Return Action */}
            <button
              type="button"
              id="btn-action-return"
              className="btn btn-secondary"
              disabled={!isRented}
              title={!isRented ? 'Equipment is not actively rented' : 'Record return of this asset'}
              onClick={() => {
                setShowReturnModal(true);
                setActionError(null);
              }}
            >
              🔄 Return
            </button>

            {/* Send to Repair Action */}
            <button
              type="button"
              id="btn-action-repair"
              className="btn btn-secondary"
              disabled={isRented || isUnderRepair}
              title={
                isRented
                  ? 'Equipment is rented. Return to yard before maintenance.'
                  : isUnderRepair
                  ? 'Equipment already has an open repair ticket.'
                  : 'Open maintenance ticket for this asset'
              }
              onClick={() => {
                setShowRepairModal(true);
                setActionError(null);
              }}
            >
              🔧 Send to Repair
            </button>
          </div>
        </div>

        {/* Action Constraints Explanation (if buttons disabled) */}
        {(isRented || isUnderRepair) && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-4)',
              background: 'var(--color-surface-2)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {isRented && 'ℹ️ This machine is currently rented. To open maintenance, it must first be returned.'}
            {isUnderRepair && 'ℹ️ This machine is currently under maintenance. New repair tickets cannot be opened while one is active.'}
          </div>
        )}

        <div className="divider" style={{ margin: 'var(--space-4) 0' }} />

        {/* Specifications Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Current Location
            </div>
            <div id="equipment-current-location" style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginTop: 2 }}>
              {equipment.current_location_name || 'Unknown'}
            </div>
            {equipment.current_location_kind && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', textTransform: 'capitalize' }}>
                Kind: {equipment.current_location_kind.replace('_', ' ')}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Serial Number
            </div>
            <div id="equipment-serial-no" style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {equipment.serial_no || '—'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Capacity / Rating
            </div>
            <div id="equipment-capacity" style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginTop: 2 }}>
              {equipment.capacity_value ? `${equipment.capacity_value} ${equipment.capacity_unit || ''}` : '—'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Last Relocated
            </div>
            <div style={{ fontWeight: 500, fontSize: 'var(--text-sm)', marginTop: 2 }}>
              {equipment.last_moved_at ? new Date(equipment.last_moved_at).toLocaleDateString() : '—'}
            </div>
            {equipment.last_moved_by_name && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                By {equipment.last_moved_by_name}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Active Rental Section (if rented) ── */}
      {isRented && equipment.active_rental && (
        <div className="card" id="equipment-active-rental-card" style={{ marginBottom: 'var(--space-5)', borderColor: 'var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>📋</span> Active Rental Agreement
            </h2>
            <span className="badge badge-rented" style={{ textTransform: 'capitalize' }}>
              {equipment.active_rental.rental_status}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--space-4)',
              fontSize: 'var(--text-sm)',
            }}
          >
            <div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>Customer</div>
              <div id="rental-customer-name" style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>
                {equipment.active_rental.customer_name}
              </div>
              {isAdmin && equipment.active_rental.customer_contact && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                  Contact: {equipment.active_rental.customer_contact} ({equipment.active_rental.customer_phone || 'No phone'})
                </div>
              )}
            </div>

            <div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>Client Site</div>
              <div id="rental-site-name" style={{ fontWeight: 600 }}>
                {equipment.active_rental.site_name}
              </div>
            </div>

            <div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>Rental Period</div>
              <div style={{ fontWeight: 500 }}>
                {new Date(equipment.active_rental.start_date).toLocaleDateString()} →{' '}
                {new Date(equipment.active_rental.expected_end).toLocaleDateString()}
              </div>
            </div>

            {/* ADMIN ONLY: Commercial rate info. NEVER shown to staff */}
            {isAdmin && equipment.active_rental.applied_rate != null && (
              <div id="rental-admin-rate-section">
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>Agreed Rate (Admin)</div>
                <div style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: 'var(--text-base)' }}>
                  {Number(equipment.active_rental.applied_rate).toFixed(2)} SAR / {equipment.active_rental.rate_unit || 'day'}
                </div>
                {equipment.active_rental.discount_note && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                    Note: {equipment.active_rental.discount_note}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Open Maintenance Section (if under repair) ── */}
      {isUnderRepair && equipment.open_maintenance && (
        <div className="card" id="equipment-maintenance-card" style={{ marginBottom: 'var(--space-5)', borderColor: 'var(--color-danger)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: 0, color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🔧</span> Maintenance Work Order
            </h2>
            <span className="badge badge-repair" style={{ textTransform: 'capitalize' }}>
              {equipment.open_maintenance.kind}
            </span>
          </div>

          <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
            <strong>Issue Description:</strong> {equipment.open_maintenance.description}
          </p>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-6)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
            }}
          >
            <div>
              Opened: <strong>{new Date(equipment.open_maintenance.opened_at).toLocaleDateString()}</strong>
            </div>
            <div>
              Reported By: <strong>{equipment.open_maintenance.reported_by_name}</strong>
            </div>
            {isAdmin && equipment.open_maintenance.cost != null && (
              <div>
                Cost to date: <strong>{Number(equipment.open_maintenance.cost).toFixed(2)} SAR</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Standard Rates Card (ADMIN ONLY) ── */}
      {isAdmin && equipment.standard_rates && equipment.standard_rates.length > 0 && (
        <div className="card" id="equipment-standard-rates-card" style={{ marginBottom: 'var(--space-5)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
            💰 Standard Rate Cards (Admin View)
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                  <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Billing Unit</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Standard Rate</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)' }}>VAT Status</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Effective Date</th>
                </tr>
              </thead>
              <tbody>
                {equipment.standard_rates.map((rate, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <td style={{ padding: 'var(--space-2) var(--space-3)', textTransform: 'capitalize', fontWeight: 600 }}>
                      Per {rate.unit}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-primary)' }}>
                      {Number(rate.amount).toFixed(2)} SAR
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                      {rate.vat_included ? 'VAT Included' : '+15% VAT'}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-muted)' }}>
                      {new Date(rate.valid_from).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Location History Log ── */}
      <div className="card" id="equipment-location-history-card">
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
          📜 Movement & Location History
        </h2>

        {!equipment.location_history || equipment.location_history.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            No movement records found for this asset.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                  <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Date / Time</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Location</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Type</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Moved By</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {equipment.location_history.map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <td style={{ padding: 'var(--space-2) var(--space-3)', whiteSpace: 'nowrap' }}>
                      {new Date(log.moved_at).toLocaleString()}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600 }}>
                      {log.location_name}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)', textTransform: 'capitalize', color: 'var(--color-text-muted)' }}>
                      {log.location_kind.replace('_', ' ')}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                      {log.moved_by_name}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-muted)' }}>
                      {log.note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── MODAL: Move Equipment ── */}
      {showMoveModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="move-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(10, 10, 10, 0.7)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
          }}
          onClick={() => setShowMoveModal(false)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 500,
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="move-modal-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
              📍 Move Asset: {equipment.asset_code}
            </h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
              Current Location: <strong>{equipment.current_location_name || 'Unknown'}</strong>
            </p>

            {actionError && (
              <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
                {actionError}
              </div>
            )}

            <form onSubmit={handleMoveSubmit}>
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label htmlFor="move-destination" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Destination Location *
                </label>
                <select
                  id="move-destination"
                  className="select"
                  value={moveLocationId}
                  onChange={(e) => setMoveLocationId(e.target.value)}
                  required
                  style={{ width: '100%' }}
                >
                  <option value="">— Select destination —</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.kind.replace('_', ' ')})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 'var(--space-5)' }}>
                <label htmlFor="move-note" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Transfer Note (Optional)
                </label>
                <input
                  id="move-note"
                  type="text"
                  className="input"
                  placeholder="e.g. Relocated via flatbed trailer"
                  value={moveNote}
                  onChange={(e) => setMoveNote(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowMoveModal(false)}
                  disabled={actionSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="btn-submit-move"
                  className="btn btn-primary"
                  disabled={actionSubmitting || !moveLocationId}
                >
                  {actionSubmitting ? 'Recording…' : 'Record Move'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Return Equipment ── */}
      {showReturnModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="return-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(10, 10, 10, 0.7)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
          }}
          onClick={() => setShowReturnModal(false)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 500,
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="return-modal-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
              🔄 Return from Rental: {equipment.asset_code}
            </h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
              Returning to yard from client site: <strong>{equipment.current_location_name || 'Client site'}</strong>
            </p>

            {actionError && (
              <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
                {actionError}
              </div>
            )}

            <form onSubmit={handleReturnSubmit}>
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label htmlFor="return-destination" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Receiving Yard *
                </label>
                <select
                  id="return-destination"
                  className="select"
                  value={returnLocationId}
                  onChange={(e) => setReturnLocationId(e.target.value)}
                  required
                  style={{ width: '100%' }}
                >
                  <option value="">— Select yard —</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.kind.replace('_', ' ')})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label htmlFor="return-condition" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Inspected Condition *
                </label>
                <select
                  id="return-condition"
                  className="select"
                  value={returnCondition}
                  onChange={(e) => setReturnCondition(e.target.value as EquipmentCondition)}
                  style={{ width: '100%' }}
                >
                  <option value="good">Good (Ready for deployment)</option>
                  <option value="fair">Fair (Minor wear, operational)</option>
                  <option value="needs_repair">Needs Repair (Requires maintenance)</option>
                </select>
              </div>

              <div style={{ marginBottom: 'var(--space-5)' }}>
                <label htmlFor="return-note" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Check-in Inspection Note (Optional)
                </label>
                <input
                  id="return-note"
                  type="text"
                  className="input"
                  placeholder="e.g. Clean inspection, fuel tank full"
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowReturnModal(false)}
                  disabled={actionSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="btn-submit-return"
                  className="btn btn-primary"
                  disabled={actionSubmitting || !returnLocationId}
                >
                  {actionSubmitting ? 'Recording…' : 'Record Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Send to Repair ── */}
      {showRepairModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="repair-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(10, 10, 10, 0.7)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
          }}
          onClick={() => setShowRepairModal(false)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 520,
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="repair-modal-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
              🔧 Send to Repair: {equipment.asset_code}
            </h2>

            {actionError && (
              <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
                {actionError}
              </div>
            )}

            <form onSubmit={handleRepairSubmit}>
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label htmlFor="repair-kind" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Maintenance Type *
                </label>
                <select
                  id="repair-kind"
                  className="select"
                  value={repairKind}
                  onChange={(e) => setRepairKind(e.target.value as 'repair' | 'modification')}
                  style={{ width: '100%' }}
                >
                  <option value="repair">Repair (Mechanical / Hydraulic / Electrical fault)</option>
                  <option value="modification">Modification (Structural / Upgrade / Certification)</option>
                </select>
              </div>

              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label htmlFor="repair-desc" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Work Order Description *
                </label>
                <textarea
                  id="repair-desc"
                  className="input"
                  rows={3}
                  placeholder="Describe failure or service required (e.g. Hydraulic boom cylinder seal leaking under load)"
                  value={repairDescription}
                  onChange={(e) => setRepairDescription(e.target.value)}
                  required
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label htmlFor="repair-workshop" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Workshop Facility
                </label>
                <select
                  id="repair-workshop"
                  className="select"
                  value={repairWorkshopId}
                  onChange={(e) => setRepairWorkshopId(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="">— Primary workshop (auto-assigned) —</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.kind.replace('_', ' ')})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 'var(--space-5)' }}>
                <label htmlFor="repair-note" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Internal Note (Optional)
                </label>
                <input
                  id="repair-note"
                  type="text"
                  className="input"
                  placeholder="e.g. Priority repair for upcoming rental"
                  value={repairNote}
                  onChange={(e) => setRepairNote(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowRepairModal(false)}
                  disabled={actionSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="btn-submit-repair"
                  className="btn btn-primary"
                  disabled={actionSubmitting || !repairDescription.trim()}
                >
                  {actionSubmitting ? 'Recording…' : 'Open Repair Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
