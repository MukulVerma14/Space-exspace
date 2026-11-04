/**
 * Materials Data Layer — handles live API fetching, offline snapshots,
 * and role-restricted price history & valuation requests.
 *
 * ROLE SAFETY POLICY:
 * - Admin users have full financial visibility: purchase prices, average cost,
 *   and inventory valuation.
 * - Staff users have operational visibility ONLY: stock on hand, reorder levels,
 *   and physical movement quantities. Under NO circumstances is money or price
 *   rendered or fetched for staff.
 */

import { api } from '../api/client';
import { saveSnapshot, loadSnapshot } from '../offline/db';

export interface MaterialItem {
  id: number;
  sku: string;
  name: string;
  category_id: number;
  category_name: string;
  unit_id: number;
  unit_code: string;
  unit_name: string;
  reorder_level: string | number;
  current_stock: string | number;
  is_low_stock: boolean;
}

export interface PriceHistoryRecord {
  invoice_id: number;
  invoice_no: string;
  invoice_date: string;
  supplier_id: number;
  supplier_name: string;
  line_no: number;
  description: string;
  quantity: string | number;
  unit_code: string;
  unit_price: string | number;
  line_total: string | number;
}

export interface MaterialValuation {
  total_valuation: number;
  average_cost: number;
  priced_qty: number;
  priced_receipts_count: number;
}

export interface MaterialPriceHistoryResponse {
  item_id: number;
  price_history: PriceHistoryRecord[];
  valuation: MaterialValuation;
}

export interface MaterialMovement {
  id: string | number;
  item_id: number;
  qty: string | number;
  type: 'receipt' | 'issue' | 'adjustment' | 'return' | 'void_reversal';
  unit_cost?: number | string | null;
  moved_at: string;
  note: string | null;
  moved_by_name: string;
  maintenance_id: number | null;
  invoice_line_invoice_id: number | null;
  invoice_line_no: number | null;
}

export type MaterialsDataSource = 'live' | 'snapshot' | 'none';

export interface MaterialsResult {
  items: MaterialItem[];
  source: MaterialsDataSource;
  savedAt: string | null;
  error?: string | null;
}

/**
 * Formats a monetary amount in SAR for admin users only.
 * Guaranteed to return an empty string for non-admin users.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  userRole?: string
): string {
  if (userRole !== 'admin' || amount === null || amount === undefined) {
    return '';
  }
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(num)) return '';
  return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SAR`;
}

/**
 * Loads materials with live fallback to IndexedDB snapshot.
 */
export async function loadMaterials(
  userId: number,
  params?: { category_id?: number; low_stock?: boolean; q?: string }
): Promise<MaterialsResult> {
  const queryParts: string[] = [];
  if (params?.category_id !== undefined) queryParts.push(`category_id=${params.category_id}`);
  if (params?.low_stock) queryParts.push('low_stock=true');
  if (params?.q) queryParts.push(`q=${encodeURIComponent(params.q)}`);
  const queryStr = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const snap = await loadSnapshot<MaterialItem[]>(userId, 'materials-list');
    if (snap) {
      return { items: snap.data, source: 'snapshot', savedAt: snap.savedAt, error: null };
    }
    return { items: [], source: 'none', savedAt: null, error: null };
  }

  try {
    const res = await api.get<{ data: MaterialItem[] }>(`/api/materials${queryStr}`);
    const items = res.data ?? [];
    if (!queryStr) {
      await saveSnapshot(userId, 'materials-list', items);
    }
    return { items, source: 'live', savedAt: null, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const snap = await loadSnapshot<MaterialItem[]>(userId, 'materials-list');
    if (snap) {
      return { items: snap.data, source: 'snapshot', savedAt: snap.savedAt, error: message };
    }
    return { items: [], source: 'none', savedAt: null, error: message };
  }
}

/**
 * Fetches historical supplier purchase prices and valuation for a material SKU.
 * Strict client-side check: throws immediately if role is not admin.
 */
export async function fetchMaterialPriceHistory(
  itemId: number,
  userRole: string
): Promise<MaterialPriceHistoryResponse> {
  if (userRole !== 'admin') {
    throw new Error('Unauthorized: Purchase price history is restricted to administrators.');
  }
  return api.get<MaterialPriceHistoryResponse>(`/api/materials/${itemId}/price-history`);
}

/**
 * Fetches chronological ledger movements for a material SKU.
 * Available to both Admin and Staff (backend scrubs unit_cost for staff).
 */
export async function fetchMaterialMovements(
  itemId: number
): Promise<MaterialMovement[]> {
  const res = await api.get<{ data: MaterialMovement[] }>(`/api/materials/${itemId}/movements`);
  return res.data ?? [];
}
