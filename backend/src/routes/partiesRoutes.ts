import { Router } from 'express';
import { listParties } from '../controllers/partiesController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// Parties API is restricted to Administrators (commercial billing, suppliers & clients)
router.use(authenticate, requireRole('admin'));

// GET /api/parties?role=customer|supplier&search=
router.get('/', listParties);

export default router;
