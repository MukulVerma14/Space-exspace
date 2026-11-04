/**
 * InvoicesPage — Admin invoice management view.
 *
 * Requirements (F-I2 & F-I3):
 * - Invoices page (admin): list with a received/issued tab.
 * - Detail drawer with lines.
 * - Status badges (unpaid, paid, void).
 * - "New supplier invoice" form modal with dynamic lines (item, quantity, unit, unit price).
 * - Show computed totals with server as final authority.
 * - Show server errors clearly. Debounce item search; disable submit while in flight.
 * - Never render money for staff, and show file references as plain text.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';
import {
  InvoiceListItem,
  InvoiceDetail,
  InvoiceDirection,
  InvoiceStatus,
  fetchInvoices,
  fetchInvoiceById,
  formatMoney,
} from '../../data/invoicesSource';
import NewSupplierInvoiceModal from '../../components/NewSupplierInvoiceModal';

export default function InvoicesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // State
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Filters
  const [directionTab, setDirectionTab] = useState<InvoiceDirection | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  // Modals & Drawers state
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<InvoiceDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  // Fetch invoices helper
  const loadInvoices = useCallback(() => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);

    fetchInvoices(
      {
        direction: directionTab,
        status: statusFilter,
        limit: 100,
      },
      user?.role
    )
      .then((res) => {
        setInvoices(res.data ?? []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [isAdmin, directionTab, statusFilter, user?.role]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  // Load single invoice details for drawer
  function handleOpenDetail(id: number) {
    setSelectedInvoiceId(id);
    setDrawerLoading(true);
    setDrawerError(null);

    fetchInvoiceById(id, user?.role)
      .then((detail) => {
        setDrawerDetail(detail);
        setDrawerLoading(false);
      })
      .catch((err) => {
        setDrawerError(err instanceof Error ? err.message : String(err));
        setDrawerLoading(false);
      });
  }

  function handleCloseDrawer() {
    setSelectedInvoiceId(null);
    setDrawerDetail(null);
    setDrawerError(null);
  }

  // Handle supplier invoice creation success
  function handleSupplierInvoiceSuccess(newId: number, invNo: string) {
    setIsSupplierModalOpen(false);
    setSuccessNotice(`Supplier invoice '${invNo}' recorded successfully. Stock movements and price history updated.`);
    loadInvoices();
    handleOpenDetail(newId);
  }

  // Client-side text search over fetched page
  const filteredInvoices = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      return (
        inv.invoice_no.toLowerCase().includes(q) ||
        inv.party_name.toLowerCase().includes(q) ||
        (inv.file_url && inv.file_url.toLowerCase().includes(q))
      );
    });
  }, [invoices, debouncedSearch]);

  // Metrics
  const countReceived = invoices.filter((i) => i.direction === 'received').length;
  const countIssued = invoices.filter((i) => i.direction === 'issued').length;
  const countUnpaid = invoices.filter((i) => i.status === 'unpaid').length;

  // Strict role guard: Never render accounting data for non-admin
  if (!isAdmin) {
    return (
      <div className="alert alert-error" style={{ margin: 'var(--space-8)' }}>
        <span>Unauthorized: Commercial invoice records are restricted to administrators.</span>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      {/* ── Page Header ── */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, margin: 0 }}>
              Invoices
            </h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>
              Commercial accounting: supplier purchase receipts and customer rental billing ledger
            </p>
          </div>

          {/* Action button */}
          <button
            type="button"
            id="open-new-supplier-invoice-btn"
            className="btn btn-primary"
            onClick={() => setIsSupplierModalOpen(true)}
          >
            + New Supplier Invoice
          </button>
        </div>
      </div>

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

      {/* ── Summary Counters ── */}
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
            Total Invoices
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
            {invoices.length}
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 600, textTransform: 'uppercase' }}>
            Received (Supplier)
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-primary)' }}>
            {countReceived}
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-info)', fontWeight: 600, textTransform: 'uppercase' }}>
            Issued (Customer)
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-info)' }}>
            {countIssued}
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)', fontWeight: 600, textTransform: 'uppercase' }}>
            Unpaid Invoices
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-warning)' }}>
            {countUnpaid}
          </div>
        </div>
      </div>

      {/* ── Direction Tabs ── */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          borderBottom: '1px solid var(--color-border)',
          marginBottom: 'var(--space-5)',
        }}
      >
        <button
          type="button"
          id="tab-all-invoices"
          className="btn btn-ghost"
          onClick={() => setDirectionTab('all')}
          style={{
            border: 'none',
            borderBottom: directionTab === 'all' ? '2px solid var(--color-primary)' : '2px solid transparent',
            borderRadius: 0,
            color: directionTab === 'all' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            fontWeight: directionTab === 'all' ? 700 : 500,
          }}
        >
          All Invoices
        </button>

        <button
          type="button"
          id="tab-received-invoices"
          className="btn btn-ghost"
          onClick={() => setDirectionTab('received')}
          style={{
            border: 'none',
            borderBottom: directionTab === 'received' ? '2px solid var(--color-primary)' : '2px solid transparent',
            borderRadius: 0,
            color: directionTab === 'received' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            fontWeight: directionTab === 'received' ? 700 : 500,
          }}
        >
          📥 Received (Supplier)
        </button>

        <button
          type="button"
          id="tab-issued-invoices"
          className="btn btn-ghost"
          onClick={() => setDirectionTab('issued')}
          style={{
            border: 'none',
            borderBottom: directionTab === 'issued' ? '2px solid var(--color-primary)' : '2px solid transparent',
            borderRadius: 0,
            color: directionTab === 'issued' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            fontWeight: directionTab === 'issued' ? 700 : 500,
          }}
        >
          📤 Issued (Customer)
        </button>
      </div>

      {/* ── Filters & Search ── */}
      <div
        className="card"
        style={{
          padding: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
          alignItems: 'center',
        }}
      >
        {/* Search */}
        <div style={{ flex: '1 1 240px', minWidth: 200 }} className="input-group">
          <span className="input-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            id="invoices-search-input"
            type="search"
            className="input"
            placeholder="Search by invoice #, party, or file ref..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Status Filter */}
        <div style={{ flex: '0 1 180px', minWidth: 140 }}>
          <select
            id="invoices-status-select"
            className="select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | 'all')}
            aria-label="Filter by invoice status"
          >
            <option value="all">All Statuses</option>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
        </div>

        {/* Reset button */}
        {(search || statusFilter !== 'all' || directionTab !== 'all') && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSearch('');
              setStatusFilter('all');
              setDirectionTab('all');
            }}
            style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)' }}
          >
            Reset
          </button>
        )}
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 'var(--space-6)' }}>
          <span>{error}</span>
        </div>
      )}

      {/* ── Invoices List Table ── */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton" style={{ height: 60, borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 'var(--space-12) var(--space-4)',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 'var(--space-2)' }}>🧾</div>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text)' }}>
            No invoices found
          </div>
          <p style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>
            {search || statusFilter !== 'all' || directionTab !== 'all'
              ? 'Try adjusting your search criteria or resetting filters.'
              : 'No invoices currently recorded.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600 }}>Invoice #</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600 }}>Type</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600 }}>Party</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600 }}>Date</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600, textAlign: 'center' }}>Lines</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600, textAlign: 'right' }}>Total (SAR)</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600, textAlign: 'center' }}>Status</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600 }}>File Ref</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((inv) => (
                  <tr
                    key={inv.id}
                    style={{
                      borderBottom: '1px solid var(--color-border-subtle)',
                      transition: 'background var(--transition-fast)',
                    }}
                  >
                    {/* Invoice # */}
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      {inv.invoice_no}
                    </td>

                    {/* Direction */}
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <span
                        className="role-tag"
                        style={{
                          fontSize: '0.65rem',
                          background: inv.direction === 'received' ? 'var(--color-primary-glow)' : 'var(--color-info-dim)',
                          color: inv.direction === 'received' ? 'var(--color-primary)' : 'var(--color-info)',
                          border: `1px solid ${inv.direction === 'received' ? 'var(--color-primary)' : 'var(--color-info)'}`,
                        }}
                      >
                        {inv.direction === 'received' ? 'Supplier' : 'Customer'}
                      </span>
                    </td>

                    {/* Party */}
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 500 }}>
                      {inv.party_name}
                    </td>

                    {/* Date */}
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {inv.invoice_date}
                    </td>

                    {/* Lines */}
                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                      {inv.line_count}
                    </td>

                    {/* Total Amount */}
                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {formatMoney(inv.total, user?.role)}
                    </td>

                    {/* Status Badge */}
                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center' }}>
                      <StatusBadge status={inv.status} />
                    </td>

                    {/* File reference: Plain text string ONLY */}
                    <td style={{ padding: 'var(--space-3) var(--space-4)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inv.file_url ? (
                        <span
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}
                          title={inv.file_url}
                        >
                          {inv.file_url}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-subtle)' }}>—</span>
                      )}
                    </td>

                    {/* Action */}
                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right' }}>
                      <button
                        type="button"
                        id={`view-invoice-${inv.id}`}
                        className="btn btn-ghost"
                        style={{ padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)' }}
                        onClick={() => handleOpenDetail(inv.id)}
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Invoice Detail Drawer ── */}
      {selectedInvoiceId !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoice-detail-title"
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
                  <span
                    className="role-tag"
                    style={{
                      fontSize: 'var(--text-xs)',
                      background: drawerDetail?.direction === 'received' ? 'var(--color-primary-glow)' : 'var(--color-info-dim)',
                      color: drawerDetail?.direction === 'received' ? 'var(--color-primary)' : 'var(--color-info)',
                    }}
                  >
                    {drawerDetail?.direction === 'received' ? 'Received (Supplier)' : 'Issued (Customer)'}
                  </span>
                  {drawerDetail && <StatusBadge status={drawerDetail.status} />}
                </div>

                <h2 id="invoice-detail-title" style={{ fontSize: 'var(--text-2xl)', marginTop: 'var(--space-2)' }}>
                  Invoice {drawerDetail ? drawerDetail.invoice_no : `#${selectedInvoiceId}`}
                </h2>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                  Party: <strong>{drawerDetail?.party_name}</strong>
                  {drawerDetail?.party_vat_no && ` (VAT: ${drawerDetail.party_vat_no})`}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleCloseDrawer}
                aria-label="Close invoice drawer"
                style={{ padding: 'var(--space-2) var(--space-3)' }}
              >
                ✕
              </button>
            </div>

            {/* Loading / Error states */}
            {drawerLoading ? (
              <div style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
                <div className="spinner spinner-lg" style={{ margin: '0 auto var(--space-4)' }} />
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                  Loading invoice line details...
                </div>
              </div>
            ) : drawerError ? (
              <div className="alert alert-error">
                <span>{drawerError}</span>
              </div>
            ) : drawerDetail ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                {/* Meta details card */}
                <div className="card" style={{ padding: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>Invoice Date: </span>
                      <strong>{drawerDetail.invoice_date}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>Due Date: </span>
                      <strong>{drawerDetail.due_date}</strong>
                    </div>

                    {drawerDetail.rental_id && (
                      <div>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>Rental Contract: </span>
                        <strong>Contract #{drawerDetail.rental_id}</strong>
                      </div>
                    )}

                    {drawerDetail.paid_on && (
                      <div>
                        <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)' }}>Paid On: </span>
                        <strong>{drawerDetail.paid_on}</strong>
                        {drawerDetail.paid_by_name && ` (${drawerDetail.paid_by_name})`}
                      </div>
                    )}

                    {drawerDetail.voided_at && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <span style={{ color: 'var(--color-danger)', fontSize: 'var(--text-xs)' }}>Voided: </span>
                        <strong>{new Date(drawerDetail.voided_at).toLocaleDateString()}</strong>
                        {drawerDetail.voided_by_name && ` by ${drawerDetail.voided_by_name}`}
                        {drawerDetail.void_reason && (
                          <div style={{ color: 'var(--color-danger)', fontStyle: 'italic', marginTop: 'var(--space-1)' }}>
                            Reason: {drawerDetail.void_reason}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* File reference: Plain text only */}
                  {drawerDetail.file_url && (
                    <div style={{ marginTop: 'var(--space-3)', borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-2)' }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'block', marginBottom: 'var(--space-1)' }}>
                        Attached File Reference (Plain Text):
                      </span>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-xs)',
                          background: 'var(--color-surface-2)',
                          padding: 'var(--space-2) var(--space-3)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border)',
                          wordBreak: 'break-all',
                        }}
                      >
                        {drawerDetail.file_url}
                      </div>
                    </div>
                  )}

                  {drawerDetail.notes && (
                    <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                      Notes: {drawerDetail.notes}
                    </div>
                  )}
                </div>

                {/* Financial Totals Cards */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 'var(--space-3)',
                  }}
                >
                  <div className="card" style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Subtotal</div>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {formatMoney(drawerDetail.subtotal, user?.role)}
                    </div>
                  </div>

                  <div className="card" style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>VAT (15%)</div>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-warning)' }}>
                      {formatMoney(drawerDetail.vat_amount, user?.role)}
                    </div>
                  </div>

                  <div className="card" style={{ padding: 'var(--space-3)', textAlign: 'center', background: 'var(--color-surface-2)' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 600 }}>Total Amount</div>
                    <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-primary)' }}>
                      {formatMoney(drawerDetail.total, user?.role)}
                    </div>
                  </div>
                </div>

                {/* Line Items Table */}
                <div>
                  <h3 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>
                    Invoice Line Items ({drawerDetail.lines.length})
                  </h3>

                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                        <thead>
                          <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                            <th style={{ padding: 'var(--space-2) var(--space-3)', width: 40, textAlign: 'center' }}>#</th>
                            <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left' }}>Item / Description</th>
                            <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right' }}>Quantity</th>
                            <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right' }}>Unit Price</th>
                            <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right' }}>Line Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {drawerDetail.lines.map((line) => (
                            <tr key={line.line_no} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                              <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                {line.line_no}
                              </td>

                              <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                {line.item_sku && (
                                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-primary)', marginRight: 'var(--space-2)' }}>
                                    [{line.item_sku}]
                                  </span>
                                )}
                                <span style={{ fontWeight: 500 }}>{line.description}</span>
                              </td>

                              <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                {line.quantity} {line.unit_code}
                              </td>

                              <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                {formatMoney(line.unit_price, user?.role)}
                              </td>

                              <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                                {formatMoney(line.line_total, user?.role)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ── New Supplier Invoice Modal ── */}
      <NewSupplierInvoiceModal
        isOpen={isSupplierModalOpen}
        onClose={() => setIsSupplierModalOpen(false)}
        onSuccess={handleSupplierInvoiceSuccess}
      />
    </div>
  );
}

// ─── Status Badge Component ───────────────────────────────────────────────────

function StatusBadge({ status }: { status: InvoiceStatus }) {
  if (status === 'paid') {
    return (
      <span
        className="badge badge-available"
        style={{ background: 'var(--color-success-dim)', color: 'var(--color-success)' }}
      >
        Paid
      </span>
    );
  }
  if (status === 'void') {
    return (
      <span
        className="badge badge-inactive"
        style={{ background: 'rgba(74,82,117,0.2)', color: 'var(--color-text-muted)' }}
      >
        Void
      </span>
    );
  }
  return (
    <span
      className="badge badge-repair"
      style={{ background: 'var(--color-warning-dim)', color: 'var(--color-warning)' }}
    >
      Unpaid
    </span>
  );
}
