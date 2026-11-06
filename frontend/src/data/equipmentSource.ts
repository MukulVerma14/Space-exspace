/**
 * Equipment data source: live → snapshot → none.
 *
 *   Online:  fetch every page from GET /api/equipment, save a snapshot for this user,
 *            return source 'live'.
 *   Offline: return the last snapshot for this user, source 'snapshot' + savedAt.
 *   Nothing cached yet: source 'none'.
 *
 * QR Scan Resolution (F-S1):
 *   Resolves equipment by natural asset_code.
 *   First checks the local IndexedDB snapshot (instant response, offline-resilient),
 *   then queries GET /api/equipment/:asset_code when online to fetch latest live
 *   status and rich details (location history, active rental, open maintenance).
 *
 * Locations (F-S2):
 *   Cached locations list for Move, Return, and Repair action pickers.
 */

import { api, ApiRequestError } from '../api/client';
import type { MockEquipment } from '../mocks/equipmentMock';
import { loadSnapshot, saveSnapshot } from '../offline/db';

export type DataSource = 'live' | 'snapshot' | 'none';

export interface EquipmentResult {
  items: MockEquipment[];
  source: DataSource;
  savedAt: string | null;
  error?: string | null;
}

export interface LocationHistoryItem {
  id: number;
  location_id: number;
  location_name: string;
  location_kind: string;
  moved_at: string;
  note: string | null;
  moved_by_name: string;
}

export interface ActiveRentalItem {
  rental_id: number;
  rental_status: string;
  customer_id: number;
  customer_name: string;
  customer_phone?: string;
  customer_contact?: string;
  site_id: number;
  site_name: string;
  start_date: string;
  expected_end: string;
  applied_rate?: number;
  rate_unit?: string;
  discount_note?: string;
}

export interface OpenMaintenanceItem {
  id: number;
  kind: string;
  description: string;
  cost?: number;
  opened_at: string;
  reported_by_name: string;
}

export interface StandardRateItem {
  unit: string;
  amount: string | number;
  vat_included: boolean;
  valid_from: string;
}

export interface EquipmentDetail extends MockEquipment {
  model_id?: number;
  capacity_value?: string | number | null;
  capacity_unit?: string | null;
  current_location_id?: number;
  last_moved_at?: string;
  last_moved_by_name?: string;
  current_rental_id?: number | null;
  current_customer_name?: string | null;
  current_site_name?: string | null;
  current_rental_expected_end?: string | null;
  current_maintenance_id?: number | null;
  current_maintenance_desc?: string | null;
  location_history?: LocationHistoryItem[];
  active_rental?: ActiveRentalItem | null;
  open_maintenance?: OpenMaintenanceItem | null;
  standard_rates?: StandardRateItem[];
}

export interface ResolveEquipmentResult {
  equipment: EquipmentDetail | null;
  source: 'snapshot' | 'live' | 'not_found';
  savedAt?: string | null;
  error?: string | null;
}

export interface AppLocation {
  id: number;
  name: string;
  kind: 'yard' | 'client_site' | 'workshop' | string;
  party_id?: number | null;
}

export const DEFAULT_LOCATIONS: AppLocation[] = [
  { id: 1, name: 'Dammam Central Yard', kind: 'yard' },
  { id: 2, name: 'Jubail Industrial Yard', kind: 'yard' },
  { id: 3, name: 'Central Maintenance Workshop', kind: 'workshop' },
  { id: 4, name: 'King Salman Port Terminal Site', kind: 'client_site' },
  { id: 5, name: 'Neom Logistics Hub Site', kind: 'client_site' },
  { id: 6, name: 'Ras Al-Khair Maritime Yard', kind: 'yard' },
];

interface EquipmentPageResponse {
  items?: MockEquipment[];
  data?: MockEquipment[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages?: number;
    total_pages?: number;
    hasNext?: boolean;
    hasPrev?: boolean;
  };
}

const SNAPSHOT_NAME = 'equipment-list';
const LOCATIONS_SNAPSHOT = 'locations-list';
const PAGE_SIZE = 100; // backend maximum
const MAX_PAGES = 200; // safety guard: 20,000 items

export async function fetchLiveEquipment(): Promise<MockEquipment[]> {
  const all: MockEquipment[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await api.get<EquipmentPageResponse>(
      `/api/equipment?page=${page}&limit=${PAGE_SIZE}`,
    );
    const items = res.items || res.data || [];
    all.push(...items);

    const hasNext =
      res.pagination.hasNext ??
      (res.pagination.page < (res.pagination.totalPages ?? res.pagination.total_pages ?? 1));

    if (!hasNext) return all;
  }
  throw new Error('Equipment list exceeded page guard');
}

export async function loadEquipment(userId: number): Promise<EquipmentResult> {
  let fetchError: string | null = null;

  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      const items = await fetchLiveEquipment();
      await saveSnapshot(userId, SNAPSHOT_NAME, items);
      return { items, source: 'live', savedAt: new Date().toISOString(), error: null };
    } catch (err: unknown) {
      fetchError = err instanceof Error ? err.message : 'Failed to fetch live equipment';
    }
  }

  const snap = await loadSnapshot<MockEquipment[]>(userId, SNAPSHOT_NAME);
  if (snap) {
    return { items: snap.data, source: 'snapshot', savedAt: snap.savedAt, error: fetchError };
  }
  return { items: [], source: 'none', savedAt: null, error: fetchError };
}

/**
 * Looks up equipment from the local IndexedDB snapshot by asset code.
 */
export async function getSnapshotEquipmentByCode(
  assetCode: string,
  userId: number
): Promise<{ item: EquipmentDetail | null; savedAt: string | null }> {
  const clean = assetCode.trim().toLowerCase();
  if (!clean) return { item: null, savedAt: null };

  const snap = await loadSnapshot<MockEquipment[]>(userId, SNAPSHOT_NAME);
  if (!snap || !snap.data) return { item: null, savedAt: null };

  const match = snap.data.find((e) => e.asset_code.toLowerCase() === clean);
  return { item: (match as EquipmentDetail) ?? null, savedAt: snap.savedAt };
}

/**
 * Fetches single equipment details directly from GET /api/equipment/:asset_code.
 */
export async function fetchLiveEquipmentByCode(assetCode: string): Promise<EquipmentDetail> {
  const clean = assetCode.trim();
  return api.get<EquipmentDetail>(`/api/equipment/${encodeURIComponent(clean)}`);
}

/**
 * Resolves an asset code: local snapshot first, then GET /api/equipment/:asset_code.
 */
export async function resolveEquipmentByCode(
  assetCode: string,
  userId: number
): Promise<ResolveEquipmentResult> {
  const clean = assetCode.trim();
  if (!clean) {
    return { equipment: null, source: 'not_found', error: 'Please enter a valid asset code.' };
  }

  // 1. Resolve from local snapshot first
  const { item: snapItem, savedAt } = await getSnapshotEquipmentByCode(clean, userId);

  // If offline, local snapshot is the source of truth
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (snapItem) {
      return { equipment: snapItem, source: 'snapshot', savedAt, error: null };
    }
    return {
      equipment: null,
      source: 'not_found',
      error: `Asset '${clean}' was not found in the local offline snapshot.`,
    };
  }

  // 2. Fetch live data from GET /api/equipment/:asset_code when online
  try {
    const live = await fetchLiveEquipmentByCode(clean);
    return { equipment: live, source: 'live', error: null };
  } catch (err: unknown) {
    if (err instanceof ApiRequestError && err.status === 404) {
      if (snapItem) {
        return {
          equipment: snapItem,
          source: 'snapshot',
          savedAt,
          error: `Asset '${clean}' not found on server (404), showing cached snapshot.`,
        };
      }
      return {
        equipment: null,
        source: 'not_found',
        error: `Equipment with asset code '${clean}' was not found on the server.`,
      };
    }

    // Network error or 500 error: fall back to snapshot if available
    if (snapItem) {
      return {
        equipment: snapItem,
        source: 'snapshot',
        savedAt,
        error: err instanceof Error ? err.message : 'Network error; showing cached snapshot.',
      };
    }

    return {
      equipment: null,
      source: 'not_found',
      error: err instanceof Error ? err.message : `Failed to resolve asset '${clean}'.`,
    };
  }
}

/**
 * Loads locations from GET /api/sync/snapshot or local snapshot cache,
 * falling back to DEFAULT_LOCATIONS if none found.
 */
export async function fetchLocations(userId?: number): Promise<AppLocation[]> {
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (isOnline) {
    try {
      const snapRes = await api.get<{ locations?: AppLocation[] }>('/api/sync/snapshot');
      if (Array.isArray(snapRes.locations) && snapRes.locations.length > 0) {
        if (userId != null) {
          try {
            await saveSnapshot(userId, LOCATIONS_SNAPSHOT, snapRes.locations);
          } catch {
            // ignore snapshot write error in node/tests
          }
        }
        return snapRes.locations;
      }
    } catch {
      // offline or error, fallback to cache
    }
  }

  if (userId != null) {
    try {
      const cached = await loadSnapshot<AppLocation[]>(userId, LOCATIONS_SNAPSHOT);
      if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
        return cached.data;
      }
    } catch {
      // ignore
    }
  }

  return DEFAULT_LOCATIONS;
}
