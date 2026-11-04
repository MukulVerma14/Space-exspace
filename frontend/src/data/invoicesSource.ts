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
  paid_by_name: string | null;
  voided_by: number | null;
  voided_by_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
  file_url: string | null;
  created_at: string;
  line_count: number;
}

export interface InvoiceLine {
  line_no: number;
  description: string;
  item_id: number | null;
  item_sku?: string | null;
  item_name?: string | null;
  quantity: string | number;
  unit_id: number;
  unit_code: string;
  unit_price: string | number;
  line_total: string | number;
}

export interface InvoiceDetail extends InvoiceListItem {
  party_vat_no?: string | null;
  notes?: string | null;
  lines: InvoiceLine[];
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

export interface InvoicesQueryParams {
  direction?: InvoiceDirection | 'all';
  status?: InvoiceStatus | 'all';
  party_id?: number;
  page?: number;
  limit?: number;
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

export interface CreateInvoiceResponse {
  message: string;
  invoice_id: number;
  invoice_no: string;
  lines_recorded: number;
}

/**
 * Accurately computes invoice totals (subtotal, 15% VAT, total) with 2-decimal half-up rounding.
 */
export function computeInvoiceTotals(
  lines: Array<{ quantity: number | string; unit_price: number | string }>
): { subtotal: number; vat_amount: number; total: number } {
  let subtotalCents = 0;
  for (const line of lines) {
    const q = parseFloat(String(line.quantity)) || 0;
    const p = parseFloat(String(line.unit_price)) || 0;
    const lineTotal = Math.round(q * p * 100);
    subtotalCents += lineTotal;
  }
  const subtotal = subtotalCents / 100;
  const vatAmount = Math.round(subtotal * 15) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;

  return {
    subtotal,
    vat_amount: vatAmount,
    total,
  };
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

export { formatMoney };
