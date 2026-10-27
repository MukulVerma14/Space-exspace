import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { sanitizeFinancials } from '../serializers/rateSerializer.js';
import { pool } from '../db/pool.js';

export const ratesRouter = Router();

/**
 * Standard Rates Directory.
 * RESTRICTED TO ADMIN ONLY.
 * WHY: Equipment pricing strategy and standard commercial rate cards are proprietary
 * commercial data. Staff members (yard operators, mechanics) have no operational need
 * to access commercial rate cards.
 */
ratesRouter.get(
  '/',
  authenticate,
  requireRole('admin'),
  async (_req: Request, res: Response) => {
    const result = await pool.query(`
      SELECT r.model_id, em.make, em.model, r.unit, r.amount, r.vat_included, r.valid_from
      FROM rates r
      JOIN equipment_models em ON em.id = r.model_id
      ORDER BY em.make, em.model, r.unit
    `);

    return res.status(200).json({
      rates: result.rows,
    });
  }
);

/**
 * Rental Quotation / Agreement Demo Endpoint.
 * ACCESSIBLE TO BOTH ROLES, BUT FILTERED BY SERVER SERIALIZER.
 * WHY: When viewing an equipment's assignment or a rental order, yard staff need to see
 * operational details (asset code, customer, delivery site, rental status) but must NEVER
 * see financial terms (applied_rate, discount_note).
 * The server-side sanitizer physically strips these keys before JSON serialization.
 */
ratesRouter.get(
  '/rental-quote-demo',
  authenticate,
  async (req: Request, res: Response) => {
    const result = await pool.query(`
      SELECT
        r.id AS rental_id,
        r.status AS rental_status,
        p.name AS customer_name,
        l.name AS site_name,
        e.asset_code,
        ri.applied_rate,
        ri.rate_unit,
        ri.discount_note
      FROM rentals r
      JOIN parties p ON p.id = r.customer_id
      JOIN locations l ON l.id = r.site_id
      JOIN rental_items ri ON ri.rental_id = r.id
      JOIN equipment e ON e.id = ri.equipment_id
      ORDER BY r.id ASC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No rental data found to demonstrate' });
    }

    const rawData = result.rows[0];

    // Sanitize based on caller's role (admin gets full financials; staff gets financials stripped)
    const sanitizedData = sanitizeFinancials(rawData, req.user!.role);

    return res.status(200).json({
      role: req.user!.role,
      data: sanitizedData,
    });
  }
);
