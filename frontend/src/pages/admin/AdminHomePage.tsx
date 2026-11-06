/**
 * AdminHomePage — Operations Director Dashboard (F-S3)
 *
 * SPECIFICATION (F-S3):
 * - Status counts breakdown: Available, Rented, Under Repair, Total Fleet
 * - Overdue returns: active rented assets past their expected return date
 * - Low-stock items: inventory items with stock on hand <= reorder level
 * - Offline sync & outbox monitor: pending actions and rejected events with server reasons
 * - Real-time discard capability for rejected sync events
 * - Offline resilience: loads from local IndexedDB snapshot when offline
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useOutbox } from '../../hooks/useOutbox';
import { discardEvent } from '../../offline/outbox';
import { runSync } from '../../sync/syncManager';
import {
  loadDashboardData,
  DashboardData,
  StatusCounts,
  OverdueReturnItem,
} from '../../data/dashboardSource';
import { MaterialItem } from '../../data/materialsSource';

export default function AdminHomePage() {
  const { user } = useAuth();
  const userId = user?.id || 1;

  // Real-time outbox status
  const { events, pending, rejected } = useOutbox(userId);

  // Dashboard Aggregates
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    try {
      const res = await loadDashboardData(userId);
      setData(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      await runSync(userId);
      await loadData();
    } finally {
      setSyncing(false);
    }
  }

  const counts: StatusCounts = data?.statusCounts || {
    total: 0,
    available: 0,
    rented: 0,
    under_repair: 0,
  };

  const overdueReturns: OverdueReturnItem[] = data?.overdueReturns || [];
  const lowStockItems: MaterialItem[] = data?.lowStockItems || [];
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  return (
    <div className="animate-fade-up">
      {/* ── Top Dashboard Header ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
            <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: 0 }}>
              Welcome back, {user?.name ? user.name.split(' ')[0] : 'Admin'}
            </h1>
            <span
              className="badge"
              style={{
                background: 'var(--color-primary-dim)',
                color: 'var(--color-primary)',
                border: '1px solid var(--color-border)',
                fontWeight: 600,
                fontSize: 'var(--text-xs)',
              }}
            >
              Operations Director
            </span>
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
            Fleet status, overdue return tracking, stock health, and offline sync operations.
          </p>
        </div>

        {/* Status / Sync Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {isOffline ? (
            <span
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-warning)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>○</span> Offline Mode (Cached Snapshot)
            </span>
          ) : (
            <span
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-success)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>●</span> Live Sync Connected
            </span>
          )}

          <button
            type="button"
            id="btn-refresh-dashboard"
            className="btn btn-secondary btn-sm"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span>🔄</span>
            <span>{refreshing ? 'Updating…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* ── SECTION 1: Status Counts Breakdown ── */}
      <section style={{ marginBottom: 'var(--space-8)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--space-4)' }}>
          🏗️ Fleet Operational Status
        </h2>

        <div
          id="fleet-status-counters"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {/* Total Fleet */}
          <Link
            to="/admin/equipment"
            className="card"
            style={{
              textDecoration: 'none',
              color: 'inherit',
              transition: 'transform var(--transition-base)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Total Fleet
              </span>
              <span style={{ fontSize: 22 }}>🚜</span>
            </div>
            <div id="count-total-fleet" style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--color-text)' }}>
              {loading ? '…' : counts.total}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 4 }}>
              Active registered machines
            </div>
          </Link>

          {/* Available */}
          <Link
            to="/admin/equipment"
            className="card"
            style={{
              textDecoration: 'none',
              color: 'inherit',
              borderColor: 'rgba(5, 150, 105, 0.3)',
              background: 'linear-gradient(to bottom right, #ffffff, rgba(5, 150, 105, 0.04))',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-success)', textTransform: 'uppercase' }}>
                Available
              </span>
              <span className="badge badge-available">Ready</span>
            </div>
            <div id="count-available" style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--color-success)' }}>
              {loading ? '…' : counts.available}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 4 }}>
              In yard, ready for dispatch
            </div>
          </Link>

          {/* Rented / On Hire */}
          <Link
            to="/admin/equipment"
            className="card"
            style={{
              textDecoration: 'none',
              color: 'inherit',
              borderColor: 'rgba(180, 83, 9, 0.3)',
              background: 'linear-gradient(to bottom right, #ffffff, rgba(180, 83, 9, 0.04))',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-warning)', textTransform: 'uppercase' }}>
                Rented (On-Site)
              </span>
              <span className="badge badge-rented">On Hire</span>
            </div>
            <div id="count-rented" style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--color-warning)' }}>
              {loading ? '…' : counts.rented}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 4 }}>
              Deployed across client projects
            </div>
          </Link>

          {/* Under Repair */}
          <Link
            to="/admin/equipment"
            className="card"
            style={{
              textDecoration: 'none',
              color: 'inherit',
              borderColor: 'rgba(220, 38, 38, 0.3)',
              background: 'linear-gradient(to bottom right, #ffffff, rgba(220, 38, 38, 0.04))',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-danger)', textTransform: 'uppercase' }}>
                Under Repair
              </span>
              <span className="badge badge-repair">Workshop</span>
            </div>
            <div id="count-repair" style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--color-danger)' }}>
              {loading ? '…' : counts.under_repair}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 4 }}>
              Active maintenance work orders
            </div>
          </Link>
        </div>
      </section>

      {/* ── SECTION 2: Offline Outbox & Sync Monitor ── */}
      <section style={{ marginBottom: 'var(--space-8)' }} id="dashboard-outbox-section">
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🔄</span> Offline Sync &amp; Outbox Monitor
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {pending > 0 && !isOffline && (
                <button
                  type="button"
                  id="btn-sync-outbox-now"
                  className="btn btn-primary btn-sm"
                  onClick={handleSyncNow}
                  disabled={syncing}
                >
                  {syncing ? 'Syncing…' : 'Sync Now'}
                </button>
              )}
            </div>
          </div>

          {/* Rejected Actions Banner */}
          {rejected > 0 && (
            <div
              id="dashboard-rejected-alerts"
              role="alert"
              style={{
                padding: 'var(--space-4)',
                marginBottom: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-danger-dim)',
                border: '1px solid var(--color-danger)',
                color: 'var(--color-danger)',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
                ⚠️ {rejected} Action(s) Rejected by Server
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {events
                  .filter((e) => e.status === 'rejected')
                  .map((rej) => (
                    <div
                      key={rej.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 'var(--space-2) var(--space-3)',
                        background: 'rgba(255, 255, 255, 0.7)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      <div>
                        <strong>{rej.type.replace('_', ' ')}</strong> on <code>{rej.assetCode}</code>
                        <div style={{ color: 'var(--color-danger)', marginTop: 2 }}>
                          Server Reason: {rej.rejectReason || 'Validation rejected'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => discardEvent(rej.id)}
                        style={{ marginLeft: 'var(--space-3)' }}
                      >
                        Discard
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Pending Actions View */}
          {pending > 0 ? (
            <div
              id="dashboard-pending-alerts"
              style={{
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-warning-dim)',
                border: '1px solid var(--color-warning)',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
                ⏳ {pending} Action(s) Queued in Local Outbox
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {events
                  .filter((e) => e.status === 'pending')
                  .map((pen) => (
                    <div
                      key={pen.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 'var(--space-2) var(--space-3)',
                        background: 'rgba(255, 255, 255, 0.7)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      <div>
                        <strong>{pen.type.replace('_', ' ')}</strong> on <code>{pen.assetCode}</code>
                        <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>
                          Recorded {new Date(pen.occurredAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <span className="badge badge-repair" style={{ fontSize: 'var(--text-xs)' }}>
                        Pending
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ) : rejected === 0 ? (
            <div
              id="dashboard-outbox-synced"
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border-subtle)',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>✓</span>
              <span>Outbox Synchronized — All local staff movements and actions are up to date on the server.</span>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Two Column Section: Overdue Returns & Low Stock ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 'var(--space-6)',
          marginBottom: 'var(--space-8)',
        }}
      >
        {/* ── SECTION 3: Overdue Equipment Returns ── */}
        <section id="dashboard-overdue-section" className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
            <div>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>⏱️</span> Overdue Returns ({overdueReturns.length})
              </h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', margin: 0 }}>
                Rented assets past their expected agreement return date
              </p>
            </div>
            {overdueReturns.length > 0 && (
              <span className="badge badge-repair" id="badge-overdue-count">
                {overdueReturns.length} Overdue
              </span>
            )}
          </div>

          {loading ? (
            <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
              Loading overdue returns…
            </div>
          ) : overdueReturns.length === 0 ? (
            <div
              id="dashboard-no-overdue"
              style={{
                padding: 'var(--space-6)',
                textAlign: 'center',
                color: 'var(--color-text-muted)',
                background: 'var(--color-surface-2)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 4 }}>✓</div>
              <p style={{ fontWeight: 600, margin: 0 }}>No Overdue Returns</p>
              <p style={{ fontSize: 'var(--text-xs)', margin: 0, marginTop: 2 }}>
                All active equipment rentals are on schedule.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Asset</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Customer / Site</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Due Date</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueReturns.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        <Link
                          to={`/admin/equipment/${encodeURIComponent(item.asset_code)}`}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 700,
                            color: 'var(--color-primary)',
                            textDecoration: 'none',
                          }}
                        >
                          {item.asset_code}
                        </Link>
                        {item.make && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                            {item.make} {item.model}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        <div style={{ fontWeight: 600 }}>{item.customer_name}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                          {item.site_name}
                        </div>
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 600, color: 'var(--color-danger)' }}>
                          {new Date(item.expected_end).toLocaleDateString()}
                        </div>
                        <span
                          style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-danger)',
                            fontWeight: 600,
                          }}
                        >
                          {item.days_overdue}d overdue
                        </span>
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        <Link
                          to={`/admin/equipment/${encodeURIComponent(item.asset_code)}`}
                          className="btn btn-secondary btn-sm"
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          Check In
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── SECTION 4: Low-Stock Materials ── */}
        <section id="dashboard-lowstock-section" className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
            <div>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📦</span> Low-Stock Items ({lowStockItems.length})
              </h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', margin: 0 }}>
                Inventory below or at minimum reorder thresholds
              </p>
            </div>
            {lowStockItems.length > 0 && (
              <span className="badge badge-repair" id="badge-lowstock-count">
                {lowStockItems.length} Low
              </span>
            )}
          </div>

          {loading ? (
            <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
              Loading materials inventory…
            </div>
          ) : lowStockItems.length === 0 ? (
            <div
              id="dashboard-no-lowstock"
              style={{
                padding: 'var(--space-6)',
                textAlign: 'center',
                color: 'var(--color-text-muted)',
                background: 'var(--color-surface-2)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 4 }}>✓</div>
              <p style={{ fontWeight: 600, margin: 0 }}>Healthy Stock Levels</p>
              <p style={{ fontSize: 'var(--text-xs)', margin: 0, marginTop: 2 }}>
                All inventory items are currently above reorder levels.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Item</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Stock on Hand</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Reorder At</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockItems.map((mat) => (
                    <tr key={mat.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-primary)' }}>
                          {mat.sku}
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 'var(--text-xs)' }}>{mat.name}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                          {mat.category_name}
                        </div>
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        <span
                          style={{
                            fontWeight: 700,
                            color: 'var(--color-danger)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {mat.current_stock}
                        </span>{' '}
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                          {mat.unit_code}
                        </span>
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-muted)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{mat.reorder_level}</span>{' '}
                        <span style={{ fontSize: 'var(--text-xs)' }}>{mat.unit_code}</span>
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        <Link to="/admin/materials" className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* ── SECTION 5: Quick-Nav Navigation ── */}
      <section style={{ marginTop: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--color-text-muted)' }}>
          ⚡ Operations Quick Actions
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          <QuickCard
            id="nav-scan"
            to="/admin/scan"
            icon="📷"
            title="Scan QR Code"
            desc="Camera scan & lookup"
            color="var(--color-primary)"
          />
          <QuickCard
            id="nav-equipment"
            to="/admin/equipment"
            icon="🏗️"
            title="Equipment Fleet"
            desc="Fleet search & filters"
            color="var(--color-info)"
          />
          <QuickCard
            id="nav-rentals"
            to="/admin/rentals"
            icon="📋"
            title="Rentals"
            desc="Contracts & return"
            color="var(--color-warning)"
          />
          <QuickCard
            id="nav-materials"
            to="/admin/materials"
            icon="📦"
            title="Materials"
            desc="Stock & price history"
            color="var(--color-success)"
          />
          <QuickCard
            id="nav-invoices"
            to="/admin/invoices"
            icon="🧾"
            title="Invoices"
            desc="Commercial accounting"
            color="var(--color-primary-dim)"
          />
        </div>
      </section>
    </div>
  );
}

function QuickCard({
  id,
  to,
  icon,
  title,
  desc,
  color,
}: {
  id: string;
  to: string;
  icon: string;
  title: string;
  desc: string;
  color: string;
}) {
  return (
    <NavLink
      id={id}
      to={to}
      style={{
        display: 'block',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        transition: 'all var(--transition-base)',
        textDecoration: 'none',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = color;
        (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 1px ${color}22, var(--shadow-sm)`;
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-subtle)';
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLElement).style.transform = 'none';
      }}
    >
      <div style={{ fontSize: 24, marginBottom: 'var(--space-2)' }}>{icon}</div>
      <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 2, color: 'var(--color-text)' }}>
        {title}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{desc}</div>
    </NavLink>
  );
}
