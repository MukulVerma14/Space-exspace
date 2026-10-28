import { Router } from 'express';
import {
  listMaterials,
  getMaterialById,
  getMaterialMovements,
  recordStockMovement,
  getMaterialPriceHistory
} from '../controllers/materialsController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// List materials with live stock on hand (Admin & Staff)
router.get('/', authenticate, listMaterials);

// Get single material SKU details
router.get('/:id', authenticate, getMaterialById);

// Get chronological ledger movements (Admin & Staff; unit_cost scrubbed for staff)
router.get('/:id/movements', authenticate, getMaterialMovements);

// Record stock receipt, issue, or adjustment (Admin & Staff; negative stock rejected by trigger)
router.post('/movements', authenticate, recordStockMovement);

// Track material purchase prices over time via supplier invoices (Admin only)
router.get('/:id/price-history', authenticate, requireRole('admin'), getMaterialPriceHistory);

export default router;
