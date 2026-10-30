/**
 * Equipment data source: live → snapshot → none.
 *
 *   Online:  fetch every page from GET /api/equipment, save a snapshot for this user,
 *            return source 'live'.
 *   Offline: return the last snapshot for this user, source 'snapshot' + savedAt.
 *   Nothing cached yet: source 'none'.
 *
 * Pages are fetched one at a time (no parallel burst). The backend caps page size
 * at 100, so a 5,000-item fleet is ~50 requests on first load.
 */

import { api } from '../api/client';
import type { MockEquipment } from '../mocks/equipmentMock';
import { loadSnapshot, saveSnapshot } from '../offline/db';

export type DataSource = 'live' | 'snapshot' | 'none';

export interface EquipmentResult {
  items: MockEquipment[];
  source: DataSource;
  savedAt: string | null;
  error?: string | null;
}

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

  if (navigator.onLine) {
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
