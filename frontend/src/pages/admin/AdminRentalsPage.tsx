/**
 * AdminRentalsPage — Complete rental lifecycle management for Administrators.
 *
 * Requirements (R2):
 * - Rentals list with status & search filters
 * - Summary metric counters
 * - Rental detail drawer with line items, applied rates, and customer contact details
 * - Lifecycle action triggers: Confirm quotation, Dispatch / Pick up, Cancel agreement
 * - Create new rental flow (+ New Rental modal)
 * - Offline-resilient: Cached snapshot fallback or clear "needs internet" notification
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';
import {
  RentalListItem,
  RentalDetail,
  RentalStatus,
  fetchRentals,
  fetchRentalById,
  confirmRental,
  pickupRental,
  cancelRental,
  formatDisplayDate,
  getRentalStatusLabel,
  getRentalStatusBadgeClass,
  formatMoney,
  RentalDataSource,
} from '../../data/rentalsSource';
import NewRentalModal from '../../components/NewRentalModal';
import { ApiRequestError } from '../../api/client';

export interface AdminRentalsPageProps {
  initialRentals?: RentalListItem[];
  initialLoading?: boolean;
  initialDataSource?: RentalDataSource;
  initialSavedAt?: string | null;
  initialError?: string | null;
}

export default function AdminRentalsPage({
  initialRentals,
  initialLoading,
  initialDataSource,
  initialSavedAt,
  initialError,
}: AdminRentalsPageProps = {}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // State
  const [rentals, setRentals] = useState<RentalListItem[]>(initialRentals ?? []);
  const [dataSource, setDataSource] = useState<RentalDataSource>(initialDataSource ?? 'live');
  const [savedAt, setSavedAt] = useState<string | null>(initialSavedAt ?? null);
  const [loading, setLoading] = useState(initialLoading ?? (initialRentals === undefined));
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<RentalStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  // Modals & Drawers
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedRentalId, setSelectedRentalId] = useState<number | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<RentalDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // In-flight action loading
  const [actionLoading, setActionLoading] = useState(false);
  const [pickupNote, setPickupNote] = useState('');
  const [isPickupDialogOpen, setIsPickupDialogOpen] = useState(false);
  const [pickupTargetRentalId, setPickupTargetRentalId] = useState<number | null>(null);

  // Load rentals
  const loadRentalsData = useCallback(() => {
    setLoading(true);
    setError(null);

    fetchRentals(
      {
        status: statusFilter,
        limit: 100,
      },
      user?.id
    )
      .then((res) => {
        setRentals(res.data);
        setDataSource(res.source);
        setSavedAt(res.savedAt);
        if (res.source === 'none' && res.error) {
          setError(res.error);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [statusFilter, user?.id]);

  useEffect(() => {
    if (initialRentals === undefined) {
      loadRentalsData();
    }
  }, [loadRentalsData, initialRentals]);

  // Open detail drawer
  const handleOpenDetail = (id: number) => {
    setSelectedRentalId(id);
    setDrawerLoading(true);
    setDrawerError(null);

    fetchRentalById(id)
      .then((detail) => {
        setDrawerDetail(detail);
        setDrawerLoading(false);
      })
      .catch((err) => {
        setDrawerError(err instanceof Error ? err.message : 'Failed to load rental details');
        setDrawerLoading(false);
      });
  };

  const handleCloseDrawer = () => {
    setSelectedRentalId(null);
    setDrawerDetail(null);
    setDrawerError(null);
  };

  // Action: Confirm quotation
  const handleConfirmRental = async (id: number) => {
    if (!window.confirm(`Confirm rental quotation #${id}? Equipment availability will be verified.`)) {
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      await confirmRental(id);
      setSuccessNotice(`Rental #${id} confirmed successfully.`);
      loadRentalsData();
      if (selectedRentalId === id) {
        handleOpenDetail(id);
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiRequestError ? err.message : String(err);
      setError(`Failed to confirm rental: ${msg}`);
      if (selectedRentalId === id) {
        setDrawerError(msg);
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Pick up / Dispatch
  const handleOpenPickup = (id: number) => {
    setPickupTargetRentalId(id);
    setPickupNote('');
    setIsPickupDialogOpen(true);
  };

  const handleExecutePickup = async () => {
    if (!pickupTargetRentalId) return;
    setActionLoading(true);
    setError(null);
    try {
      await pickupRental(pickupTargetRentalId, pickupNote || undefined);
      setSuccessNotice(`Rental #${pickupTargetRentalId} marked as picked up.`);
      setIsPickupDialogOpen(false);
      setPickupTargetRentalId(null);
      loadRentalsData();
      if (selectedRentalId === pickupTargetRentalId) {
        handleOpenDetail(pickupTargetRentalId);
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiRequestError ? err.message : String(err);
      setError(`Failed to dispatch rental: ${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Cancel rental
  const handleCancelRental = async (id: number) => {
    if (!window.confirm(`Are you sure you want to cancel Rental #${id}? This will release all equipment items back to available inventory.`)) {
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      await cancelRental(id);
      setSuccessNotice(`Rental #${id} cancelled. Equipment released.`);
      loadRentalsData();
      if (selectedRentalId === id) {
        handleOpenDetail(id);
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiRequestError ? err.message : String(err);
      setError(`Failed to cancel rental: ${msg}`);
      if (selectedRentalId === id) {
        setDrawerError(msg);
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered by search term
  const filteredRentals = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rentals;
    return rentals.filter((r) => {
      const idMatch = String(r.id).includes(q);
      const custMatch = r.customer_name?.toLowerCase().includes(q);
      const siteMatch = r.site_name?.toLowerCase().includes(q);
      return idMatch || custMatch || siteMatch;
    });
  }, [rentals, debouncedSearch]);

  // Counts
  const countQuotations = useMemo(() => rentals.filter((r) => r.status === 'quotation').length, [rentals]);
  const countConfirmed = useMemo(() => rentals.filter((r) => r.status === 'confirmed').length, [rentals]);
  const countPickedUp = useMemo(() => rentals.filter((r) => r.status === 'picked_up').length, [rentals]);
  const countReturned = useMemo(() => rentals.filter((r) => r.status === 'returned').length, [rentals]);

  const isOffline = dataSource === 'snapshot';

  return (
    <div className="page-content" style={{ maxWidth: 1200 }}>
      {/* ── Page Header ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, fontFamily: 'var(--font-heading)' }}>
              Rentals Management
            </h1>
            {isOffline && (
              <span className="role-tag" style={{ background: 'var(--color-warning-dim)', color: 'var(--color-warning)' }}>
                Cached Snapshot ({savedAt ? new Date(savedAt).toLocaleTimeString() : 'offline'})
              </span>
            )}
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>
            Agreements, quotations, equipment dispatch, and rental lifecycle.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button
            type="button"
            id="open-new-rental-modal-btn"
            className="btn btn-primary"
            onClick={() => setIsCreateModalOpen(true)}
            disabled={isOffline}
          >
            📋 + New Rental
          </button>
        </div>
      </div>

      {/* ── Offline Banner ── */}
      {isOffline && (
        <div
          className="alert alert-info"
          style={{
            marginBottom: 'var(--space-4)',
            background: 'var(--color-warning-dim)',
            color: 'var(--color-warning)',
            borderColor: 'var(--color-warning)',
          }}
        >
          <span>
            You are currently offline. Showing cached rentals as of {formatDisplayDate(savedAt)}. Actions requiring server confirmation are disabled.
          </span>
        </div>
      )}

      {/* ── Offline No Data Notice ── */}
      {dataSource === 'none' && error && (
        <div
          className="alert alert-error"
          style={{ marginBottom: 'var(--space-6)' }}
        >
          <div>
            <strong>Internet Connection Required:</strong> {error}
          </div>
        </div>
      )}

      {/* ── Success Banner ── */}
      {successNotice && (
        <div
          className="alert alert-info"
          style={{
            marginBottom: 'var(--space-6)',
            background: 'var(--color-success-dim)',
            color: 'var(--color-success)',
            borderColor: 'var(--color-success)',
          }}
        >
          <span>{successNotice}</span>
          <button
            type="button"
            onClick={() => setSuccessNotice(null)}
            className="btn btn-ghost"
            style={{ padding: '0 var(--space-2)', marginLeft: 'auto', border: 'none', color: 'inherit' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Error Banner ── */}
      {error && dataSource !== 'none' && (
        <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)' }}>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="btn btn-ghost"
            style={{ padding: '0 var(--space-2)', marginLeft: 'auto', border: 'none', color: 'inherit' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Metric Summary Cards ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
            Total Agreements
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
            {rentals.length}
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)', fontWeight: 600, textTransform: 'uppercase' }}>
            Quotations
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-warning)' }}>
            {countQuotations}
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-info)', fontWeight: 600, textTransform: 'uppercase' }}>
            Confirmed (Awaiting Dispatch)
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-info)' }}>
            {countConfirmed}
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 600, textTransform: 'uppercase' }}>
            Picked Up / On Site
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-success)' }}>
            {countPickedUp}
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', fontWeight: 600, textTransform: 'uppercase' }}>
            Returned / Completed
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-text-subtle)' }}>
            {countReturned}
          </div>
        </div>
      </div>

      {/* ── Filters Bar ── */}
      <div
        className="card"
        style={{
          padding: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
        }}
      >
        {/* Status Filter Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {[
            { id: 'all', label: 'All' },
            { id: 'quotation', label: 'Quotations' },
            { id: 'confirmed', label: 'Confirmed' },
            { id: 'picked_up', label: 'Picked Up' },
            { id: 'returned', label: 'Returned' },
            { id: 'cancelled', label: 'Cancelled' },
          ].map((tab) => {
            const isActive = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className="btn btn-ghost"
                onClick={() => setStatusFilter(tab.id as RentalStatus | 'all')}
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: isActive ? 700 : 500,
                  background: isActive ? 'var(--color-primary-glow)' : 'transparent',
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  border: isActive ? '1px solid var(--color-primary)' : '1px solid transparent',
                  borderRadius: 'var(--radius-full)',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div style={{ minWidth: 240 }}>
          <input
            type="search"
            placeholder="Search customer, site, or #ID…"
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-3)' }}
          />
        </div>
      </div>

      {/* ── Rentals List Table ── */}
      {loading ? (
        <div style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
          <div className="spinner spinner-lg" style={{ margin: '0 auto var(--space-4)' }} />
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            Loading rentals catalog…
          </div>
        </div>
      ) : filteredRentals.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>📋</div>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>No rental agreements found</h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>
            {search || statusFilter !== 'all' ? 'Try adjusting your search query or status filter.' : 'Create a new rental agreement to begin.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Rental</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Customer</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Delivery Site</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Start Date</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Expected End</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Items</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRentals.map((rental) => (
                  <tr
                    key={rental.id}
                    onClick={() => handleOpenDetail(rental.id)}
                    style={{
                      borderBottom: '1px solid var(--color-border-subtle)',
                      cursor: 'pointer',
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {`#${rental.id}`}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600 }}>
                      {rental.customer_name}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text-muted)' }}>
                      {rental.site_name}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <span className={`role-tag ${getRentalStatusBadgeClass(rental.status)}`}>
                        {getRentalStatusLabel(rental.status)}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text-muted)' }}>
                      {formatDisplayDate(rental.start_date)}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text-muted)' }}>
                      {formatDisplayDate(rental.expected_end)}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <span style={{ fontWeight: 600 }}>{rental.active_items}</span> / {rental.total_items}
                    </td>
                    <td
                      style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                        {rental.status === 'quotation' && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                            onClick={() => handleConfirmRental(rental.id)}
                            disabled={isOffline || actionLoading}
                          >
                            ✓ Confirm
                          </button>
                        )}
                        {rental.status === 'confirmed' && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                            onClick={() => handleOpenPickup(rental.id)}
                            disabled={isOffline || actionLoading}
                          >
                            🚚 Pick Up
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                          onClick={() => handleOpenDetail(rental.id)}
                        >
                          View →
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Detail Drawer ── */}
      {selectedRentalId !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rental-drawer-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(10, 10, 10, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
          onClick={handleCloseDrawer}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 780,
              background: 'var(--color-bg)',
              height: '100%',
              overflowY: 'auto',
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
              padding: 'var(--space-6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span className="role-tag" style={{ background: 'var(--color-primary-glow)', color: 'var(--color-primary)' }}>
                    Rental Agreement
                  </span>
                  {drawerDetail && (
                    <span className={`role-tag ${getRentalStatusBadgeClass(drawerDetail.status)}`}>
                      {getRentalStatusLabel(drawerDetail.status)}
                    </span>
                  )}
                </div>

                <h2 id="rental-drawer-title" style={{ fontSize: 'var(--text-2xl)', marginTop: 'var(--space-2)' }}>
                  Rental Agreement #{selectedRentalId}
                </h2>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                  Customer: <strong>{drawerDetail?.customer_name}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {drawerDetail && drawerDetail.status === 'quotation' && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-xs)' }}
                    onClick={() => handleConfirmRental(drawerDetail.id)}
                    disabled={isOffline || actionLoading}
                  >
                    ✓ Confirm Agreement
                  </button>
                )}
                {drawerDetail && drawerDetail.status === 'confirmed' && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-xs)' }}
                    onClick={() => handleOpenPickup(drawerDetail.id)}
                    disabled={isOffline || actionLoading}
                  >
                    🚚 Dispatch / Pick Up
                  </button>
                )}
                {drawerDetail && (drawerDetail.status === 'quotation' || drawerDetail.status === 'confirmed' || drawerDetail.status === 'picked_up') && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-danger)', fontSize: 'var(--text-xs)' }}
                    onClick={() => handleCancelRental(drawerDetail.id)}
                    disabled={isOffline || actionLoading}
                  >
                    Cancel Agreement
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleCloseDrawer}
                  aria-label="Close rental drawer"
                  style={{ padding: 'var(--space-2) var(--space-3)' }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            {drawerLoading ? (
              <div style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
                <div className="spinner spinner-lg" style={{ margin: '0 auto var(--space-4)' }} />
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                  Loading rental details…
                </div>
              </div>
            ) : drawerError ? (
              <div className="alert alert-error">
                <span>{drawerError}</span>
              </div>
            ) : drawerDetail ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                {/* Meta details card */}
                <div className="card" style={{ padding: 'var(--space-4)', fontSize: 'var(--text-sm)', background: 'var(--color-surface)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', display: 'block' }}>Delivery Site</span>
                      <strong>{drawerDetail.site_name}</strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', display: 'block' }}>Start Date</span>
                      <strong>{formatDisplayDate(drawerDetail.start_date)}</strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', display: 'block' }}>Expected End Date</span>
                      <strong>{formatDisplayDate(drawerDetail.expected_end)}</strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', display: 'block' }}>Customer Contact</span>
                      <strong>{drawerDetail.customer_contact || '—'}</strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', display: 'block' }}>Customer Phone</span>
                      <strong>{drawerDetail.customer_phone || '—'}</strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', display: 'block' }}>Created At</span>
                      <strong>{formatDisplayDate(drawerDetail.created_at)}</strong>
                    </div>
                  </div>
                </div>

                {/* Line Items Card */}
                <div className="card" style={{ padding: 'var(--space-4)', background: 'var(--color-surface)' }}>
                  <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--color-primary)' }}>
                    Allocated Equipment Items ({drawerDetail.items.length})
                  </h3>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 'var(--text-sm)' }}>
                      <thead>
                        <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                          <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Asset Code</th>
                          <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Model & Make</th>
                          <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Type</th>
                          <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Agreed Rate</th>
                          <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Discount Note</th>
                          <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drawerDetail.items.map((it) => (
                          <tr key={it.equipment_id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                              <Link
                                to={`/admin/equipment/${encodeURIComponent(it.asset_code)}`}
                                style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
                              >
                                {it.asset_code}
                              </Link>
                            </td>
                            <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                              {it.make} {it.model}
                            </td>
                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-muted)' }}>
                              {it.type_name}
                            </td>
                            <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600 }}>
                              {isAdmin && it.applied_rate !== undefined ? (
                                <span>
                                  {formatMoney(it.applied_rate, user?.role)} / {it.rate_unit}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-muted)', fontStyle: it.discount_note ? 'italic' : 'normal' }}>
                              {isAdmin && it.discount_note ? it.discount_note : '—'}
                            </td>
                            <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                              {it.returned_at ? (
                                <span className="role-tag" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-subtle)' }}>
                                  Returned ({formatDisplayDate(it.returned_at)})
                                </span>
                              ) : (
                                <span className="role-tag" style={{ background: 'var(--color-success-dim)', color: 'var(--color-success)' }}>
                                  Active on Site
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Pickup Note Dialog ── */}
      {isPickupDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            background: 'rgba(10, 10, 10, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
          }}
          onClick={() => setIsPickupDialogOpen(false)}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: 480, padding: 'var(--space-5)', background: 'var(--color-bg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
              Dispatch Rental #{pickupTargetRentalId}
            </h3>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
              Confirm equipment dispatch from yard. Location movement logs will be generated.
            </p>

            <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
              <label htmlFor="pickup-note-input" className="form-label">
                Dispatch / Gate Note (Optional)
              </label>
              <input
                id="pickup-note-input"
                type="text"
                placeholder="e.g. Transported via Lowbed Trailer #4"
                className="input"
                value={pickupNote}
                onChange={(e) => setPickupNote(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsPickupDialogOpen(false)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleExecutePickup}
                disabled={actionLoading}
              >
                {actionLoading ? 'Dispatching…' : 'Confirm Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Rental Modal ── */}
      <NewRentalModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={(rentalId, st) => {
          setSuccessNotice(`Rental #${rentalId} created successfully with status '${st}'.`);
          loadRentalsData();
        }}
      />
    </div>
  );
}
