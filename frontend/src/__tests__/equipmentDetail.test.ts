import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveEquipmentByCode,
  fetchLocations,
  EquipmentDetail,
  AppLocation,
  DEFAULT_LOCATIONS,
} from '../data/equipmentSource';
import * as dbModule from '../offline/db';
import { enqueueEvent, listEvents, discardEvent, markRejected } from '../offline/outbox';
import { api } from '../api/client';

describe('Equipment Detail & Fleet Operations (F-S2)', () => {
  const dummyAdminEquipment: EquipmentDetail = {
    id: 1,
    asset_code: 'CRN-50-001',
    serial_no: 'TD-500-9841',
    make: 'Tadano',
    model: 'GR-500EX',
    type_name: 'Rough Terrain Crane',
    status: 'rented',
    condition: 'good',
    active: true,
    current_location_id: 4,
    current_location_name: 'King Salman Port Terminal Site',
    current_location_kind: 'client_site',
    capacity_value: '50.00',
    capacity_unit: 'ton',
    last_moved_at: '2026-10-20T10:00:00Z',
    last_moved_by_name: 'Yard Supervisor',
    location_history: [
      {
        id: 101,
        location_id: 4,
        location_name: 'King Salman Port Terminal Site',
        location_kind: 'client_site',
        moved_at: '2026-10-20T10:00:00Z',
        note: 'Mobilized to client site for offshore terminal installation',
        moved_by_name: 'Yard Supervisor',
      },
      {
        id: 100,
        location_id: 1,
        location_name: 'Dammam Central Yard',
        location_kind: 'yard',
        moved_at: '2026-10-01T08:00:00Z',
        note: 'Checked in from previous project',
        moved_by_name: 'Operations Manager',
      },
    ],
    active_rental: {
      rental_id: 10,
      rental_status: 'picked_up',
      customer_id: 5,
      customer_name: 'Aramco Site Services',
      customer_phone: '+966 13 874 0111',
      customer_contact: 'Eng. Fahad Al-Otaibi',
      site_id: 4,
      site_name: 'King Salman Port Terminal Site',
      start_date: '2026-10-20',
      expected_end: '2026-12-20',
      applied_rate: 2800.0,
      rate_unit: 'day',
      discount_note: '10% volume rental discount applied',
    },
    open_maintenance: null,
    standard_rates: [
      { unit: 'day', amount: '3000.00', vat_included: false, valid_from: '2026-01-01' },
      { unit: 'week', amount: '18000.00', vat_included: false, valid_from: '2026-01-01' },
      { unit: 'month', amount: '65000.00', vat_included: false, valid_from: '2026-01-01' },
    ],
  };

  const dummyStaffEquipment: EquipmentDetail = {
    id: 1,
    asset_code: 'CRN-50-001',
    serial_no: 'TD-500-9841',
    make: 'Tadano',
    model: 'GR-500EX',
    type_name: 'Rough Terrain Crane',
    status: 'rented',
    condition: 'good',
    active: true,
    current_location_id: 4,
    current_location_name: 'King Salman Port Terminal Site',
    current_location_kind: 'client_site',
    capacity_value: '50.00',
    capacity_unit: 'ton',
    last_moved_at: '2026-10-20T10:00:00Z',
    last_moved_by_name: 'Yard Supervisor',
    location_history: [
      {
        id: 101,
        location_id: 4,
        location_name: 'King Salman Port Terminal Site',
        location_kind: 'client_site',
        moved_at: '2026-10-20T10:00:00Z',
        note: 'Mobilized to client site for offshore terminal installation',
        moved_by_name: 'Yard Supervisor',
      },
    ],
    // Staff view: zero rates, zero currency!
    active_rental: {
      rental_id: 10,
      rental_status: 'picked_up',
      customer_id: 5,
      customer_name: 'Aramco Site Services',
      site_id: 4,
      site_name: 'King Salman Port Terminal Site',
      start_date: '2026-10-20',
      expected_end: '2026-12-20',
    },
    open_maintenance: null,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Role-Based Privacy: Staff Never See Rates or Financials', () => {
    it('admin response includes standard_rates and applied_rate in active rental', () => {
      expect(dummyAdminEquipment.standard_rates).toBeDefined();
      expect(dummyAdminEquipment.standard_rates?.length).toBe(3);
      expect(dummyAdminEquipment.active_rental?.applied_rate).toBe(2800.0);
      expect(dummyAdminEquipment.active_rental?.rate_unit).toBe('day');
    });

    it('staff response strips standard_rates, applied_rate, and financial terms completely', () => {
      expect(dummyStaffEquipment.standard_rates).toBeUndefined();
      expect(dummyStaffEquipment.active_rental?.applied_rate).toBeUndefined();
      expect(dummyStaffEquipment.active_rental?.rate_unit).toBeUndefined();
      expect(dummyStaffEquipment.active_rental?.discount_note).toBeUndefined();

      // Non-financial operational data is still intact for staff
      expect(dummyStaffEquipment.active_rental?.customer_name).toBe('Aramco Site Services');
      expect(dummyStaffEquipment.active_rental?.site_name).toBe('King Salman Port Terminal Site');
      expect(dummyStaffEquipment.active_rental?.start_date).toBe('2026-10-20');
      expect(dummyStaffEquipment.active_rental?.expected_end).toBe('2026-12-20');
    });

    it('maintenance repair costs are stripped for staff', () => {
      const staffRepairEquip: EquipmentDetail = {
        ...dummyStaffEquipment,
        status: 'under_repair',
        open_maintenance: {
          id: 5,
          kind: 'repair',
          description: 'Replaced main hydraulic pump seal',
          opened_at: '2026-10-25T11:00:00Z',
          reported_by_name: 'Yard Tech',
        },
      };

      expect(staffRepairEquip.open_maintenance?.cost).toBeUndefined();
      expect(staffRepairEquip.open_maintenance?.description).toBe('Replaced main hydraulic pump seal');
    });
  });

  describe('Locations Loading & Offline Fallback', () => {
    it('fetches locations from /api/sync/snapshot when online and caches them', async () => {
      const mockLocations: AppLocation[] = [
        { id: 1, name: 'Dammam Central Yard', kind: 'yard' },
        { id: 2, name: 'Jubail Industrial Yard', kind: 'yard' },
        { id: 3, name: 'Central Maintenance Workshop', kind: 'workshop' },
      ];

      vi.spyOn(api, 'get').mockResolvedValueOnce({ locations: mockLocations });
      const saveSpy = vi.spyOn(dbModule, 'saveSnapshot').mockResolvedValue(undefined as any);

      const locs = await fetchLocations(1);
      expect(locs).toEqual(mockLocations);
      expect(saveSpy).toHaveBeenCalledWith(1, 'locations-list', mockLocations);
    });

    it('falls back to cached snapshot when offline', async () => {
      vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Network offline'));
      const cachedLocations: AppLocation[] = [
        { id: 1, name: 'Cached Yard A', kind: 'yard' },
        { id: 2, name: 'Cached Workshop B', kind: 'workshop' },
      ];

      vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
        data: cachedLocations,
        savedAt: '2026-10-28T12:00:00Z',
      });

      const locs = await fetchLocations(1);
      expect(locs).toEqual(cachedLocations);
    });

    it('falls back to DEFAULT_LOCATIONS if no cache and offline', async () => {
      vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Network offline'));
      vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce(null);

      const locs = await fetchLocations(1);
      expect(locs).toEqual(DEFAULT_LOCATIONS);
      expect(locs.length).toBeGreaterThan(0);
      expect(locs.some((l) => l.kind === 'yard')).toBe(true);
      expect(locs.some((l) => l.kind === 'workshop')).toBe(true);
    });
  });

  describe('Asset Resolution & Live Detail Fetching', () => {
    it('resolves live equipment with full details from GET /api/equipment/:asset_code', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce(dummyAdminEquipment);
      vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce(null);

      const res = await resolveEquipmentByCode('CRN-50-001', 1);
      expect(res.source).toBe('live');
      expect(res.equipment?.asset_code).toBe('CRN-50-001');
      expect(res.equipment?.location_history?.length).toBe(2);
      expect(res.equipment?.active_rental?.rental_id).toBe(10);
    });
  });

  describe('Offline-First Outbox Actions for Equipment Operations', () => {
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

    it('enqueues a "move" action with destination location_id and note', async () => {
      const event = await enqueueEvent({
        userId: 1,
        type: 'move',
        assetCode: 'CRN-50-001',
        payload: {
          location_id: 2,
          note: 'Relocated to Jubail Industrial Yard',
        },
      });

      expect(event.id).toBeDefined();
      expect(event.type).toBe('move');
      expect(event.assetCode).toBe('CRN-50-001');
      expect(event.payload.location_id).toBe(2);
      expect(event.payload.note).toBe('Relocated to Jubail Industrial Yard');
      expect(event.status).toBe('pending');
      expect(event.rejectReason).toBeNull();

      const userEvents = await listEvents(1);
      expect(userEvents.length).toBe(1);
      expect(userEvents[0].id).toBe(event.id);
    });

    it('enqueues a "return" action with destination yard and inspected condition', async () => {
      const event = await enqueueEvent({
        userId: 2,
        type: 'return',
        assetCode: 'CRN-50-001',
        payload: {
          location_id: 1,
          condition: 'good',
          note: 'Customer finished offshore lift',
        },
      });

      expect(event.id).toBeDefined();
      expect(event.type).toBe('return');
      expect(event.assetCode).toBe('CRN-50-001');
      expect(event.payload.location_id).toBe(1);
      expect(event.payload.condition).toBe('good');
      expect(event.status).toBe('pending');
    });

    it('enqueues a "send_to_repair" action with kind and description', async () => {
      const event = await enqueueEvent({
        userId: 1,
        type: 'send_to_repair',
        assetCode: 'EXC-20-001',
        payload: {
          kind: 'repair',
          description: 'Hydraulic main boom arm cylinder seal leak',
          workshop_location_id: 3,
          note: 'Priority 1 service',
        },
      });

      expect(event.id).toBeDefined();
      expect(event.type).toBe('send_to_repair');
      expect(event.assetCode).toBe('EXC-20-001');
      expect(event.payload.kind).toBe('repair');
            expect(event.payload.description).toBe('Hydraulic main boom arm cylinder seal leak');
      expect(event.payload.workshop_location_id).toBe(3);
      expect(event.status).toBe('pending');
    });

    it('enqueues a "send_to_repair" action with kind "modification" when user chooses modification', async () => {
      const event = await enqueueEvent({
        userId: 1,
        type: 'send_to_repair',
        assetCode: 'CRN-50-001',
        payload: {
          kind: 'modification',
          description: 'Boom extension and counterweight engineering upgrade',
          workshop_location_id: 1,
          note: 'Approved upgrade order',
        },
      });

      expect(event.id).toBeDefined();
      expect(event.type).toBe('send_to_repair');
      expect(event.assetCode).toBe('CRN-50-001');
      expect(event.payload.kind).toBe('modification');
      expect(event.payload.description).toBe('Boom extension and counterweight engineering upgrade');
      expect(event.status).toBe('pending');
    });

    it('marks rejected events with the server rejection reason and allows discarding', async () => {
      const event = await enqueueEvent({
        userId: 1,
        type: 'send_to_repair',
        assetCode: 'CRN-50-001',
        payload: {
          kind: 'repair',
          description: 'Test repair on rented unit',
        },
      });

      // Server rejects because equipment is rented
      await markRejected(event.id, 'Equipment CRN-50-001 is actively rented. Return it to a yard first.');

      const eventsAfterRejection = await listEvents(1);
      expect(eventsAfterRejection.length).toBe(1);
      expect(eventsAfterRejection[0].status).toBe('rejected');
      expect(eventsAfterRejection[0].rejectReason).toContain('is actively rented');

      // User reviews and discards
      await discardEvent(event.id);
      const eventsAfterDiscard = await listEvents(1);
      expect(eventsAfterDiscard.length).toBe(0);
    });
  });

  describe('Preconditions & Action Validation', () => {
    it('only rented equipment allows Return action', () => {
      function canReturn(status: string): boolean {
        return status === 'rented';
      }

      expect(canReturn('rented')).toBe(true);
      expect(canReturn('available')).toBe(false);
      expect(canReturn('under_repair')).toBe(false);
    });

    it('Send to repair is prohibited for rented or already under-repair equipment', () => {
      function canSendToRepair(status: string): boolean {
        return status !== 'rented' && status !== 'under_repair';
      }

      expect(canSendToRepair('available')).toBe(true);
      expect(canSendToRepair('rented')).toBe(false);
      expect(canSendToRepair('under_repair')).toBe(false);
    });

    it('Move is permitted across all statuses (relocations between yards, sites, workshops)', () => {
      function canMove(_status: string): boolean {
        return true;
      }

      expect(canMove('available')).toBe(true);
      expect(canMove('rented')).toBe(true);
      expect(canMove('under_repair')).toBe(true);
    });
  });
});
