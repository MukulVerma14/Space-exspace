import { Router } from 'express';
import {
  listRentals,
  getRentalById,
  createRental,
  confirmRental,
  pickupRental,
  cancelRental,
  returnRental
} from '../controllers/rentalsController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// List rentals (accessible to admin and staff; staff rates & customer contacts scrubbed)
router.get('/', authenticate, listRentals);

// Get single rental details (staff rates & customer contacts scrubbed)
router.get('/:id', authenticate, getRentalById);

// Create new rental agreement (Admin only: establishes rates and contract terms)
router.post('/', authenticate, requireRole('admin'), createRental);

// Confirm rental agreement quotation (Admin only: verifies item availability)
router.post('/:id/confirm', authenticate, requireRole('admin'), confirmRental);

// Dispatch / Pick up rental agreement (Staff or Admin)
router.post('/:id/pickup', authenticate, pickupRental);

// Cancel rental agreement and release items (Admin only)
router.post('/:id/cancel', authenticate, requireRole('admin'), cancelRental);

// Return all items on a rental to yard (Staff or Admin)
router.post('/:id/return', authenticate, returnRental);

export default router;
