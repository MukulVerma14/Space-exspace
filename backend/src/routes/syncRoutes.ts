import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { processSyncBatch } from '../controllers/syncController.js';

export const syncRouter = Router();

/**
 * POST /api/sync
 * Replays offline event batches (max 50 events).
 * Accessible to authenticated Staff and Admin.
 */
syncRouter.post('/', authenticate, processSyncBatch);
