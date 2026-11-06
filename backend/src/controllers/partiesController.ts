import { Request, Response } from 'express';
import { pool } from '../db/pool.js';

export interface PartyRecord {
  id: number;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  vat_no: string | null;
  address: string | null;
  notes: string | null;
  is_customer: boolean;
  is_supplier: boolean;
  active: boolean;
  created_at: string;
}

/**
 * List parties with optional role and search filtering.
 * Restricted to Admin role.
 *
 * Query params:
 *   - role: 'customer' | 'supplier' (optional)
 *   - search: string (optional, searches name, contact_person, email, phone)
 */
export async function listParties(req: Request, res: Response): Promise<void> {
  const { role, search } = req.query;

  const whereClauses: string[] = ['active = true'];
  const params: unknown[] = [];

  if (role !== undefined) {
    if (role === 'customer') {
      params.push(true);
      whereClauses.push(`is_customer = $${params.length}`);
    } else if (role === 'supplier') {
      params.push(true);
      whereClauses.push(`is_supplier = $${params.length}`);
    } else {
      res.status(400).json({
        error: "Invalid role filter. Allowed values: 'customer', 'supplier'",
      });
      return;
    }
  }

  if (typeof search === 'string' && search.trim() !== '') {
    params.push(`%${search.trim()}%`);
    const searchIdx = params.length;
    whereClauses.push(
      `(name ILIKE $${searchIdx} OR contact_person ILIKE $${searchIdx} OR email ILIKE $${searchIdx} OR phone ILIKE $${searchIdx})`
    );
  }

  const query = `
    SELECT
      id,
      name,
      contact_person,
      phone,
      email,
      vat_no,
      address,
      notes,
      is_customer,
      is_supplier,
      active,
      created_at
    FROM parties
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY name ASC
  `;

  try {
    const result = await pool.query<PartyRecord>(query, params);
    res.json({
      data: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve parties' });
  }
}
