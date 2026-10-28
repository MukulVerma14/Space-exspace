import { Router } from 'express';
import {
  listRentals,
  getRentalById,
  createRental,
  pickupRental,
  returnRental
} from '../controllers/rentalsController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// List rentals (accessible to admin and staff; staff rates are scrubbed)
router.get('/', authenticate, listRentals);

// Get single rental details (staff rates scrubbed)
router.get('/:id', authenticate, getRentalById);

// Create new rental agreement (Admin only: establishes rates and contract terms)
router.post('/', authenticate, requireRole('admin'), createRental);

// Dispatch / Pick up rental agreement (Staff or Admin)
router.post('/:id/pickup', authenticate, pickupRental);

// Return all items on a rental to yard (Staff or Admin)
router.post('/:id/return', authenticate, returnRental);

export default router;
