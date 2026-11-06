import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchLiveEquipment,
  loadEquipment,
  getSnapshotEquipmentByCode,
  fetchLiveEquipmentByCode,
  resolveEquipmentByCode,
  EquipmentDetail,
} from '../data/equipmentSource';
import { api, ApiRequestError } from '../api/client';
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

  const dummyDetail: EquipmentDetail = {
    ...dummyEquipment[0],
    model_id: 1,
    capacity_value: '50.00',
    capacity_unit: 'ton',
    current_location_id: 1,
    location_history: [
      {
        id: 10,
        location_id: 1,
        location_name: 'Dammam Main Yard',
        location_kind: 'yard',
        moved_at: '2026-10-28T09:00:00Z',
        note: 'Yard intake check',
        moved_by_name: 'Staff Technician',
      },
    ],
    active_rental: null,
    open_maintenance: null,
  };

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

  describe('Direct lookup helpers', () => {
    it('getSnapshotEquipmentByCode retrieves item by case-insensitive asset code from IndexedDB', async () => {
      vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
        data: dummyEquipment,
        savedAt: '2026-11-06T08:00:00Z',
      });

      const { item, savedAt } = await getSnapshotEquipmentByCode('crn-50-001', 1);
      expect(item?.asset_code).toBe('CRN-50-001');
      expect(savedAt).toBe('2026-11-06T08:00:00Z');
    });

    it('fetchLiveEquipmentByCode invokes GET /api/equipment/:asset_code', async () => {
      const apiSpy = vi.spyOn(api, 'get').mockResolvedValueOnce(dummyDetail);
      const res = await fetchLiveEquipmentByCode('CRN-50-001');
      expect(apiSpy).toHaveBeenCalledWith('/api/equipment/CRN-50-001');
      expect(res.asset_code).toBe('CRN-50-001');
    });
  });

  describe('resolveEquipmentByCode — snapshot first, then live API (F-S1)', () => {
    it('resolves directly from local snapshot when offline without hitting network', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      const apiSpy = vi.spyOn(api, 'get');
      vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
        data: dummyEquipment,
        savedAt: '2026-11-04T08:00:00Z',
      });

      const res = await resolveEquipmentByCode('CRN-50-001', 1);

      expect(apiSpy).not.toHaveBeenCalled();
      expect(res.source).toBe('snapshot');
      expect(res.equipment?.asset_code).toBe('CRN-50-001');
      expect(res.savedAt).toBe('2026-11-04T08:00:00Z');
      expect(res.error).toBeNull();
    });

    it('returns not_found when offline and asset is not in local snapshot', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
        data: dummyEquipment,
        savedAt: '2026-11-04T08:00:00Z',
      });

      const res = await resolveEquipmentByCode('UNKNOWN-999', 1);

      expect(res.source).toBe('not_found');
      expect(res.equipment).toBeNull();
      expect(res.error).toMatch(/not found in the local offline snapshot/);
    });

    it('fetches live equipment details when online and returns source live', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
        data: dummyEquipment,
        savedAt: '2026-11-04T08:00:00Z',
      });
      const apiSpy = vi.spyOn(api, 'get').mockResolvedValueOnce(dummyDetail);

      const res = await resolveEquipmentByCode('CRN-50-001', 1);

      expect(apiSpy).toHaveBeenCalledWith('/api/equipment/CRN-50-001');
      expect(res.source).toBe('live');
      expect(res.equipment?.asset_code).toBe('CRN-50-001');
      expect(res.equipment?.location_history).toHaveLength(1);
    });

    it('falls back to local snapshot if live network request fails when online', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
        data: dummyEquipment,
        savedAt: '2026-11-04T08:00:00Z',
      });
      vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Connection refused'));

      const res = await resolveEquipmentByCode('crn-50-001', 1);

      expect(res.source).toBe('snapshot');
      expect(res.equipment?.asset_code).toBe('CRN-50-001');
      expect(res.error).toMatch(/Connection refused/);
    });

    it('returns not_found when server returns 404', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
        data: [],
        savedAt: '2026-11-04T08:00:00Z',
      });
      vi.spyOn(api, 'get').mockRejectedValueOnce(
        new ApiRequestError(404, "Equipment with asset code 'NONEXISTENT' was not found", null)
      );

      const res = await resolveEquipmentByCode('NONEXISTENT', 1);

      expect(res.source).toBe('not_found');
      expect(res.equipment).toBeNull();
      expect(res.error).toMatch(/was not found on the server/);
    });

    it('rejects empty or whitespace asset codes with helpful message', async () => {
      const res = await resolveEquipmentByCode('   ', 1);
      expect(res.source).toBe('not_found');
      expect(res.equipment).toBeNull();
      expect(res.error).toMatch(/enter a valid asset code/);
    });
  });
});
