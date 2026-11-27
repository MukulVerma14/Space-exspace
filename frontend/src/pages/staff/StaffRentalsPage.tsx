/**
 * StaffRentalsPage — Operational view of active rentals for Yard Staff.
 *
 * Requirements (R2):
 * - Read-only view of active rentals (confirmed, picked up).
 * - STRICT POLICY: Zero money (no rates, prices, costs, or currency amounts).
 * - STRICT POLICY: Zero customer contact info (no customer phone, email, or contact person).
 * - Operational features: Rental ID, customer name, delivery site, dates, equipment asset codes/models.
 * - Action: Dispatch / Pick up button when confirmed machines leave the yard.
 * - Offline handling: Shows cached snapshot with read-only badge or clear "needs internet" notification.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';
import {
  RentalListItem,
  RentalDetail,
  fetchRentals,
  fetchRentalById,
  pickupRental,
  formatDisplayDate,
  isRentalOverdue,
  getDaysOverdue,
  getRentalStatusLabel,
  getRentalStatusBadgeClass,
  RentalDataSource,
} from '../../data/rentalsSource';
import { ApiRequestError } from '../../api/client';

export interface StaffRentalsPageProps {
  initialRentals?: RentalListItem[];
  initialLoading?: boolean;
  initialDataSource?: RentalDataSource;
  initialSavedAt?: string | null;
  initialError?: string | null;
}

export default function StaffRentalsPage({
  initialRentals,
  initialLoading,
  initialDataSource,
  initialSavedAt,
  initialError,
}: StaffRentalsPageProps = {}) {
  const { user } = useAuth();

  // State
  const [rentals, setRentals] = useState<RentalListItem[]>(initialRentals ?? []);
  const [dataSource, setDataSource] = useState<RentalDataSource>(initialDataSource ?? 'live');
  const [savedAt, setSavedAt] = useState<string | null>(initialSavedAt ?? null);
  const [loading, setLoading] = useState(initialLoading ?? (initialRentals === undefined));
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all_active' | 'overdue' | 'confirmed' | 'picked_up'>('all_active');
  const debouncedSearch = useDebounce(search, 300);

  // Drawer
  const [selectedRentalId, setSelectedRentalId] = useState<number | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<RentalDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Pickup Dialog
  const [isPickupDialogOpen, setIsPickupDialogOpen] = useState(false);
  const [pickupTargetRentalId, setPickupTargetRentalId] = useState<number | null>(null);
  const [pickupNote, setPickupNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch rentals data (staff view restricts to active rentals)
  const loadStaffRentals = useCallback(() => {
    setLoading(true);
    setError(null);

    fetchRentals(
      {
        limit: 100,
      },
      user?.id
    )
      .then((res) => {
        // Staff page focuses on active operational rentals (confirmed & picked_up)
        const activeOnly = res.data.filter(
          (r) => r.status === 'confirmed' || r.status === 'picked_up'
        );
        setRentals(activeOnly);
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
  }, [user?.id]);

  useEffect(() => {
    if (initialRentals === undefined) {
      loadStaffRentals();
    }
  }, [loadStaffRentals, initialRentals]);

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

  // Pickup dispatch action
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
      setSuccessNotice(`Rental #${pickupTargetRentalId} marked as dispatched / picked up.`);
      setIsPickupDialogOpen(false);
      setPickupTargetRentalId(null);
      loadStaffRentals();
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

  // Filtered rentals
  const filteredRentals = useMemo(() => {
    let list = rentals;
    if (statusFilter === 'overdue') {
      list = list.filter((r) => isRentalOverdue(r.expected_end, r.status));
    } else if (statusFilter !== 'all_active') {
      list = list.filter((r) => r.status === statusFilter);
    }
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const idMatch = String(r.id).includes(q);
      const custMatch = r.customer_name?.toLowerCase().includes(q);
      const siteMatch = r.site_name?.toLowerCase().includes(q);
      return idMatch || custMatch || siteMatch;
    });
  }, [rentals, statusFilter, debouncedSearch]);

  const countConfirmed = useMemo(() => rentals.filter((r) => r.status === 'confirmed').length, [rentals]);
  const countPickedUp = useMemo(() => rentals.filter((r) => r.status === 'picked_up').length, [rentals]);
  const countOverdue = useMemo(() => rentals.filter((r) => isRentalOverdue(r.expected_end, r.status)).length, [rentals]);

  const isOffline = dataSource === 'snapshot';

  return (
    <div className="page-content" style={{ maxWidth: 1100 }}>
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
              Active Rentals
            </h1>
            {isOffline && (
              <span className="role-tag" style={{ background: 'var(--color-warning-dim)', color: 'var(--color-warning)' }}>
                Cached Snapshot (Offline)
              </span>
            )}
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>
            Yard dispatch orders and equipment currently active on client sites.
          </p>
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
            You are offline. Showing cached active rentals as of {formatDisplayDate(savedAt)}. Dispatch actions will require network connectivity.
          </span>
        </div>
      )}

      {/* ── Offline No Data Notice ── */}
      {dataSource === 'none' && error && (
        <div className="alert alert-error" style={{ marginBottom: 'var(--space-6)' }}>
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div className="card" style={{ padding: 'var(--space-4)', borderColor: countOverdue > 0 ? 'rgba(220, 38, 38, 0.4)' : undefined }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-danger)', fontWeight: 600, textTransform: 'uppercase' }}>
            Overdue Returns
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-danger)' }}>
            {countOverdue}
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-info)', fontWeight: 600, textTransform: 'uppercase' }}>
            Awaiting Yard Dispatch
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-info)' }}>
            {countConfirmed}
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 600, textTransform: 'uppercase' }}>
            Active on Client Sites
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-success)' }}>
            {countPickedUp}
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
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {[
            { id: 'all_active', label: 'All Active' },
            { id: 'overdue', label: countOverdue > 0 ? `⚠️ Overdue (${countOverdue})` : 'Overdue' },
            { id: 'confirmed', label: 'Awaiting Dispatch' },
            { id: 'picked_up', label: 'On Site' },
          ].map((tab) => {
            const isActive = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className="btn btn-ghost"
                onClick={() => setStatusFilter(tab.id as typeof statusFilter)}
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

      {/* ── Active Rentals List ── */}
      {loading ? (
        <div style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
          <div className="spinner spinner-lg" style={{ margin: '0 auto var(--space-4)' }} />
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            Loading active rentals…
          </div>
        </div>
      ) : filteredRentals.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>📋</div>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>No active rentals found</h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>
            All equipment agreements are either returned or awaiting confirmation.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Rental #</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Customer</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Destination Site</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Start Date</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Expected End</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700 }}>Assigned Items</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 700, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRentals.map((rental) => {
                  const isOverdue = isRentalOverdue(rental.expected_end, rental.status);
                  return (
                  <tr
                    key={rental.id}
                    onClick={() => handleOpenDetail(rental.id)}
                    style={{
                      borderBottom: '1px solid var(--color-border-subtle)',
                      cursor: 'pointer',
                      background: isOverdue ? 'rgba(220, 38, 38, 0.04)' : undefined,
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = isOverdue ? 'rgba(220, 38, 38, 0.04)' : 'transparent')}
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
                      <span className={`role-tag ${getRentalStatusBadgeClass(rental.status, isOverdue)}`}>
                        {getRentalStatusLabel(rental.status, isOverdue)}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text-muted)' }}>
                      {formatDisplayDate(rental.start_date)}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      {isOverdue ? (
                        <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>
                          ⚠️ {formatDisplayDate(rental.expected_end)} (Overdue)
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)' }}>{formatDisplayDate(rental.expected_end)}</span>
                      )}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <span style={{ fontWeight: 600 }}>{rental.active_items}</span> / {rental.total_items}
                    </td>
                    <td
                      style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                        {rental.status === 'confirmed' && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                            onClick={() => handleOpenPickup(rental.id)}
                            disabled={isOffline || actionLoading}
                          >
                            🚚 Pick Up / Dispatch
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
                );
                })}
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
          aria-labelledby="staff-rental-drawer-title"
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
              maxWidth: 720,
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
                    Active Order
                  </span>
                  {drawerDetail && (
                    <span className={`role-tag ${getRentalStatusBadgeClass(drawerDetail.status)}`}>
                      {getRentalStatusLabel(drawerDetail.status)}
                    </span>
                  )}
                </div>

                <h2 id="staff-rental-drawer-title" style={{ fontSize: 'var(--text-2xl)', marginTop: 'var(--space-2)' }}>
                  Rental Order #{selectedRentalId}
                </h2>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                  Customer: <strong>{drawerDetail?.customer_name}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
                {/* Overdue Alert */}
                {isRentalOverdue(drawerDetail.expected_end, drawerDetail.status) && (
                  <div className="alert alert-error">
                    <span>
                      ⚠️ <strong>Return Overdue:</strong> Scheduled return was{' '}
                      <strong>{formatDisplayDate(drawerDetail.expected_end)}</strong> ({getDaysOverdue(drawerDetail.expected_end)} days overdue).
                    </span>
                  </div>
                )}

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
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', display: 'block' }}>Agreement Created</span>
                      <strong>{formatDisplayDate(drawerDetail.created_at)}</strong>
                    </div>
                  </div>
                </div>

                {/* Line Items Card */}
                <div className="card" style={{ padding: 'var(--space-4)', background: 'var(--color-surface)' }}>
                  <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--color-primary)' }}>
                    Assigned Equipment ({drawerDetail.items.length})
                  </h3>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 'var(--text-sm)' }}>
                      <thead>
                        <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                          <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Asset Code</th>
                          <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Make & Model</th>
                          <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Type</th>
                          <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drawerDetail.items.map((it) => (
                          <tr key={it.equipment_id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                              <Link
                                to={`/staff/equipment/${encodeURIComponent(it.asset_code)}`}
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
              <label htmlFor="staff-pickup-note-input" className="form-label">
                Dispatch / Gate Note (Optional)
              </label>
              <input
                id="staff-pickup-note-input"
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
    </div>
  );
}
