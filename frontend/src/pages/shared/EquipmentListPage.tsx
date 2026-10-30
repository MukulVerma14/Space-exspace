/**
 * EquipmentListPage — shared between /admin/equipment and /staff/equipment.
 *
 * Features:
 *   - Debounced text search (asset_code, make, model, type_name)
 *   - Status filter dropdown (all | available | rented | under_repair) — matches API enum
 *   - Result count summary
 *   - Card grid layout (mobile-first, 1 col → 2 col → 3 col)
 *   - Loading skeleton (for when real API is connected)
 *   - Empty state
 *
 * DATA:
 *   loadEquipment() in src/data/equipmentSource.ts: live when online, saved snapshot when offline.
 *   To connect to the real API, replace the useMemo filter block with:
 *     const { data } = useSWR(`/api/equipment?search=${debouncedSearch}&status=${status}`, api.get)
 *   The card renders will be identical — mock shape matches the API shape.
 *
 * ROLE POLICY:
 *   Both admin and staff see the same list. We render whatever the server
 *   sends. We never conditionally show/hide fields based on role here.
 *   (Financial fields are absent from equipment list responses entirely.)
 */

import { useState, useMemo, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { useAuth } from '../../context/AuthContext';
import { loadEquipment, DataSource } from '../../data/equipmentSource';
import {
  MockEquipment,
  EquipmentStatus,
} from '../../mocks/equipmentMock';

// ─── Status config ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<EquipmentStatus | 'all', string> = {
  all: 'All Status',
  available: 'Available',
  rented: 'Rented',
  under_repair: 'Under Repair',
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS) as [
  EquipmentStatus | 'all',
  string,
][];

// ─── Condition config ──────────────────────────────────────────────────────────

const CONDITION_COLOUR: Record<string, string> = {
  good:         'var(--color-primary)',
  fair:         'var(--color-warning)',
  needs_repair: 'var(--color-danger)',
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function EquipmentListPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EquipmentStatus | 'all'>('all');
  const { user } = useAuth();
  const [items, setItems] = useState<MockEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<DataSource>('none');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    loadEquipment(user.id).then((res) => {
      if (cancelled) return;
      setItems(res.items);
      setSource(res.source);
      setSavedAt(res.savedAt);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const debouncedSearch = useDebounce(search, 300);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return items.filter((eq) => {
      const matchesSearch =
        !q ||
        eq.asset_code.toLowerCase().includes(q) ||
        eq.make.toLowerCase().includes(q) ||
        eq.model.toLowerCase().includes(q) ||
        eq.type_name.toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === 'all' || eq.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [debouncedSearch, statusFilter, items]);

  return (
    <div className="animate-fade-up">
      {/* ── Page Header ── */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
          Equipment Fleet
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          {loading
            ? 'Loading fleet…'
            : `${filtered.length} of ${items.length} assets`}
        </p>
      </div>

      {/* ── Offline / no-data notices ── */}
      {source === 'snapshot' && (
        <div
          role="status"
          style={{
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
          }}
        >
          Offline. Showing saved data from {savedAt ? new Date(savedAt).toLocaleString() : 'earlier'}. Status may be out of date.
        </div>
      )}
      {source === 'none' && !loading && (
        <div
          role="status"
          style={{
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
          }}
        >
          No saved data on this device yet. Connect to the internet once to load the fleet.
        </div>
      )}

      {/* ── Filters Bar ── */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)',
          flexWrap: 'wrap',
        }}
      >
        {/* Search input */}
        <div className="input-group" style={{ flex: '1 1 220px', minWidth: 0 }}>
          <span className="input-icon">
            <SearchIcon />
          </span>
          <input
            id="equipment-search"
            type="search"
            className="input"
            placeholder="Search asset code, make, model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search equipment"
          />
        </div>

        {/* Status filter */}
        <select
          id="equipment-status-filter"
          className="select"
          style={{ flex: '0 1 160px' }}
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as EquipmentStatus | 'all')
          }
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Status summary chips ── */}
      <StatusSummaryBar data={items} activeFilter={statusFilter} onFilter={setStatusFilter} />

      {/* ── Content ── */}
      {loading ? (
        <SkeletonGrid />
      ) : filtered.length === 0 ? (
        <EmptyState search={debouncedSearch} status={statusFilter} />
      ) : (
        <div
          id="equipment-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--space-4)',
            marginTop: 'var(--space-5)',
          }}
        >
          {filtered.map((eq) => (
            <EquipmentCard key={eq.id} equipment={eq} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Status Summary Bar ────────────────────────────────────────────────────────

function StatusSummaryBar({
  data,
  activeFilter,
  onFilter,
}: {
  data: MockEquipment[];
  activeFilter: EquipmentStatus | 'all';
  onFilter: (s: EquipmentStatus | 'all') => void;
}) {
  const counts = useMemo(() => {
    const c: Record<EquipmentStatus, number> = {
      available: 0,
      rented: 0,
      under_repair: 0,
    };
    data.forEach((eq) => c[eq.status]++);
    return c;
  }, [data]);

  const chips: { key: EquipmentStatus; label: string; cls: string }[] = [
    { key: 'available',   label: 'Available',   cls: 'badge-available' },
    { key: 'rented',      label: 'Rented',      cls: 'badge-rented' },
    { key: 'under_repair',label: 'In Repair',   cls: 'badge-repair' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-2)',
        flexWrap: 'wrap',
        marginBottom: 'var(--space-5)',
      }}
      role="group"
      aria-label="Filter by status"
    >
      {chips.map(({ key, label, cls }) => (
        <button
          key={key}
          onClick={() =>
            onFilter(activeFilter === key ? 'all' : key)
          }
          aria-pressed={activeFilter === key}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            opacity: activeFilter !== 'all' && activeFilter !== key ? 0.45 : 1,
            transition: 'opacity var(--transition-fast)',
          }}
        >
          <span className={`badge ${cls}`}>
            {label} ({counts[key]})
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Equipment Card ───────────────────────────────────────────────────────────

function EquipmentCard({ equipment: eq }: { equipment: MockEquipment }) {
  const statusBadgeClass: Record<EquipmentStatus, string> = {
    available:   'badge-available',
    rented:      'badge-rented',
    under_repair:'badge-repair',
  };

  const statusLabel: Record<EquipmentStatus, string> = {
    available:    'Available',
    rented:       'Rented',
    under_repair: 'Under Repair',
  };

  const conditionColour = CONDITION_COLOUR[eq.condition] ?? 'var(--color-text-muted)';

  return (
    <article
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        transition: 'all var(--transition-base)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-subtle)';
        (e.currentTarget as HTMLElement).style.transform = 'none';
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
      aria-label={`${eq.make} ${eq.model} — ${eq.asset_code}`}
    >
      {/* Header: asset code + status badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--color-primary)',
            letterSpacing: '0.03em',
          }}
        >
          {eq.asset_code}
        </span>
        <span className={`badge ${statusBadgeClass[eq.status]}`}>
          {statusLabel[eq.status]}
        </span>
      </div>

      {/* Make / Model / Type */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginBottom: 'var(--space-1)' }}>
          {eq.make} {eq.model}
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          {eq.type_name}
        </div>
      </div>

      {/* Divider */}
      <div className="divider" style={{ margin: 0 }} />

      {/* Location + Condition row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        {/* Location */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
          <LocationIcon />
          <span
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={eq.current_location_name ?? 'Unknown location'}
          >
            {eq.current_location_name ?? '—'}
          </span>
        </div>

        {/* Condition pill */}
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            color: conditionColour,
            background: `${conditionColour}18`,
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            border: `1px solid ${conditionColour}33`,
            flexShrink: 0,
            textTransform: 'capitalize',
          }}
        >
          {eq.condition}
        </span>
      </div>
    </article>
  );
}

// ─── Skeleton Grid ────────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 'var(--space-4)',
        marginTop: 'var(--space-5)',
      }}
      aria-label="Loading equipment…"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="card skeleton"
          style={{ height: 160 }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ search, status }: { search: string; status: string }) {
  return (
    <div
      style={{
        textAlign: 'center',
        paddingTop: 'var(--space-16)',
        color: 'var(--color-text-muted)',
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 'var(--space-4)' }}>🔍</div>
      <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>No equipment found</p>
      <p style={{ fontSize: 'var(--text-sm)' }}>
        {search
          ? `No results for "${search}"${status !== 'all' ? ` with status "${status}"` : ''}`
          : `No equipment with status "${status}"`}
      </p>
    </div>
  );
}

// ─── Inline Icons ─────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-text-subtle)' }}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
