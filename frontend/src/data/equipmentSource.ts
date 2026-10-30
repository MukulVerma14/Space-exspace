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
}

interface EquipmentPageResponse {
  items: MockEquipment[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean };
}

const SNAPSHOT_NAME = 'equipment-list';
const PAGE_SIZE = 100; // backend maximum
const MAX_PAGES = 200; // safety guard: 20,000 items

async function fetchLiveEquipment(): Promise<MockEquipment[]> {
  const all: MockEquipment[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await api.get<EquipmentPageResponse>(
      `/api/equipment?page=${page}&limit=${PAGE_SIZE}`,
    );
    all.push(...res.items);
    if (!res.pagination.hasNext) return all;
  }
  throw new Error('Equipment list exceeded page guard');
}

export async function loadEquipment(userId: number): Promise<EquipmentResult> {
  if (navigator.onLine) {
    try {
      const items = await fetchLiveEquipment();
      await saveSnapshot(userId, SNAPSHOT_NAME, items);
      return { items, source: 'live', savedAt: new Date().toISOString() };
    } catch {
      // Network or server error mid-load: fall through to the snapshot.
      // (401 handling is added in F-O4, where the sync manager stops and prompts re-login.)
    }
  }

  const snap = await loadSnapshot<MockEquipment[]>(userId, SNAPSHOT_NAME);
  if (snap) {
    return { items: snap.data, source: 'snapshot', savedAt: snap.savedAt };
  }
  return { items: [], source: 'none', savedAt: null };
}
