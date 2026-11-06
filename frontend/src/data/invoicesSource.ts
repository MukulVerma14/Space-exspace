/**
 * Invoices Data Layer — API client for commercial invoices (Admin only).
 *
 * POLICY:
 * Invoices contain commercial supplier purchase prices and customer rental billings.
 * Restricted strictly to Administrators. Staff receive 403 on the server and are
 * prevented from querying these endpoints on the client.
 *
 * File references (file_url) are strictly stored/treated as plain text references
 * and never rendered as executable or clickable link schemes.
 */

import Decimal from 'decimal.js';
import { api } from '../api/client';
import { formatMoney } from './materialsSource';

export type InvoiceDirection = 'received' | 'issued';
export type InvoiceStatus = 'unpaid' | 'paid' | 'void';

export interface InvoiceListItem {
  id: number;
  direction: InvoiceDirection;
  invoice_no: string;
  party_id: number;
  party_name: string;
  rental_id: number | null;
  invoice_date: string;
  due_date: string;
  subtotal: string | number;
  vat_amount: string | number;
  total: string | number;
  status: InvoiceStatus;
  paid_on: string | null;
  paid_by: number | null;
  paid_by_name?: string | null;
  voided_at: string | null;
  voided_by: number | null;
  voided_by_name?: string | null;
  void_reason?: string | null;
  file_url: string | null;
  notes?: string | null;
  line_count?: number;
  created_at: string;
}

export interface InvoiceLineItem {
  line_no: number;
  description: string;
  item_id: number | null;
  item_sku?: string | null;
  item_name?: string | null;
  quantity: string | number;
  unit_id: number;
  unit_code?: string;
  unit_price: string | number;
  line_total: string | number;
}

export interface InvoiceDetail extends InvoiceListItem {
  party_vat_no?: string | null;
  lines: InvoiceLineItem[];
}

export interface InvoicesQueryParams {
  direction?: 'all' | 'received' | 'issued';
  status?: 'all' | 'unpaid' | 'paid' | 'void';
  party_id?: number;
  page?: number;
  limit?: number;
}

export interface InvoicesListResponse {
  data: InvoiceListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface CreateSupplierInvoiceLinePayload {
  item_id: number;
  description: string;
  quantity: number;
  unit_id: number;
  unit_price: number;
}

export interface CreateSupplierInvoicePayload {
  party_id: number;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  notes?: string | null;
  file_url?: string | null;
  record_stock_receipt: boolean;
  lines: CreateSupplierInvoiceLinePayload[];
}

export interface CreateCustomerInvoiceLinePayload {
  description: string;
  item_id?: number | null;
  quantity: number;
  unit_id: number;
  unit_price: number;
}

export interface CreateCustomerInvoicePayload {
  party_id: number;
  invoice_no: string;
  rental_id?: number | null;
  invoice_date: string;
  due_date: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  notes?: string | null;
  file_url?: string | null;
  lines: CreateCustomerInvoiceLinePayload[];
}

export interface CreateInvoiceResponse {
  message: string;
  invoice_id: number;
  invoice_no: string;
  direction?: string;
  lines_recorded: number;
  subtotal?: number;
  vat_amount?: number;
  total?: number;
}

export interface MarkInvoicePaymentData {
  id: number;
  direction: string;
  invoice_no: string;
  status: 'paid';
  paid_on: string;
  paid_by: number;
}

export interface MarkInvoicePaymentResponse {
  message: string;
  data: MarkInvoicePaymentData;
}

export interface PartyItem {
  id: number;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  vat_no: string | null;
  address: string | null;
  notes?: string | null;
  line_count?: number;
  is_customer: boolean;
  is_supplier: boolean;
  active: boolean;
  created_at: string;
}

/**
 * Accurately computes invoice totals (subtotal, configurable VAT %, grand total)
 * using arbitrary-precision decimal arithmetic (decimal.js) with standard commercial half-up rounding.
 */
export function computeInvoiceTotals(
  lines: Array<{ quantity: number | string; unit_price: number | string }>,
  vatRatePercent: number | string = 15
): { subtotal: number; vat_amount: number; total: number; vat_rate: number } {
  let subtotal = new Decimal(0);
  const vatRate = new Decimal(
    vatRatePercent !== undefined && vatRatePercent !== '' ? String(vatRatePercent) : '0'
  );

  for (const line of lines) {
    let q: Decimal;
    let p: Decimal;
    try {
      q = new Decimal(String(line.quantity || 0));
      if (!q.isFinite() || q.isNaN()) q = new Decimal(0);
    } catch {
      q = new Decimal(0);
    }
    try {
      p = new Decimal(String(line.unit_price || 0));
      if (!p.isFinite() || p.isNaN()) p = new Decimal(0);
    } catch {
      p = new Decimal(0);
    }
    const lineTotal = q.times(p).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    subtotal = subtotal.plus(lineTotal);
  }

  const roundedSubtotal = subtotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const vatAmount = roundedSubtotal
    .times(vatRate.dividedBy(100))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const total = roundedSubtotal.plus(vatAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    subtotal: roundedSubtotal.toNumber(),
    vat_amount: vatAmount.toNumber(),
    total: total.toNumber(),
    vat_rate: vatRate.toNumber(),
  };
}

/**
 * Fetches parties from the backend with role and optional search filter.
 * Admin only.
 */
export async function fetchParties(
  role?: 'customer' | 'supplier',
  search?: string
): Promise<PartyItem[]> {
  const params: string[] = [];
  if (role) params.push(`role=${encodeURIComponent(role)}`);
  if (search && search.trim()) params.push(`search=${encodeURIComponent(search.trim())}`);
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  const res = await api.get<{ data: PartyItem[]; count: number }>(`/api/parties${query}`);
  return res.data || [];
}

/**
 * Fetches paginated invoices matching filters.
 * Admin only.
 */
export async function fetchInvoices(
  params?: InvoicesQueryParams,
  userRole?: string
): Promise<InvoicesListResponse> {
  if (userRole && userRole !== 'admin') {
    throw new Error('Unauthorized: Invoices are restricted to administrators.');
  }

  const queryParts: string[] = [];
  if (params?.direction && params.direction !== 'all') {
    queryParts.push(`direction=${params.direction}`);
  }
  if (params?.status && params.status !== 'all') {
    queryParts.push(`status=${params.status}`);
  }
  if (params?.party_id) {
    queryParts.push(`party_id=${params.party_id}`);
  }
  if (params?.page) {
    queryParts.push(`page=${params.page}`);
  }
  if (params?.limit) {
    queryParts.push(`limit=${params.limit}`);
  }

  const queryStr = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  return api.get<InvoicesListResponse>(`/api/invoices${queryStr}`);
}

/**
 * Fetches single invoice detail including all line items.
 * Admin only.
 */
export async function fetchInvoiceById(
  id: number,
  userRole?: string
): Promise<InvoiceDetail> {
  if (userRole && userRole !== 'admin') {
    throw new Error('Unauthorized: Invoices are restricted to administrators.');
  }

  const res = await api.get<{ data: InvoiceDetail }>(`/api/invoices/${id}`);
  return res.data;
}

/**
 * Creates a received supplier invoice with line items and optional stock movement receipts.
 * Admin only.
 */
export async function createSupplierInvoice(
  payload: CreateSupplierInvoicePayload,
  userRole?: string
): Promise<CreateInvoiceResponse> {
  if (userRole && userRole !== 'admin') {
    throw new Error('Unauthorized: Only administrators can record supplier invoices.');
  }

  return api.post<CreateInvoiceResponse>('/api/invoices/supplier', payload);
}

/**
 * Creates an issued customer invoice with line items (store-only workflow).
 * Admin only.
 */
export async function createCustomerInvoice(
  payload: CreateCustomerInvoicePayload,
  userRole?: string
): Promise<CreateInvoiceResponse> {
  if (userRole && userRole !== 'admin') {
    throw new Error('Unauthorized: Only administrators can record customer invoices.');
  }

  return api.post<CreateInvoiceResponse>('/api/invoices/customer', payload);
}

/**
 * Marks an invoice as paid (works for both issued and received invoices).
 * Admin only.
 */
export async function markInvoicePayment(
  invoiceId: number,
  paidOn?: string,
  userRole?: string
): Promise<MarkInvoicePaymentResponse> {
  if (userRole && userRole !== 'admin') {
    throw new Error('Unauthorized: Only administrators can record invoice payments.');
  }

  return api.patch<MarkInvoicePaymentResponse>(`/api/invoices/${invoiceId}/payment`, {
    paid_on: paidOn,
  });
}

export { formatMoney };
