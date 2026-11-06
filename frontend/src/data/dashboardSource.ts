/**
 * Dashboard Data Layer (F-S3)
 *
 * Aggregates operational intelligence for the Operations Director Dashboard:
 * 1. Equipment counts by derived status (Available, Rented, Under Repair)
 * 2. Overdue equipment returns (rented assets past their expected return date)
 * 3. Low-stock materials inventory (stock on hand <= reorder level)
 * 4. Offline resilience: computes from IndexedDB snapshots when disconnected
 */

import { api } from '../api/client';
import { loadEquipment, DataSource } from './equipmentSource';
import { loadMaterials, MaterialItem } from './materialsSource';
import type { MockEquipment } from './equipmentSource';

export interface OverdueReturnItem {
  id: number;
  rental_id?: number | null;
  asset_code: string;
  make: string;
  model: string;
  type_name: string;
  customer_name: string;
  site_name: string;
  expected_end: string;
  days_overdue: number;
}

export interface StatusCounts {
  total: number;
  available: number;
  rented: number;
  under_repair: number;
}

export interface DashboardData {
  statusCounts: StatusCounts;
  overdueReturns: OverdueReturnItem[];
  lowStockItems: MaterialItem[];
  equipmentSource: DataSource;
  materialsSource: DataSource;
  savedAt: string | null;
  error?: string | null;
}

export interface ServerRentalListItem {
  id: number;
  customer_id: number;
  customer_name: string;
  site_id: number;
  site_name: string;
  status: string;
  start_date: string;
  expected_end: string;
  active_items: number;
}

/**
 * Calculates days between an expected date and current date.
 * Positive number = days overdue.
 */
export function calculateDaysOverdue(expectedEndIso: string, referenceDate: Date = new Date()): number {
  const expectedDate = new Date(expectedEndIso);
  const diffMs = referenceDate.getTime() - expectedDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Determines whether a date string is prior to today.
 */
export function isDateOverdue(expectedEndIso?: string | null, referenceDate: Date = new Date()): boolean {
  if (!expectedEndIso) return false;
  const todayStr = referenceDate.toISOString().slice(0, 10);
  const expectedStr = expectedEndIso.slice(0, 10);
  return expectedStr < todayStr;
}

/**
 * Extracts overdue returns from equipment items.
 */
export function extractOverdueFromEquipment(
  equipment: MockEquipment[],
  referenceDate: Date = new Date()
): OverdueReturnItem[] {
  const overdues: OverdueReturnItem[] = [];

  for (const eq of equipment) {
    if (eq.status === 'rented' && eq.current_rental_expected_end) {
      if (isDateOverdue(eq.current_rental_expected_end, referenceDate)) {
        overdues.push({
          id: eq.id,
          rental_id: eq.current_rental_id,
          asset_code: eq.asset_code,
          make: eq.make,
          model: eq.model,
          type_name: eq.type_name,
          customer_name: eq.current_customer_name || 'Customer On-Site',
          site_name: eq.current_site_name || eq.current_location_name || 'Client Site',
          expected_end: eq.current_rental_expected_end,
          days_overdue: calculateDaysOverdue(eq.current_rental_expected_end, referenceDate),
        });
      }
    }
  }

  return overdues.sort((a, b) => b.days_overdue - a.days_overdue);
}

/**
 * Loads aggregated dashboard data for the Admin overview.
 */
export async function loadDashboardData(
  userId: number,
  referenceDate: Date = new Date()
): Promise<DashboardData> {
  const [eqRes, matRes] = await Promise.all([
    loadEquipment(userId),
    loadMaterials(userId),
  ]);

  // 1. Status Counts
  const counts: StatusCounts = {
    total: eqRes.items.length,
    available: 0,
    rented: 0,
    under_repair: 0,
  };

  for (const eq of eqRes.items) {
    if (eq.status === 'available') counts.available++;
    else if (eq.status === 'rented') counts.rented++;
    else if (eq.status === 'under_repair') counts.under_repair++;
  }

  // 2. Overdue returns from equipment list
  let overdueReturns = extractOverdueFromEquipment(eqRes.items, referenceDate);

  // If online, also check live active rentals for any additional overdue items
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      const rentalsRes = await api.get<{ data?: ServerRentalListItem[] }>('/api/rentals?status=picked_up&limit=100');
      const activeRentals = rentalsRes.data || [];
      for (const r of activeRentals) {
        if (r.active_items > 0 && isDateOverdue(r.expected_end, referenceDate)) {
          // If not already in the list by rental_id
          if (!overdueReturns.some((o) => o.rental_id === r.id)) {
            overdueReturns.push({
              id: r.id,
              rental_id: r.id,
              asset_code: `RENTAL #${r.id}`,
              make: `${r.active_items} active item(s)`,
              model: '',
              type_name: 'Rental Agreement',
              customer_name: r.customer_name,
              site_name: r.site_name,
              expected_end: r.expected_end,
              days_overdue: calculateDaysOverdue(r.expected_end, referenceDate),
            });
          }
        }
      }
    } catch {
      // offline or error, continue with equipment list derivation
    }
  }

  // 3. Low-Stock Materials
  const lowStockItems = matRes.items.filter(
    (m) => m.is_low_stock || Number(m.current_stock) <= Number(m.reorder_level)
  );

  return {
    statusCounts: counts,
    overdueReturns: overdueReturns.sort((a, b) => b.days_overdue - a.days_overdue),
    lowStockItems,
    equipmentSource: eqRes.source,
    materialsSource: matRes.source,
    savedAt: eqRes.savedAt || matRes.savedAt,
    error: eqRes.error || matRes.error || null,
  };
}
