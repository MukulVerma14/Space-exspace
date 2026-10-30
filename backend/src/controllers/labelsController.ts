import { Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import {
  generateQrCodeDataUrl,
  renderPrintableHtmlGrid,
  RenderedLabelItem,
} from '../services/labelService.js';

export const MAX_LABELS_LIMIT = 50;

const labelsSheetQuerySchema = z.object({
  assetCodes: z.union([z.string(), z.array(z.string())]).optional(),
  type_id: z.coerce.number().int().positive().optional(),
  type: z.string().trim().optional(),
  status: z.enum(['available', 'rented', 'under_repair']).optional(),
  location_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  format: z.enum(['html', 'json']).optional(),
});

/**
 * GET /api/labels/sheet
 * Generates an A4 printable sheet or JSON feed of equipment QR labels.
 *
 * Requirements:
 * - QR payload contains ONLY the plain asset_code (no URL, no prefixes).
 * - QR uses error correction level 'H' (High ~30% recovery) for rugged outdoor yard tags.
 * - Displays asset code in large bold typography + make/model + type + capacity.
 * - STRICT INVARIANT: Contains zero financial data (no rates, costs, replacement values, prices).
 * - Enforces a hard cap of 50 labels per request.
 * - Unknown asset codes return HTTP 404.
 */
export async function getLabelsSheet(req: Request, res: Response) {
  const parseResult = labelsSheetQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid query parameters',
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { assetCodes, type_id, type, status, location_id, limit, format } = parseResult.data;

  // 1. Process explicit assetCodes if provided
  let requestedCodes: string[] = [];
  if (assetCodes !== undefined) {
    if (Array.isArray(assetCodes)) {
      requestedCodes = assetCodes
        .flatMap((code) => code.split(','))
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
    } else {
      requestedCodes = assetCodes
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
    }

    if (requestedCodes.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'assetCodes parameter cannot be empty when supplied',
      });
    }

    // Hard cap enforcement for explicit codes
    if (requestedCodes.length > MAX_LABELS_LIMIT) {
      return res.status(400).json({
        error: 'Label limit exceeded',
        message: `Requested ${requestedCodes.length} asset codes exceeds the hard cap of ${MAX_LABELS_LIMIT} labels per sheet`,
      });
    }
  }

  // 2. Validate limit parameter if explicitly provided
  if (limit !== undefined && limit > MAX_LABELS_LIMIT) {
    return res.status(400).json({
      error: 'Label limit exceeded',
      message: `Requested limit of ${limit} exceeds the hard cap of ${MAX_LABELS_LIMIT} labels per sheet`,
    });
  }

  // 3. Ensure either assetCodes OR at least one filter criterion is provided
  const hasFilter = type_id !== undefined || type !== undefined || status !== undefined || location_id !== undefined;
  if (requestedCodes.length === 0 && !hasFilter) {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'Must provide either assetCodes or filter criteria (type_id, type, status, location_id)',
    });
  }

  let equipmentRows: Array<{
    asset_code: string;
    serial_no: string;
    make: string;
    model: string;
    type_name: string;
    capacity_value: string | number | null;
    capacity_unit: string | null;
    current_location_name: string | null;
  }> = [];

  if (requestedCodes.length > 0) {
    // Query exact requested asset codes
    const query = `
      SELECT
        asset_code,
        serial_no,
        make,
        model,
        type_name,
        capacity_value,
        capacity_unit,
        current_location_name
      FROM v_equipment_current
      WHERE asset_code = ANY($1::text[])
        AND active = true
      ORDER BY asset_code ASC
    `;
    const result = await pool.query(query, [requestedCodes]);

    // Check for any unknown / non-existent asset codes
    const foundCodes = new Set(result.rows.map((r: { asset_code: string }) => r.asset_code.toUpperCase()));
    const missing = requestedCodes.filter((c) => !foundCodes.has(c.toUpperCase()));

    if (missing.length > 0) {
      return res.status(404).json({
        error: 'Equipment not found',
        message: `One or more requested asset codes do not exist: ${missing.join(', ')}`,
      });
    }

    equipmentRows = result.rows;
  } else {
    // Query by filter criteria
    const conditions: string[] = ['active = true'];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (type_id) {
      conditions.push(`type_id = $${paramIdx}`);
      values.push(type_id);
      paramIdx++;
    }

    if (type) {
      conditions.push(`type_name ILIKE $${paramIdx}`);
      values.push(`%${type}%`);
      paramIdx++;
    }

    if (status) {
      conditions.push(`status = $${paramIdx}`);
      values.push(status);
      paramIdx++;
    }

    if (location_id) {
      conditions.push(`current_location_id = $${paramIdx}`);
      values.push(location_id);
      paramIdx++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Check count first to enforce hard cap
    const countQuery = `SELECT COUNT(*) AS total FROM v_equipment_current ${whereClause}`;
    const countRes = await pool.query(countQuery, values);
    const total = parseInt(countRes.rows[0].total, 10);

    if (total === 0) {
      return res.status(404).json({
        error: 'Equipment not found',
        message: 'No equipment found matching the specified filter criteria',
      });
    }

    const effectiveLimit = limit !== undefined ? limit : MAX_LABELS_LIMIT;

    if (limit === undefined && total > MAX_LABELS_LIMIT) {
      return res.status(400).json({
        error: 'Label limit exceeded',
        message: `Filter matched ${total} items, exceeding the hard cap of ${MAX_LABELS_LIMIT} labels per sheet. Please narrow your filter or provide explicit assetCodes.`,
      });
    }

    const query = `
      SELECT
        asset_code,
        serial_no,
        make,
        model,
        type_name,
        capacity_value,
        capacity_unit,
        current_location_name
      FROM v_equipment_current
      ${whereClause}
      ORDER BY asset_code ASC
      LIMIT $${paramIdx}
    `;
    values.push(effectiveLimit);

    const result = await pool.query(query, values);
    equipmentRows = result.rows;
  }

  // Generate QR code data URLs in parallel
  const renderedItems: RenderedLabelItem[] = await Promise.all(
    equipmentRows.map(async (row) => {
      const qrDataUrl = await generateQrCodeDataUrl(row.asset_code);
      return {
        asset_code: row.asset_code,
        serial_no: row.serial_no,
        make: row.make,
        model: row.model,
        type_name: row.type_name,
        capacity_value: row.capacity_value,
        capacity_unit: row.capacity_unit,
        current_location_name: row.current_location_name,
        qr_data_url: qrDataUrl,
      };
    })
  );

  // Determine response format:
  // If format=json is explicitly set, OR client requests application/json and not text/html
  const wantsJson =
    format === 'json' ||
    (format !== 'html' &&
      req.headers.accept?.includes('application/json') &&
      !req.headers.accept?.includes('text/html'));

  if (wantsJson) {
    return res.status(200).json({
      count: renderedItems.length,
      labels: renderedItems,
    });
  }

  const html = renderPrintableHtmlGrid(renderedItems);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
