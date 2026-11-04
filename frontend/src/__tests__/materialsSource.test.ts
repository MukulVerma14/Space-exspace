import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatMoney,
  loadMaterials,
  fetchMaterialPriceHistory,
  fetchMaterialMovements,
  MaterialItem,
  MaterialPriceHistoryResponse,
  MaterialMovement,
} from '../data/materialsSource';
import { api } from '../api/client';
import * as dbModule from '../offline/db';

describe('materialsSource — Data fetching, offline snapshots & role policy', () => {
  const dummyMaterials: MaterialItem[] = [
    {
      id: 1,
      sku: 'MAT-001',
      name: 'Hydraulic Oil ISO 46',
      category_id: 1,
      category_name: 'Fluids',
      unit_id: 1,
      unit_code: 'L',
      unit_name: 'Litre',
      reorder_level: '20.000',
      current_stock: '15.000',
      is_low_stock: true,
    },
    {
      id: 2,
      sku: 'MAT-002',
      name: 'Engine Oil 15W-40',
      category_id: 1,
      category_name: 'Fluids',
      unit_id: 1,
      unit_code: 'L',
      unit_name: 'Litre',
      reorder_level: '10.000',
      current_stock: '50.000',
      is_low_stock: false,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatMoney — Strict Role Guard', () => {
    it('formats monetary numbers into SAR string for admin', () => {
      expect(formatMoney(1250, 'admin')).toBe('1,250.00 SAR');
      expect(formatMoney(45.5, 'admin')).toBe('45.50 SAR');
      expect(formatMoney('89.1234', 'admin')).toBe('89.1234 SAR');
    });

    it('NEVER renders money for staff role (returns empty string)', () => {
      expect(formatMoney(1250, 'staff')).toBe('');
      expect(formatMoney(45.5, 'staff')).toBe('');
      expect(formatMoney('89.1234', 'staff')).toBe('');
    });

    it('returns empty string if user role is undefined or not admin', () => {
      expect(formatMoney(500, undefined)).toBe('');
      expect(formatMoney(500, 'viewer')).toBe('');
    });

    it('handles null, undefined, and non-numeric values safely', () => {
      expect(formatMoney(null, 'admin')).toBe('');
      expect(formatMoney(undefined, 'admin')).toBe('');
      expect(formatMoney('not-a-number', 'admin')).toBe('');
    });
  });

  describe('loadMaterials — Live & Offline Snapshot', () => {
    it('fetches live materials when online and saves snapshot', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      const apiSpy = vi.spyOn(api, 'get').mockResolvedValueOnce({
        data: dummyMaterials,
      });
      const saveSnapshotSpy = vi.spyOn(dbModule, 'saveSnapshot').mockResolvedValue();

      const res = await loadMaterials(1);

      expect(apiSpy).toHaveBeenCalledWith('/api/materials');
      expect(saveSnapshotSpy).toHaveBeenCalledWith(1, 'materials-list', dummyMaterials);
      expect(res.source).toBe('live');
      expect(res.items).toHaveLength(2);
      expect(res.items[0].is_low_stock).toBe(true);
      expect(res.error).toBeNull();
    });

    it('appends query parameters when filters are passed', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      const apiSpy = vi.spyOn(api, 'get').mockResolvedValueOnce({
        data: [dummyMaterials[0]],
      });

      const res = await loadMaterials(1, { low_stock: true, q: 'Hydraulic' });

      expect(apiSpy).toHaveBeenCalledWith('/api/materials?low_stock=true&q=Hydraulic');
      expect(res.items).toHaveLength(1);
    });

    it('reads from snapshot when offline without making network request', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      const apiSpy = vi.spyOn(api, 'get');
      const loadSnapshotSpy = vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
        data: dummyMaterials,
        savedAt: '2026-11-04T10:00:00.000Z',
      });

      const res = await loadMaterials(1);

      expect(apiSpy).not.toHaveBeenCalled();
      expect(loadSnapshotSpy).toHaveBeenCalledWith(1, 'materials-list');
      expect(res.source).toBe('snapshot');
      expect(res.items).toHaveLength(2);
      expect(res.savedAt).toBe('2026-11-04T10:00:00.000Z');
    });

    it('falls back to snapshot with error notice when live network request fails', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Connection refused'));
      vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
        data: dummyMaterials,
        savedAt: '2026-11-04T10:00:00.000Z',
      });

      const res = await loadMaterials(1);

      expect(res.source).toBe('snapshot');
      expect(res.items).toHaveLength(2);
      expect(res.error).toBe('Connection refused');
    });
  });

  describe('fetchMaterialPriceHistory — Role Policy Guard', () => {
    const dummyPriceHistory: MaterialPriceHistoryResponse = {
      item_id: 1,
      price_history: [
        {
          invoice_id: 10,
          invoice_no: 'INV-2026-001',
          invoice_date: '2026-10-15T00:00:00.000Z',
          supplier_id: 2,
          supplier_name: 'TotalEnergies KSA',
          line_no: 1,
          description: 'Hydraulic Oil 20L Drum',
          quantity: '5.000',
          unit_code: 'L',
          unit_price: '45.5000',
          line_total: '227.50',
        },
      ],
      valuation: {
        total_valuation: 227.5,
        average_cost: 45.5,
        priced_qty: 5,
        priced_receipts_count: 1,
      },
    };

    it('fetches price history and valuation for admin', async () => {
      const apiSpy = vi.spyOn(api, 'get').mockResolvedValueOnce(dummyPriceHistory);

      const res = await fetchMaterialPriceHistory(1, 'admin');

      expect(apiSpy).toHaveBeenCalledWith('/api/materials/1/price-history');
      expect(res.valuation.average_cost).toBe(45.5);
      expect(res.price_history).toHaveLength(1);
    });

    it('strictly throws unauthorized error for staff and never calls network', async () => {
      const apiSpy = vi.spyOn(api, 'get');

      await expect(fetchMaterialPriceHistory(1, 'staff')).rejects.toThrow(
        /Unauthorized: Purchase price history is restricted to administrators/
      );
      expect(apiSpy).not.toHaveBeenCalled();
    });
  });

  describe('fetchMaterialMovements', () => {
    it('fetches physical stock ledger movements', async () => {
      const dummyMovements: MaterialMovement[] = [
        {
          id: 101,
          item_id: 1,
          qty: '10.000',
          type: 'receipt',
          unit_cost: null, // Scrubbed for staff
          moved_at: '2026-11-01T10:00:00.000Z',
          note: 'Initial stock intake',
          moved_by_name: 'Storekeeper Ali',
          maintenance_id: null,
          invoice_line_invoice_id: null,
          invoice_line_no: null,
        },
      ];

      vi.spyOn(api, 'get').mockResolvedValueOnce({
        data: dummyMovements,
      });

      const res = await fetchMaterialMovements(1);

      expect(res).toHaveLength(1);
      expect(res[0].type).toBe('receipt');
      expect(res[0].qty).toBe('10.000');
    });
  });
});
