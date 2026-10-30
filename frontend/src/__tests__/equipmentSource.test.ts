import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchLiveEquipment, loadEquipment } from '../data/equipmentSource';
import { api } from '../api/client';
import * as dbModule from '../offline/db';
import type { MockEquipment } from '../mocks/equipmentMock';

describe('equipmentSource — live and offline fallback', () => {
  const dummyEquipment: MockEquipment[] = [
    {
      id: 1,
      asset_code: 'CRN-50-001',
      make: 'Tadano',
      model: 'GR-500EX',
      type_name: 'Rough Terrain Crane',
      serial_no: 'TD-500-9841',
      condition: 'good',
      status: 'available',
      current_location_name: 'Dammam Main Yard',
      current_location_kind: 'yard',
      active: true,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches live equipment with items and pagination.hasNext', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      items: dummyEquipment,
      pagination: {
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });

    const result = await fetchLiveEquipment();
    expect(result).toHaveLength(1);
    expect(result[0].asset_code).toBe('CRN-50-001');
  });

  it('supports backwards-compatible data field alias in equipment response', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      data: dummyEquipment,
      pagination: {
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
        hasNext: false,
      },
    });

    const result = await fetchLiveEquipment();
    expect(result).toHaveLength(1);
    expect(result[0].asset_code).toBe('CRN-50-001');
  });

  it('saves snapshot and returns source live when online', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      items: dummyEquipment,
      pagination: { total: 1, page: 1, limit: 100, totalPages: 1, hasNext: false },
    });
    const saveSnapshotSpy = vi.spyOn(dbModule, 'saveSnapshot').mockResolvedValue();

    const res = await loadEquipment(2);
    expect(res.source).toBe('live');
    expect(res.items).toHaveLength(1);
    expect(res.error).toBeNull();
    expect(saveSnapshotSpy).toHaveBeenCalledWith(2, 'equipment-list', dummyEquipment);
  });

  it('falls back to snapshot with error message when live fetch fails', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Network connection timeout'));
    vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
      data: dummyEquipment,
      savedAt: '2026-10-30T10:00:00.000Z',
    });

    const res = await loadEquipment(2);
    expect(res.source).toBe('snapshot');
    expect(res.items).toHaveLength(1);
    expect(res.savedAt).toBe('2026-10-30T10:00:00.000Z');
    expect(res.error).toBe('Network connection timeout');
  });
});
