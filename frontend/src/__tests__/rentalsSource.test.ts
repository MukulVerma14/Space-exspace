import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchRentals,
  fetchRentalById,
  createRental,
  confirmRental,
  pickupRental,
  cancelRental,
  fetchStandardRates,
  formatDisplayDate,
  getRentalStatusLabel,
  getRentalStatusBadgeClass,
  RentalListItem,
  RentalDetail,
  CreateRentalPayload,
} from '../data/rentalsSource';
import { api } from '../api/client';
import * as db from '../offline/db';

describe('rentalsSource — Data fetching, offline caching & lifecycle actions', () => {
  const dummyRentals: RentalListItem[] = [
    {
      id: 1,
      customer_id: 10,
      customer_name: 'Aramco Site Services',
      site_id: 2,
      site_name: 'Haradh Gas Plant Site #3',
      status: 'confirmed',
      start_date: '2026-11-01',
      expected_end: '2026-11-30',
      created_at: '2026-10-28T09:00:00Z',
      total_items: 2,
      active_items: 2,
    },
    {
      id: 2,
      customer_id: 11,
      customer_name: 'SABIC Petrochemicals',
      site_id: 3,
      site_name: 'Jubail Industrial Plant #2',
      status: 'quotation',
      start_date: '2026-11-15',
      expected_end: '2026-12-15',
      created_at: '2026-10-29T11:00:00Z',
      total_items: 1,
      active_items: 1,
    },
    {
      id: 3,
      customer_id: 10,
      customer_name: 'Aramco Site Services',
      site_id: 2,
      site_name: 'Haradh Gas Plant Site #3',
      status: 'picked_up',
      start_date: '2026-10-01',
      expected_end: '2026-10-25',
      created_at: '2026-09-28T09:00:00Z',
      total_items: 1,
      active_items: 1,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchRentals (Online / Offline / Snapshot)', () => {
    it('fetches live rentals from /api/rentals and saves snapshot to IndexedDB when online', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({
        data: dummyRentals,
        pagination: { page: 1, limit: 100, total: 3, total_pages: 1 },
      });
      const saveSpy = vi.spyOn(db, 'saveSnapshot').mockResolvedValue(undefined);

      const result = await fetchRentals({ limit: 100 }, 1);

      expect(api.get).toHaveBeenCalledWith('/api/rentals?limit=100');
      expect(result.source).toBe('live');
      expect(result.data).toHaveLength(3);
      expect(saveSpy).toHaveBeenCalledWith(1, 'rentals-list', dummyRentals);
    });

    it('falls back to local IndexedDB snapshot when offline and user is provided', async () => {
      // Simulate offline environment
      const originalNavigator = globalThis.navigator;
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
      });

      const snapMock = {
        data: dummyRentals,
        savedAt: '2026-10-30T12:00:00Z',
      };
      vi.spyOn(db, 'loadSnapshot').mockResolvedValueOnce(snapMock);

      const result = await fetchRentals({ status: 'confirmed' }, 1);

      expect(result.source).toBe('snapshot');
      expect(result.savedAt).toBe('2026-10-30T12:00:00Z');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(1);

      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    });

    it('returns source: none with clear "Internet connection required" when offline and no snapshot exists', async () => {
      const originalNavigator = globalThis.navigator;
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
      });

      vi.spyOn(db, 'loadSnapshot').mockResolvedValueOnce(null);

      const result = await fetchRentals({}, 1);

      expect(result.source).toBe('none');
      expect(result.data).toEqual([]);
      expect(result.error).toContain('Internet connection required');

      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    });

    it('falls back to snapshot if API network call fails while online', async () => {
      vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Network error: server unreachable'));
      const snapMock = {
        data: dummyRentals,
        savedAt: '2026-10-30T12:00:00Z',
      };
      vi.spyOn(db, 'loadSnapshot').mockResolvedValueOnce(snapMock);

      const result = await fetchRentals({}, 1);

      expect(result.source).toBe('snapshot');
      expect(result.data).toHaveLength(3);
      expect(result.error).toContain('Network error');
    });
  });

  describe('fetchRentalById', () => {
    it('queries /api/rentals/:id and returns detailed rental agreement', async () => {
      const mockDetail: RentalDetail = {
        ...dummyRentals[0],
        customer_contact: 'Khalid Al-Ghamdi',
        customer_phone: '+966 50 123 4567',
        items: [
          {
            equipment_id: 1,
            asset_code: 'CR-001',
            make: 'Liebherr',
            model: 'LTM 1050-3.1',
            type_name: 'Mobile Crane',
            applied_rate: '1500.00',
            rate_unit: 'daily',
            discount_note: null,
            returned_at: null,
          },
        ],
      };

      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: mockDetail });

      const res = await fetchRentalById(1);

      expect(api.get).toHaveBeenCalledWith('/api/rentals/1');
      expect(res.id).toBe(1);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].asset_code).toBe('CR-001');
    });
  });

  describe('Lifecycle mutation actions (create, confirm, pickup, cancel)', () => {
    it('createRental posts to /api/rentals with agreement payload', async () => {
      const payload: CreateRentalPayload = {
        customer_id: 10,
        site_id: 2,
        start_date: '2026-11-01',
        expected_end: '2026-11-07',
        status: 'confirmed',
        items: [
          {
            equipment_id: 1,
            applied_rate: 1500,
            rate_unit: 'daily',
            discount_note: 'Standard rate',
          },
        ],
      };

      vi.spyOn(api, 'post').mockResolvedValueOnce({
        message: 'Rental agreement created successfully',
        rental_id: 42,
        status: 'confirmed',
      });

      const res = await createRental(payload);

      expect(api.post).toHaveBeenCalledWith('/api/rentals', payload);
      expect(res.rental_id).toBe(42);
      expect(res.status).toBe('confirmed');
    });

    it('confirmRental posts to /api/rentals/:id/confirm', async () => {
      vi.spyOn(api, 'post').mockResolvedValueOnce({
        message: 'Rental agreement confirmed successfully',
        rental_id: 2,
        status: 'confirmed',
      });

      const res = await confirmRental(2);

      expect(api.post).toHaveBeenCalledWith('/api/rentals/2/confirm', {});
      expect(res.status).toBe('confirmed');
    });

    it('pickupRental posts to /api/rentals/:id/pickup with optional note', async () => {
      vi.spyOn(api, 'post').mockResolvedValueOnce({
        message: 'Rental marked as picked up',
        rental_id: 1,
        status: 'picked_up',
      });

      const res = await pickupRental(1, 'Dispatched via truck #5');

      expect(api.post).toHaveBeenCalledWith('/api/rentals/1/pickup', { note: 'Dispatched via truck #5' });
      expect(res.status).toBe('picked_up');
    });

    it('cancelRental posts to /api/rentals/:id/cancel and frees items', async () => {
      vi.spyOn(api, 'post').mockResolvedValueOnce({
        message: 'Rental cancelled',
        rental_id: 1,
        status: 'cancelled',
      });

      const res = await cancelRental(1);

      expect(api.post).toHaveBeenCalledWith('/api/rentals/1/cancel', {});
      expect(res.status).toBe('cancelled');
    });
  });

  describe('fetchStandardRates', () => {
    it('fetches rate cards from /api/rates for prefilling applied rates', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({
        rates: [
          {
            model_id: 1,
            make: 'Liebherr',
            model: 'LTM 1050-3.1',
            unit: 'daily',
            amount: '1500.00',
            vat_included: true,
            valid_from: '2026-01-01',
          },
        ],
      });

      const rates = await fetchStandardRates();

      expect(api.get).toHaveBeenCalledWith('/api/rates');
      expect(rates).toHaveLength(1);
      expect(rates[0].amount).toBe('1500.00');
    });
  });

  describe('Display formatting helpers', () => {
    it('formatDisplayDate formats YYYY-MM-DD into DD MMM YYYY without timezone offsets', () => {
      expect(formatDisplayDate('2026-10-15')).toBe('15 Oct 2026');
      expect(formatDisplayDate('2026-01-01')).toBe('01 Jan 2026');
      expect(formatDisplayDate('2026-12-31T23:59:59Z')).toBe('31 Dec 2026');
      expect(formatDisplayDate(null)).toBe('—');
      expect(formatDisplayDate(undefined)).toBe('—');
    });

    it('getRentalStatusLabel returns human-readable status titles', () => {
      expect(getRentalStatusLabel('quotation')).toBe('Quotation');
      expect(getRentalStatusLabel('confirmed')).toBe('Confirmed');
      expect(getRentalStatusLabel('picked_up')).toBe('Picked Up');
      expect(getRentalStatusLabel('returned')).toBe('Returned');
      expect(getRentalStatusLabel('cancelled')).toBe('Cancelled');
    });

    it('getRentalStatusBadgeClass maps to corresponding design system badge classes', () => {
      expect(getRentalStatusBadgeClass('quotation')).toBe('badge-warning');
      expect(getRentalStatusBadgeClass('confirmed')).toBe('badge-info');
      expect(getRentalStatusBadgeClass('picked_up')).toBe('badge-success');
      expect(getRentalStatusBadgeClass('returned')).toBe('badge-neutral');
      expect(getRentalStatusBadgeClass('cancelled')).toBe('badge-danger');
    });
  });
});
