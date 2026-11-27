/**
 * Rentals Data Layer — API client & offline snapshot cache for equipment rentals.
 *
 * POLICIES & CONSTRAINTS:
 * - Admin has full management access: create (quotation/confirmed), confirm quotations,
 *   dispatch / pick up, cancel agreements, and view agreed rates & customer contact info.
 * - Staff has operational read-only access (and dispatch/pickup capabilities) but
 *   must NEVER see commercial applied rates, discount notes, or customer contact details.
 * - Offline handling:
 *   - Online: Fetches live data and caches snapshot under `rentals-list` in IndexedDB.
 *   - Offline with snapshot: Returns cached snapshot with source 'snapshot' and savedAt timestamp.
 *   - Offline without snapshot: Returns empty data with source 'none' and clear "needs internet" error.
 */

import { api } from '../api/client';
import { loadSnapshot, saveSnapshot } from '../offline/db';
import { formatMoney } from './materialsSource';

export type RentalStatus = 'quotation' | 'confirmed' | 'picked_up' | 'returned' | 'cancelled';
export type RentalRateUnit = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface RentalListItem {
  id: number;
  customer_id: number;
  customer_name: string;
  site_id: number;
  site_name: string;
  status: RentalStatus;
  start_date: string;
  expected_end: string;
  created_at: string;
  total_items: number;
  active_items: number;
}

export interface RentalDetailItem {
  equipment_id: number;
  asset_code: string;
  make: string;
  model: string;
  type_name: string;
  applied_rate?: string | number; // Scrubbed for staff
  rate_unit?: RentalRateUnit;     // Scrubbed for staff
  discount_note?: string | null;  // Scrubbed for staff
  returned_at: string | null;
}

export interface RentalDetail {
  id: number;
  customer_id: number;
  customer_name: string;
  customer_contact?: string | null; // Scrubbed for staff
  customer_phone?: string | null;   // Scrubbed for staff
  site_id: number;
  site_name: string;
  status: RentalStatus;
  start_date: string;
  expected_end: string;
  created_at: string;
  items: RentalDetailItem[];
}

export interface RentalsQueryParams {
  status?: RentalStatus | 'all';
  customer_id?: number;
  page?: number;
  limit?: number;
}

export interface RentalsListResponse {
  data: RentalListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export type RentalDataSource = 'live' | 'snapshot' | 'none';

export interface RentalsResult {
  data: RentalListItem[];
  source: RentalDataSource;
  savedAt: string | null;
  error?: string | null;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface CreateRentalItemPayload {
  equipment_id: number;
  applied_rate: number | string;
  rate_unit: RentalRateUnit;
  discount_note?: string;
}

export interface CreateRentalPayload {
  customer_id: number;
  site_id: number;
  start_date: string;
  expected_end: string;
  status: 'quotation' | 'confirmed' | 'picked_up';
  items: CreateRentalItemPayload[];
}

export interface StandardRateCardItem {
  model_id: number;
  make: string;
  model: string;
  unit: RentalRateUnit;
  amount: string | number;
  vat_included: boolean;
  valid_from: string;
}

export const RENTALS_SNAPSHOT_NAME = 'rentals-list';

/**
 * Unambiguous date display formatter: DD MMM YYYY (e.g. 15 Oct 2026).
 * Handles both date-only YYYY-MM-DD and full ISO strings without timezone drift.
 */
export function formatDisplayDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const clean = dateStr.split('T')[0];
    const parts = clean.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      if (!isNaN(year) && !isNaN(monthIdx) && !isNaN(day) && monthIdx >= 0 && monthIdx < 12) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dd = String(day).padStart(2, '0');
        return `${dd} ${months[monthIdx]} ${year}`;
      }
    }
  } catch {
    // fallback
  }
  return dateStr;
}

/**
 * Human-readable status labels.
 */
export function getRentalStatusLabel(status: RentalStatus | string): string {
  switch (status) {
    case 'quotation':
      return 'Quotation';
    case 'confirmed':
      return 'Confirmed';
    case 'picked_up':
      return 'Picked Up';
    case 'returned':
      return 'Returned';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

/**
 * Status badge CSS class mapping.
 */
export function getRentalStatusBadgeClass(status: RentalStatus | string): string {
  switch (status) {
    case 'quotation':
      return 'badge-warning';
    case 'confirmed':
      return 'badge-info';
    case 'picked_up':
      return 'badge-success';
    case 'returned':
      return 'badge-neutral';
    case 'cancelled':
      return 'badge-danger';
    default:
      return 'badge-neutral';
  }
}

/**
 * Fetches rentals list with filtering, caching to IndexedDB snapshot when online,
 * and falling back to cached snapshot when offline.
 */
export async function fetchRentals(
  params?: RentalsQueryParams,
  userId?: number
): Promise<RentalsResult> {
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

  const queryParts: string[] = [];
  if (params?.status && params.status !== 'all') {
    queryParts.push(`status=${encodeURIComponent(params.status)}`);
  }
  if (params?.customer_id) {
    queryParts.push(`customer_id=${params.customer_id}`);
  }
  if (params?.page) {
    queryParts.push(`page=${params.page}`);
  }
  if (params?.limit) {
    queryParts.push(`limit=${params.limit}`);
  }
  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

  // 1. If online, attempt live network request
  if (isOnline) {
    try {
      const res = await api.get<RentalsListResponse>(`/api/rentals${queryString}`);
      const items = res.data ?? [];

      // Cache snapshot for this user if no specific filters applied, or as baseline snapshot
      if (userId != null && (!params?.status || params.status === 'all') && !params?.customer_id) {
        try {
          await saveSnapshot(userId, RENTALS_SNAPSHOT_NAME, items);
        } catch {
          // ignore cache write error
        }
      }

      return {
        data: items,
        source: 'live',
        savedAt: new Date().toISOString(),
        pagination: res.pagination,
      };
    } catch (err: unknown) {
      // Network failed or server error — attempt snapshot fallback below
      const fetchError = err instanceof Error ? err.message : String(err);
      if (userId != null) {
        const snap = await loadSnapshot<RentalListItem[]>(userId, RENTALS_SNAPSHOT_NAME);
        if (snap && snap.data) {
          let filtered = snap.data;
          if (params?.status && params.status !== 'all') {
            filtered = filtered.filter((r) => r.status === params.status);
          }
          if (params?.customer_id) {
            filtered = filtered.filter((r) => r.customer_id === params.customer_id);
          }
          return {
            data: filtered,
            source: 'snapshot',
            savedAt: snap.savedAt,
            error: fetchError,
            pagination: { page: 1, limit: filtered.length, total: filtered.length, total_pages: 1 },
          };
        }
      }
      return {
        data: [],
        source: 'none',
        savedAt: null,
        error: fetchError || 'Failed to fetch rentals',
      };
    }
  }

  // 2. Offline: Attempt to load from IndexedDB snapshot
  if (userId != null) {
    const snap = await loadSnapshot<RentalListItem[]>(userId, RENTALS_SNAPSHOT_NAME);
    if (snap && snap.data) {
      let filtered = snap.data;
      if (params?.status && params.status !== 'all') {
        filtered = filtered.filter((r) => r.status === params.status);
      }
      if (params?.customer_id) {
        filtered = filtered.filter((r) => r.customer_id === params.customer_id);
      }
      return {
        data: filtered,
        source: 'snapshot',
        savedAt: snap.savedAt,
        pagination: { page: 1, limit: filtered.length, total: filtered.length, total_pages: 1 },
      };
    }
  }

  // 3. Offline and no snapshot available
  return {
    data: [],
    source: 'none',
    savedAt: null,
    error: 'Internet connection required to load rentals',
  };
}

/**
 * Fetches single detailed rental agreement by ID.
 */
export async function fetchRentalById(id: number): Promise<RentalDetail> {
  const res = await api.get<{ data: RentalDetail }>(`/api/rentals/${id}`);
  return res.data;
}

/**
 * Admin: Creates a new rental agreement with line items.
 */
export async function createRental(
  payload: CreateRentalPayload
): Promise<{ message: string; rental_id: number; status: string }> {
  return api.post<{ message: string; rental_id: number; status: string }>('/api/rentals', payload);
}

/**
 * Admin: Confirms a quotation rental agreement after availability verification.
 */
export async function confirmRental(
  id: number
): Promise<{ message: string; rental_id: number; status: string }> {
  return api.post<{ message: string; rental_id: number; status: string }>(`/api/rentals/${id}/confirm`, {});
}

/**
 * Admin or Staff: Dispatches/picks up confirmed rental agreement.
 */
export async function pickupRental(
  id: number,
  note?: string
): Promise<{ message: string; rental_id: number; status: string }> {
  return api.post<{ message: string; rental_id: number; status: string }>(`/api/rentals/${id}/pickup`, { note });
}

/**
 * Admin: Cancels a rental agreement and frees all assigned equipment.
 */
export async function cancelRental(
  id: number
): Promise<{ message: string; rental_id: number; status: string }> {
  return api.post<{ message: string; rental_id: number; status: string }>(`/api/rentals/${id}/cancel`, {});
}

/**
 * Admin: Fetches standard commercial rate cards for prefilling applied rates.
 */
export async function fetchStandardRates(): Promise<StandardRateCardItem[]> {
  const res = await api.get<{ rates: StandardRateCardItem[] }>('/api/rates');
  return res.rates ?? [];
}

export { formatMoney };
