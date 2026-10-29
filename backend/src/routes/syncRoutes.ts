import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { processSyncBatch, getSyncSnapshot } from '../controllers/syncController.js';

export const syncRouter = Router();

/**
 * GET /api/sync/snapshot
 * Returns cacheable operational data according to caller's role:
 * - Equipment list with current status and location
 * - Locations list (yards, client sites, workshops)
 * - Materials items list with current stock levels
 * Includes server_time and deterministic ETag header for conditional requests (If-None-Match).
 * Staff responses contain zero financial or money fields (rates, prices, costs).
 */
syncRouter.get('/snapshot', authenticate, getSyncSnapshot);

/**
 * POST /api/sync
 * Replays offline event batches (max 50 events).
 * Accessible to authenticated Staff and Admin.
 */
syncRouter.post('/', authenticate, processSyncBatch);
