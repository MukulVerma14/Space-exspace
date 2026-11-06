import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateDaysOverdue,
  isDateOverdue,
  extractOverdueFromEquipment,
  loadDashboardData,
  DashboardData,
} from '../data/dashboardSource';
import * as equipmentSource from '../data/equipmentSource';
import * as materialsSource from '../data/materialsSource';
import * as dbModule from '../offline/db';
import { enqueueEvent, listEvents, discardEvent, markRejected } from '../offline/outbox';
import type { MockEquipment } from '../data/equipmentSource';
import type { MaterialItem } from '../data/materialsSource';

describe('Admin Dashboard Operations Intelligence (F-S3)', () => {
  const referenceDate = new Date('2026-11-06T12:00:00Z');

  const sampleEquipment: MockEquipment[] = [
    {
      id: 1,
      asset_code: 'CRN-50-001',
      make: 'Tadano',
      model: 'GR-500EX',
      type_name: 'Rough Terrain Crane',
      serial_no: 'TD-001',
      condition: 'good',
      status: 'rented',
      current_location_name: 'King Salman Port Site',
      current_location_kind: 'client_site',
      active: true,
      current_rental_id: 101,
      current_customer_name: 'Aramco Site Services',
      current_site_name: 'King Salman Port Site',
      current_rental_expected_end: '2026-10-20', // Overdue (17 days)
    },
    {
      id: 2,
      asset_code: 'CRN-80-001',
      make: 'Liebherr',
      model: 'LTM 1080',
      type_name: 'All Terrain Crane',
      serial_no: 'LB-002',
      condition: 'good',
      status: 'available',
      current_location_name: 'Dammam Main Yard',
      current_location_kind: 'yard',
      active: true,
    },
    {
      id: 3,
      asset_code: 'CRN-25-001',
      make: 'Tadano',
      model: 'GR-250N',
      type_name: 'Rough Terrain Crane',
      serial_no: 'TD-003',
      condition: 'fair',
      status: 'under_repair',
      current_location_name: 'Central Workshop',
      current_location_kind: 'workshop',
      active: true,
    },
    {
      id: 4,
      asset_code: 'GEN-250-001',
      make: 'Caterpillar',
      model: 'XQ250',
      type_name: 'Diesel Generator',
      serial_no: 'CAT-004',
      condition: 'good',
      status: 'rented',
      current_location_name: 'Jubail Industrial Yard',
      current_location_kind: 'client_site',
      active: true,
      current_rental_id: 102,
      current_customer_name: 'SABIC Petrochemicals',
      current_site_name: 'Jubail Industrial Yard',
      current_rental_expected_end: '2026-12-15', // Not overdue
    },
    {
      id: 5,
      asset_code: 'PSO-STD-001',
      make: 'Algeco',
      model: 'A120',
      type_name: 'Site Office',
      serial_no: 'ALG-005',
      condition: 'good',
      status: 'rented',
      current_location_name: 'Ras Tanura Site',
      current_location_kind: 'client_site',
      active: true,
      current_rental_id: 103,
      current_customer_name: 'Petro Rabigh',
      current_site_name: 'Ras Tanura Site',
      current_rental_expected_end: '2026-11-01', // Overdue (5 days)
    },
  ];

  const sampleMaterials: MaterialItem[] = [
    {
      id: 1,
      sku: 'OIL-15W40-DRUM',
      name: 'Engine Oil 15W-40',
      category_id: 1,
      category_name: 'Lubricants & Fluids',
      unit_id: 1,
      unit_code: 'Drum',
      unit_name: '208L Drum',
      reorder_level: 10,
      current_stock: 4, // LOW STOCK
      is_low_stock: true,
    },
    {
      id: 2,
      sku: 'FILT-CAT-001',
      name: 'Hydraulic Oil Filter Element',
      category_id: 2,
      category_name: 'Filters & Belts',
      unit_id: 2,
      unit_code: 'EA',
      unit_name: 'Each',
      reorder_level: 15,
      current_stock: 15, // EQUAL TO REORDER LEVEL -> LOW STOCK
      is_low_stock: true,
    },
    {
      id: 3,
      sku: 'GREASE-EP2-TUB',
      name: 'Lithium EP-2 Grease Tub',
      category_id: 1,
      category_name: 'Lubricants & Fluids',
      unit_id: 3,
      unit_code: 'Tub',
      unit_name: '18kg Tub',
      reorder_level: 5,
      current_stock: 22, // HEALTHY STOCK
      is_low_stock: false,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Overdue Returns Calculation & Date Comparisons', () => {
    it('isDateOverdue correctly identifies dates before reference date', () => {
      expect(isDateOverdue('2026-10-31', referenceDate)).toBe(true);
      expect(isDateOverdue('2026-11-05', referenceDate)).toBe(true);
      expect(isDateOverdue('2026-11-06', referenceDate)).toBe(false); // Today is not overdue
      expect(isDateOverdue('2026-12-01', referenceDate)).toBe(false); // Future date
      expect(isDateOverdue(null, referenceDate)).toBe(false);
      expect(isDateOverdue(undefined, referenceDate)).toBe(false);
    });

    it('calculateDaysOverdue accurately computes elapsed days past return date', () => {
      const days = calculateDaysOverdue('2026-10-20', referenceDate);
      expect(days).toBe(17);

      const daysRecent = calculateDaysOverdue('2026-11-01', referenceDate);
      expect(daysRecent).toBe(5);

      const daysFuture = calculateDaysOverdue('2026-11-20', referenceDate);
      expect(daysFuture).toBe(0);
    });

    it('extractOverdueFromEquipment extracts only rented assets that are overdue, sorted by days overdue descending', () => {
      const overdues = extractOverdueFromEquipment(sampleEquipment, referenceDate);
      expect(overdues.length).toBe(2);

      // CRN-50-001 (17 days) should be first
      expect(overdues[0].asset_code).toBe('CRN-50-001');
      expect(overdues[0].days_overdue).toBe(17);
      expect(overdues[0].customer_name).toBe('Aramco Site Services');

      // PSO-STD-001 (5 days) should be second
      expect(overdues[1].asset_code).toBe('PSO-STD-001');
      expect(overdues[1].days_overdue).toBe(5);

      // Non-overdue (GEN-250-001) or non-rented (CRN-80-001, CRN-25-001) excluded
      expect(overdues.some((o) => o.asset_code === 'GEN-250-001')).toBe(false);
      expect(overdues.some((o) => o.asset_code === 'CRN-80-001')).toBe(false);
      expect(overdues.some((o) => o.asset_code === 'CRN-25-001')).toBe(false);
    });
  });

  describe('Fleet Status Counters & Aggregation', () => {
    it('aggregates total, available, rented, and under_repair status counts correctly', async () => {
      vi.spyOn(equipmentSource, 'loadEquipment').mockResolvedValueOnce({
        items: sampleEquipment,
        source: 'live',
        savedAt: '2026-11-06T10:00:00Z',
      });

      vi.spyOn(materialsSource, 'loadMaterials').mockResolvedValueOnce({
        items: sampleMaterials,
        source: 'live',
        savedAt: '2026-11-06T10:00:00Z',
      });

      const data: DashboardData = await loadDashboardData(1, referenceDate);

      expect(data.statusCounts.total).toBe(5);
      expect(data.statusCounts.available).toBe(1); // CRN-80-001
      expect(data.statusCounts.rented).toBe(3); // CRN-50-001, GEN-250-001, PSO-STD-001
      expect(data.statusCounts.under_repair).toBe(1); // CRN-25-001
    });
  });

  describe('Low-Stock Materials Detection', () => {
    it('filters inventory items where current_stock <= reorder_level', async () => {
      vi.spyOn(equipmentSource, 'loadEquipment').mockResolvedValueOnce({
        items: sampleEquipment,
        source: 'live',
        savedAt: '2026-11-06T10:00:00Z',
      });

      vi.spyOn(materialsSource, 'loadMaterials').mockResolvedValueOnce({
        items: sampleMaterials,
        source: 'live',
        savedAt: '2026-11-06T10:00:00Z',
      });

      const data = await loadDashboardData(1, referenceDate);
      expect(data.lowStockItems.length).toBe(2);

      const skus = data.lowStockItems.map((m) => m.sku);
      expect(skus).toContain('OIL-15W40-DRUM');
      expect(skus).toContain('FILT-CAT-001');
      expect(skus).not.toContain('GREASE-EP2-TUB'); // 22 > 5
    });
  });

  describe('Offline Resilience: Snapshot Operation', () => {
    it('loads dashboard metrics seamlessly when offline using cached snapshots', async () => {
      vi.spyOn(equipmentSource, 'loadEquipment').mockResolvedValueOnce({
        items: sampleEquipment,
        source: 'snapshot',
        savedAt: '2026-11-05T18:00:00Z',
      });

      vi.spyOn(materialsSource, 'loadMaterials').mockResolvedValueOnce({
        items: sampleMaterials,
        source: 'snapshot',
        savedAt: '2026-11-05T18:00:00Z',
      });

      const data = await loadDashboardData(1, referenceDate);
      expect(data.equipmentSource).toBe('snapshot');
      expect(data.materialsSource).toBe('snapshot');
      expect(data.statusCounts.total).toBe(5);
      expect(data.overdueReturns.length).toBe(2);
      expect(data.lowStockItems.length).toBe(2);
    });
  });

  describe('Outbox Integration on the Admin Dashboard', () => {
    let fakeStore: any[] = [];

    beforeEach(() => {
      fakeStore = [];
      const fakeDb: any = {
        put: vi.fn(async (_store: string, item: any) => {
          const idx = fakeStore.findIndex((x) => x.id === item.id);
          if (idx >= 0) fakeStore[idx] = item;
          else fakeStore.push(item);
        }),
        get: vi.fn(async (_store: string, id: string) => fakeStore.find((x) => x.id === id) || null),
        delete: vi.fn(async (_store: string, id: string) => {
          fakeStore = fakeStore.filter((x) => x.id !== id);
        }),
        getAllFromIndex: vi.fn(async (_store: string, _idx: string, userId: number) =>
          fakeStore.filter((x) => x.userId === userId)
        ),
      };
      vi.spyOn(dbModule, 'getDb').mockResolvedValue(fakeDb);
    });

    it('tracks pending outbox actions waiting to sync', async () => {
      await enqueueEvent({
        userId: 1,
        type: 'move',
        assetCode: 'CRN-50-001',
        payload: { location_id: 2 },
      });

      const userEvents = await listEvents(1);
      const pendingEvents = userEvents.filter((e) => e.status === 'pending');
      expect(pendingEvents.length).toBe(1);
      expect(pendingEvents[0].assetCode).toBe('CRN-50-001');
    });

    it('displays server rejected events and allows immediate discard', async () => {
      const event = await enqueueEvent({
        userId: 1,
        type: 'return',
        assetCode: 'CRN-80-001',
        payload: { location_id: 1, condition: 'good' },
      });

      await markRejected(event.id, 'Equipment CRN-80-001 is not actively rented');

      const userEvents = await listEvents(1);
      const rejectedEvents = userEvents.filter((e) => e.status === 'rejected');
      expect(rejectedEvents.length).toBe(1);
      expect(rejectedEvents[0].rejectReason).toBe('Equipment CRN-80-001 is not actively rented');

      // Admin discards the rejected event from the dashboard
      await discardEvent(event.id);

      const afterDiscard = await listEvents(1);
      expect(afterDiscard.length).toBe(0);
    });
  });
});
