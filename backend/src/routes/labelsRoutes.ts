import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getLabelsSheet } from '../controllers/labelsController.js';

export const labelsRouter = Router();

// Any authenticated user (admin or staff) can generate printable QR label sheets
labelsRouter.use(authenticate);

// GET /api/labels/sheet?assetCodes=A,B,C or filter params
labelsRouter.get('/sheet', getLabelsSheet);
