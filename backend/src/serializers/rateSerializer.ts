import { UserRole } from '../types/auth.js';

/**
 * List of sensitive monetary, rate, and customer contact fields that must NEVER be visible to staff.
 * WHY SERVER-SIDE SERIALIZATION: Relying on the UI (React `if role === 'admin'`)
 * to hide sensitive prices or customer contact details is a classic security anti-pattern. Anyone can inspect
 * HTTP responses in browser DevTools or curl the API directly. True defense in depth
 * requires that the server physically omits these fields before sending the JSON response.
 */
const RESTRICTED_KEYS = new Set([
  // Monetary & pricing fields
  'applied_rate',
  'rates',
  'rate_card',
  'rate_cards',
  'amount',
  'unit_price',
  'unit_cost',
  'subtotal',
  'vat_amount',
  'total',
  'discount_note',
  'cost', // maintenance repair costs

  // Customer contact details (Staff responses must contain no customer contact details)
  'customer_contact',
  'customer_phone',
  'contact_person',
  'phone',
  'email',
]);

export const RESTRICTED_RATE_KEYS = RESTRICTED_KEYS;

/**
 * Recursively strips rate, financial, and customer contact fields from any object or array
 * when the requesting user role is NOT 'admin'.
 */
export function sanitizeFinancials<T>(data: T, userRole: UserRole): T {
  // Administrators have full visibility into rate cards, costs, contract prices, and customer contact details
  if (userRole === 'admin') {
    return data;
  }

  // If null, undefined, or primitive, return as is
  if (data === null || data === undefined || typeof data !== 'object') {
    return data;
  }

  // If Date, preserve as Date so JSON serialization produces ISO string
  if (data instanceof Date) {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeFinancials(item, userRole)) as unknown as T;
  }

  // Handle plain objects
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (RESTRICTED_KEYS.has(key)) {
      // Omit the restricted key entirely from staff responses
      continue;
    }

    // Recursively sanitize nested structures
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeFinancials(value, userRole);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}
