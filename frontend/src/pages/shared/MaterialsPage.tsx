/**
 * MaterialsPage — shared between /admin/materials and /staff/materials.
 *
 * Requirements (F-I1):
 * - Stock list with live inventory on hand.
 * - Prominent low-stock badge when current_stock <= reorder_level.
 * - Price history view per item (GET /api/materials/:id/price-history).
 * - Admin only for prices; staff see quantities and physical movements only.
 * - Never render money for staff; show file references as plain text.
 */

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';
import {
  MaterialItem,
  MaterialPriceHistoryResponse,
  MaterialMovement,
  MaterialsDataSource,
  loadMaterials,
  fetchMaterialPriceHistory,
  fetchMaterialMovements,
  formatMoney,
} from '../../data/materialsSource';

export default function MaterialsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // State
  const [items, setItems] = useState<MaterialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<MaterialsDataSource>('none');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Detail drawer / modal
  const [activeItem, setActiveItem] = useState<MaterialItem | null>(null);
  const [drawerTab, setDrawerTab] = useState<'prices' | 'ledger'>(isAdmin ? 'prices' : 'ledger');
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [priceHistory, setPriceHistory] = useState<MaterialPriceHistoryResponse | null>(null);
  const [movements, setMovements] = useState<MaterialMovement[]>([]);

  const debouncedSearch = useDebounce(search, 300);

  // Fetch materials on mount and user change
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadMaterials(user.id)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setSource(res.source);
        setSavedAt(res.savedAt);
        setError(res.error ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Open drawer and load details
  function handleOpenDetail(item: MaterialItem, defaultTab?: 'prices' | 'ledger') {
    setActiveItem(item);
    const targetTab = isAdmin ? (defaultTab ?? 'prices') : 'ledger';
    setDrawerTab(targetTab);
    loadDetailData(item.id, targetTab);
  }

  function handleCloseDrawer() {
    setActiveItem(null);
    setPriceHistory(null);
    setMovements([]);
    setDrawerError(null);
  }

  function handleSwitchTab(tab: 'prices' | 'ledger') {
    if (!isAdmin && tab === 'prices') return; // Strict guard
    setDrawerTab(tab);
    if (activeItem) {
      loadDetailData(activeItem.id, tab);
    }
  }

  function loadDetailData(itemId: number, tab: 'prices' | 'ledger') {
    if (!user) return;
    setDrawerLoading(true);
    setDrawerError(null);

    if (tab === 'prices' && isAdmin) {
      fetchMaterialPriceHistory(itemId, user.role)
        .then((res) => {
          setPriceHistory(res);
          setDrawerLoading(false);
        })
        .catch((err) => {
          setDrawerError(err instanceof Error ? err.message : String(err));
          setDrawerLoading(false);
        });
    } else {
      fetchMaterialMovements(itemId)
        .then((data) => {
          setMovements(data);
          setDrawerLoading(false);
        })
        .catch((err) => {
          setDrawerError(err instanceof Error ? err.message : String(err));
          setDrawerLoading(false);
        });
    }
  }

  // Categories list derived from items
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => {
      if (it.category_name) set.add(it.category_name);
    });
    return Array.from(set).sort();
  }, [items]);

  // Filtered materials
  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return items.filter((item) => {
      const matchesSearch =
        !q ||
        item.sku.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.category_name && item.category_name.toLowerCase().includes(q));

      const matchesStock = !onlyLowStock || item.is_low_stock;
      const matchesCategory =
        selectedCategory === 'all' || item.category_name === selectedCategory;

      return matchesSearch && matchesStock && matchesCategory;
    });
  }, [items, debouncedSearch, onlyLowStock, selectedCategory]);

  // Stock summary counts
  const totalCount = items.length;
  const lowStockCount = items.filter((it) => it.is_low_stock).length;
  const healthyCount = totalCount - lowStockCount;

  return (
    <div className="animate-fade-up">
      {/* ── Page Header ── */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, margin: 0 }}>
              {isAdmin ? 'Materials Inventory' : 'Stock Levels'}
            </h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>
              {isAdmin
                ? 'Live warehouse stock on hand, reorder thresholds & supplier price tracking'
                : 'Consumable inventory and physical stock levels'}
            </p>
          </div>

          {/* Source indicator */}
          {source === 'snapshot' && savedAt && (
            <div
              className="alert alert-info"
              style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-xs)' }}
            >
              Offline copy saved {new Date(savedAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>

      {/* ── Metric Summary Pills ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div
          className="card"
          style={{
            padding: 'var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total SKUs
            </div>
            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
              {totalCount}
            </div>
          </div>
          <span style={{ fontSize: 24 }} aria-hidden="true">📦</span>
        </div>

        <button
          type="button"
          onClick={() => setOnlyLowStock((prev) => !prev)}
          className="card"
          style={{
            padding: 'var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: onlyLowStock ? '2px solid var(--color-danger)' : '1px solid var(--color-border-subtle)',
            background: onlyLowStock ? 'var(--color-danger-dim)' : 'var(--color-surface)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
          title="Click to toggle low stock filter"
        >
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-danger)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Low Stock Alert
            </div>
            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-danger)' }}>
              {lowStockCount}
            </div>
          </div>
          <span style={{ fontSize: 24 }} aria-hidden="true">⚠️</span>
        </button>

        <div
          className="card"
          style={{
            padding: 'var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              In Good Standing
            </div>
            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-success)' }}>
              {healthyCount}
            </div>
          </div>
          <span style={{ fontSize: 24 }} aria-hidden="true">✅</span>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
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
            id="materials-search-input"
            type="search"
            className="input"
            placeholder="Search by SKU, item name, or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Category filter */}
        <div style={{ flex: '0 1 180px', minWidth: 140 }}>
          <select
            id="materials-category-select"
            className="select"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Low Stock toggle button */}
        <button
          type="button"
          id="toggle-low-stock-btn"
          className={`btn ${onlyLowStock ? 'btn-danger' : 'btn-ghost'}`}
          onClick={() => setOnlyLowStock((prev) => !prev)}
          style={{ whiteSpace: 'nowrap' }}
        >
          {onlyLowStock ? 'Showing Low Stock Only' : 'Filter Low Stock'}
        </button>

        {/* Reset filters if active */}
        {(search || onlyLowStock || selectedCategory !== 'all') && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSearch('');
              setOnlyLowStock(false);
              setSelectedCategory('all');
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

      {/* ── Loading Skeleton ── */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton" style={{ height: 64, borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 'var(--space-12) var(--space-4)',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 'var(--space-2)' }}>📦</div>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text)' }}>
            No materials found
          </div>
          <p style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>
            {search || onlyLowStock || selectedCategory !== 'all'
              ? 'Try adjusting your search criteria or resetting filters.'
              : 'No material items currently registered.'}
          </p>
        </div>
      ) : (
        /* ── Materials Table / Cards ── */
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600 }}>SKU</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600 }}>Item Name</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600 }}>Category</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600, textAlign: 'right' }}>Current Stock</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600, textAlign: 'right' }}>Reorder Level</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600, textAlign: 'center' }}>Status</th>
                  <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 600, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const stockNum = parseFloat(String(item.current_stock));
                  const reorderNum = parseFloat(String(item.reorder_level));

                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid var(--color-border-subtle)',
                        background: item.is_low_stock ? 'rgba(220, 38, 38, 0.03)' : 'transparent',
                        transition: 'background var(--transition-fast)',
                      }}
                    >
                      {/* SKU */}
                      <td style={{ padding: 'var(--space-3) var(--space-4)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {item.sku}
                      </td>

                      {/* Name */}
                      <td style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 500 }}>
                        {item.name}
                      </td>

                      {/* Category */}
                      <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text-muted)' }}>
                        {item.category_name}
                      </td>

                      {/* Current Stock */}
                      <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        <span style={{ color: item.is_low_stock ? 'var(--color-danger)' : 'var(--color-text)' }}>
                          {isNaN(stockNum) ? item.current_stock : stockNum.toLocaleString()} {item.unit_code}
                        </span>
                      </td>

                      {/* Reorder Level */}
                      <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {isNaN(reorderNum) ? item.reorder_level : reorderNum.toLocaleString()} {item.unit_code}
                      </td>

                      {/* Low-stock Badge */}
                      <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center' }}>
                        {item.is_low_stock ? (
                          <span
                            className="badge badge-repair"
                            style={{ background: 'var(--color-danger-dim)', color: 'var(--color-danger)' }}
                            title={`Stock (${stockNum}) is at or below reorder level (${reorderNum})`}
                          >
                            Low Stock
                          </span>
                        ) : (
                          <span className="badge badge-available">In Stock</span>
                        )}
                      </td>

                      {/* Action */}
                      <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right' }}>
                        {isAdmin ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)' }}
                            onClick={() => handleOpenDetail(item, 'prices')}
                            id={`view-price-history-${item.id}`}
                          >
                            Price History
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)' }}
                            onClick={() => handleOpenDetail(item, 'ledger')}
                            id={`view-stock-ledger-${item.id}`}
                          >
                            Stock Ledger
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Item Detail Drawer / Modal ── */}
      {activeItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="material-detail-title"
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
              maxWidth: 680,
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
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--color-primary)' }}>
                    {activeItem.sku}
                  </span>
                  <span className="role-tag" style={{ fontSize: 'var(--text-xs)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                    {activeItem.category_name}
                  </span>
                  {activeItem.is_low_stock && (
                    <span className="badge badge-repair" style={{ background: 'var(--color-danger-dim)', color: 'var(--color-danger)' }}>
                      Low Stock
                    </span>
                  )}
                </div>
                <h2 id="material-detail-title" style={{ fontSize: 'var(--text-2xl)', marginTop: 'var(--space-2)' }}>
                  {activeItem.name}
                </h2>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                  Current Stock: <strong>{activeItem.current_stock} {activeItem.unit_code}</strong> | Reorder Threshold: {activeItem.reorder_level} {activeItem.unit_code}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleCloseDrawer}
                aria-label="Close drawer"
                style={{ padding: 'var(--space-2) var(--space-3)' }}
              >
                ✕
              </button>
            </div>

            {/* Navigation Tabs (Admin gets both, Staff gets Ledger only) */}
            {isAdmin && (
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
                  className="btn btn-ghost"
                  onClick={() => handleSwitchTab('prices')}
                  style={{
                    border: 'none',
                    borderBottom: drawerTab === 'prices' ? '2px solid var(--color-primary)' : '2px solid transparent',
                    borderRadius: 0,
                    color: drawerTab === 'prices' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    fontWeight: drawerTab === 'prices' ? 700 : 500,
                  }}
                >
                  Purchase Price History
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => handleSwitchTab('ledger')}
                  style={{
                    border: 'none',
                    borderBottom: drawerTab === 'ledger' ? '2px solid var(--color-primary)' : '2px solid transparent',
                    borderRadius: 0,
                    color: drawerTab === 'ledger' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    fontWeight: drawerTab === 'ledger' ? 700 : 500,
                  }}
                >
                  Physical Stock Ledger
                </button>
              </div>
            )}

            {/* Drawer Body */}
            {drawerLoading ? (
              <div style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
                <div className="spinner spinner-lg" style={{ margin: '0 auto var(--space-4)' }} />
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                  Loading {drawerTab === 'prices' ? 'price history' : 'stock movements'}...
                </div>
              </div>
            ) : drawerError ? (
              <div className="alert alert-error">
                <span>{drawerError}</span>
              </div>
            ) : drawerTab === 'prices' && isAdmin && priceHistory ? (
              /* ── Admin: Price History & Valuation ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                {/* Valuation Summary Cards */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: 'var(--space-3)',
                  }}
                >
                  <div className="card" style={{ padding: 'var(--space-3)' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Average Cost</div>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--color-primary)' }}>
                      {formatMoney(priceHistory.valuation.average_cost, user?.role)}
                    </div>
                  </div>
                  <div className="card" style={{ padding: 'var(--space-3)' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Total Valuation</div>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
                      {formatMoney(priceHistory.valuation.total_valuation, user?.role)}
                    </div>
                  </div>
                  <div className="card" style={{ padding: 'var(--space-3)' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Priced Quantity</div>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
                      {priceHistory.valuation.priced_qty} {activeItem.unit_code}
                    </div>
                  </div>
                  <div className="card" style={{ padding: 'var(--space-3)' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Priced Receipts</div>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
                      {priceHistory.valuation.priced_receipts_count}
                    </div>
                  </div>
                </div>

                {/* Price History Records */}
                <div>
                  <h3 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>
                    Supplier Purchase Invoices
                  </h3>

                  {priceHistory.price_history.length === 0 ? (
                    <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                      No supplier purchase prices recorded for this item yet.
                    </div>
                  ) : (
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                          <thead>
                            <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                              <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left' }}>Date</th>
                              <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left' }}>Invoice #</th>
                              <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left' }}>Supplier</th>
                              <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right' }}>Qty</th>
                              <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right' }}>Unit Price</th>
                              <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right' }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {priceHistory.price_history.map((rec, idx) => (
                              <tr key={`${rec.invoice_id}-${rec.line_no}-${idx}`} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', whiteSpace: 'nowrap' }}>
                                  {new Date(rec.invoice_date).toLocaleDateString()}
                                </td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                                  {rec.invoice_no}
                                </td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                  {rec.supplier_name}
                                </td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                  {rec.quantity} {rec.unit_code}
                                </td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-primary)' }}>
                                  {formatMoney(rec.unit_price, user?.role)}
                                </td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                                  {formatMoney(rec.line_total, user?.role)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* ── Staff & Admin: Physical Stock Ledger (NO MONEY EVER RENDERED FOR STAFF) ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <h3 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>
                  Recent Stock Movements
                </h3>

                {movements.length === 0 ? (
                  <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    No recorded physical movements for this material.
                  </div>
                ) : (
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                        <thead>
                          <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                            <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left' }}>Date</th>
                            <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left' }}>Type</th>
                            <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right' }}>Quantity</th>
                            <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left' }}>Moved By</th>
                            <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left' }}>Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {movements.map((mov) => {
                            const q = parseFloat(String(mov.qty));
                            const isPositive = q > 0;
                            return (
                              <tr key={mov.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', whiteSpace: 'nowrap' }}>
                                  {new Date(mov.moved_at).toLocaleDateString()}
                                </td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                  <span
                                    className="badge"
                                    style={{
                                      fontSize: '0.65rem',
                                      padding: '1px 6px',
                                      background:
                                        mov.type === 'receipt'
                                          ? 'var(--color-success-dim)'
                                          : mov.type === 'void_reversal' || mov.type === 'issue'
                                          ? 'var(--color-danger-dim)'
                                          : 'var(--color-warning-dim)',
                                      color:
                                        mov.type === 'receipt'
                                          ? 'var(--color-success)'
                                          : mov.type === 'void_reversal' || mov.type === 'issue'
                                          ? 'var(--color-danger)'
                                          : 'var(--color-warning)',
                                    }}
                                  >
                                    {mov.type}
                                  </span>
                                </td>
                                <td
                                  style={{
                                    padding: 'var(--space-2) var(--space-3)',
                                    textAlign: 'right',
                                    fontFamily: 'var(--font-mono)',
                                    fontWeight: 700,
                                    color: isPositive ? 'var(--color-success)' : 'var(--color-danger)',
                                  }}
                                >
                                  {isPositive ? `+${q}` : q} {activeItem.unit_code}
                                </td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-muted)' }}>
                                  {mov.moved_by_name}
                                </td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {mov.note || '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
