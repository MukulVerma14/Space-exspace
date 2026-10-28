/**
 * Mock equipment data matching the GET /api/equipment response shape.
 *
 * WHY MOCK:
 * F2 builds the UI pattern (search, filter, debounce, card layout) independently
 * of backend availability. The shape below exactly matches the v_equipment_current
 * SQL view fields so swapping in a real API call requires zero UI changes.
 *
 * When the backend is available, replace the mock filter logic in
 * EquipmentListPage with: api.get(`/api/equipment?search=${q}&status=${status}`)
 */

export type EquipmentStatus = 'available' | 'rented' | 'under_repair' | 'inactive';
export type EquipmentCondition = 'excellent' | 'good' | 'fair' | 'poor';

export interface MockEquipment {
  id: number;
  asset_code: string;
  make: string;
  model: string;
  type_name: string;
  serial_no: string;
  condition: EquipmentCondition;
  status: EquipmentStatus;
  current_location_name: string | null;
  current_location_kind: string | null;
  active: boolean;
}

export const MOCK_EQUIPMENT: MockEquipment[] = [
  {
    id: 1,
    asset_code: 'CRN-50-001',
    make: 'Tadano',
    model: 'GR-500EX',
    type_name: 'Hydraulic Mobile Crane',
    serial_no: 'TDN-GR500-2021-001',
    condition: 'good',
    status: 'rented',
    current_location_name: 'King Salman Port Terminal Site',
    current_location_kind: 'client_site',
    active: true,
  },
  {
    id: 2,
    asset_code: 'CRN-80-001',
    make: 'Liebherr',
    model: 'LTM 1080-1',
    type_name: 'Hydraulic Mobile Crane',
    serial_no: 'LBH-LTM80-2020-004',
    condition: 'excellent',
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
    type_name: 'Hydraulic Mobile Crane',
    serial_no: 'TDN-GR250-2022-001',
    condition: 'fair',
    status: 'under_repair',
    current_location_name: 'Al-Khobar Workshop',
    current_location_kind: 'workshop',
    active: true,
  },
  {
    id: 4,
    asset_code: 'CON-20-001',
    make: 'Thurston',
    model: 'HC-20',
    type_name: 'Heavy Container',
    serial_no: 'THU-HC20-2019-011',
    condition: 'good',
    status: 'rented',
    current_location_name: 'Jubail Industrial City Site A',
    current_location_kind: 'client_site',
    active: true,
  },
  {
    id: 5,
    asset_code: 'CON-10-001',
    make: 'Thurston',
    model: 'HC-10',
    type_name: 'Heavy Container',
    serial_no: 'THU-HC10-2020-007',
    condition: 'excellent',
    status: 'available',
    current_location_name: 'Dammam Main Yard',
    current_location_kind: 'yard',
    active: true,
  },
  {
    id: 6,
    asset_code: 'PSO-STD-001',
    make: 'Algeco',
    model: 'A120',
    type_name: 'Portable Site Office',
    serial_no: 'ALG-A120-2021-003',
    condition: 'good',
    status: 'rented',
    current_location_name: 'Ras Tanura Refinery Expansion',
    current_location_kind: 'client_site',
    active: true,
  },
  {
    id: 7,
    asset_code: 'PSO-STD-002',
    make: 'Algeco',
    model: 'A120',
    type_name: 'Portable Site Office',
    serial_no: 'ALG-A120-2021-004',
    condition: 'excellent',
    status: 'available',
    current_location_name: 'Dammam Main Yard',
    current_location_kind: 'yard',
    active: true,
  },
  {
    id: 8,
    asset_code: 'GEN-250-001',
    make: 'Caterpillar',
    model: 'XQ250',
    type_name: 'Diesel Generator',
    serial_no: 'CAT-XQ250-2022-018',
    condition: 'excellent',
    status: 'rented',
    current_location_name: 'King Salman Port Terminal Site',
    current_location_kind: 'client_site',
    active: true,
  },
  {
    id: 9,
    asset_code: 'GEN-100-001',
    make: 'Perkins',
    model: 'P100',
    type_name: 'Diesel Generator',
    serial_no: 'PRK-P100-2020-022',
    condition: 'fair',
    status: 'available',
    current_location_name: 'Dammam Main Yard',
    current_location_kind: 'yard',
    active: true,
  },
  {
    id: 10,
    asset_code: 'CLN-HPS-001',
    make: 'Kärcher',
    model: 'HD 13/35-4',
    type_name: 'High Pressure Cleaner',
    serial_no: 'KAR-HD1335-2023-001',
    condition: 'excellent',
    status: 'available',
    current_location_name: 'Dammam Main Yard',
    current_location_kind: 'yard',
    active: true,
  },
  {
    id: 11,
    asset_code: 'CRN-25-002',
    make: 'Liebherr',
    model: 'LTM 1025',
    type_name: 'Hydraulic Mobile Crane',
    serial_no: 'LBH-LTM25-2018-009',
    condition: 'poor',
    status: 'under_repair',
    current_location_name: 'Al-Khobar Workshop',
    current_location_kind: 'workshop',
    active: true,
  },
  {
    id: 12,
    asset_code: 'GEN-500-001',
    make: 'Caterpillar',
    model: 'XQ500',
    type_name: 'Diesel Generator',
    serial_no: 'CAT-XQ500-2021-005',
    condition: 'good',
    status: 'inactive',
    current_location_name: null,
    current_location_kind: null,
    active: false,
  },
];
