import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  listEquipment,
  getEquipmentByAssetCode,
  moveEquipment,
  returnEquipment,
  sendToRepair,
} from '../controllers/equipmentController.js';

export const equipmentRouter = Router();

// All equipment endpoints require authentication
equipmentRouter.use(authenticate);

// 1. List equipment with search, filters, and pagination
equipmentRouter.get('/', listEquipment);

// 2. Scan equipment by asset_code (the QR scan endpoint)
equipmentRouter.get('/:asset_code', getEquipmentByAssetCode);

// 3. Action: Move equipment to another location (updates location_log in a transaction)
equipmentRouter.post('/:asset_code/move', moveEquipment);

// 4. Action: Return equipment from rental (sets returned_at, updates location_log in a transaction)
equipmentRouter.post('/:asset_code/return', returnEquipment);

// 5. Action: Send equipment to repair / maintenance (opens maintenance, updates location_log in a transaction)
equipmentRouter.post('/:asset_code/repair', sendToRepair);
