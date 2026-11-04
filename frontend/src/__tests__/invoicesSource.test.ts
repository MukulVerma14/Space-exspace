import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchInvoices,
  fetchInvoiceById,
  InvoiceListItem,
  InvoiceDetail,
} from '../data/invoicesSource';
import { api } from '../api/client';

describe('invoicesSource — Data fetching & role policy', () => {
  const dummyInvoices: InvoiceListItem[] = [
    {
      id: 1,
      direction: 'received',
      invoice_no: 'INV-SUP-001',
      party_id: 2,
      party_name: 'TotalEnergies KSA',
      rental_id: null,
      invoice_date: '2026-10-15',
      due_date: '2026-11-15',
      subtotal: '1000.00',
      vat_amount: '150.00',
      total: '1150.00',
      status: 'unpaid',
      paid_on: null,
      paid_by: null,
      paid_by_name: null,
      voided_by: null,
      voided_by_name: null,
      voided_at: null,
      void_reason: null,
      file_url: 'uploads/invoices/inv-001.pdf',
      created_at: '2026-10-15T10:00:00Z',
      line_count: 2,
    },
    {
      id: 2,
      direction: 'issued',
      invoice_no: 'INV-CUST-100',
      party_id: 5,
      party_name: 'Aramco Site Services',
      rental_id: 12,
      invoice_date: '2026-10-20',
      due_date: '2026-11-20',
      subtotal: '5000.00',
      vat_amount: '750.00',
      total: '5750.00',
      status: 'paid',
      paid_on: '2026-10-22',
      paid_by: 1,
      paid_by_name: 'Operations Director',
      voided_by: null,
      voided_by_name: null,
      voided_at: null,
      void_reason: null,
      file_url: null,
      created_at: '2026-10-20T10:00:00Z',
      line_count: 1,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchInvoices', () => {
    it('fetches invoices for admin without filter query params when default', async () => {
      const apiSpy = vi.spyOn(api, 'get').mockResolvedValueOnce({
        data: dummyInvoices,
        pagination: { page: 1, limit: 100, total: 2, total_pages: 1 },
      });

      const res = await fetchInvoices(undefined, 'admin');

      expect(apiSpy).toHaveBeenCalledWith('/api/invoices');
      expect(res.data).toHaveLength(2);
      expect(res.data[0].invoice_no).toBe('INV-SUP-001');
    });

    it('passes direction and status filters in query parameters', async () => {
      const apiSpy = vi.spyOn(api, 'get').mockResolvedValueOnce({
        data: [dummyInvoices[0]],
        pagination: { page: 1, limit: 20, total: 1, total_pages: 1 },
      });

      const res = await fetchInvoices(
        { direction: 'received', status: 'unpaid', page: 1, limit: 20 },
        'admin'
      );

      expect(apiSpy).toHaveBeenCalledWith(
        '/api/invoices?direction=received&status=unpaid&page=1&limit=20'
      );
      expect(res.data).toHaveLength(1);
    });

    it('strictly throws unauthorized error for non-admin users and makes zero API calls', async () => {
      const apiSpy = vi.spyOn(api, 'get');

      await expect(fetchInvoices(undefined, 'staff')).rejects.toThrow(
        /Unauthorized: Invoices are restricted to administrators/
      );
      expect(apiSpy).not.toHaveBeenCalled();
    });
  });

  describe('fetchInvoiceById', () => {
    const dummyDetail: InvoiceDetail = {
      ...dummyInvoices[0],
      party_vat_no: '300012345600003',
      notes: 'Urgent hydraulic filters replenishment',
      lines: [
        {
          line_no: 1,
          description: 'Hydraulic Oil 20L Drum',
          item_id: 1,
          item_sku: 'MAT-001',
          item_name: 'Hydraulic Oil ISO 46',
          quantity: '10.000',
          unit_id: 1,
          unit_code: 'L',
          unit_price: '45.5000',
          line_total: '455.00',
        },
      ],
    };

    it('fetches single invoice details and line items for admin', async () => {
      const apiSpy = vi.spyOn(api, 'get').mockResolvedValueOnce({
        data: dummyDetail,
      });

      const res = await fetchInvoiceById(1, 'admin');

      expect(apiSpy).toHaveBeenCalledWith('/api/invoices/1');
      expect(res.invoice_no).toBe('INV-SUP-001');
      expect(res.lines).toHaveLength(1);
      expect(res.lines[0].item_sku).toBe('MAT-001');
    });

    it('strictly throws unauthorized error for non-admin users when getting invoice by id', async () => {
      const apiSpy = vi.spyOn(api, 'get');

      await expect(fetchInvoiceById(1, 'staff')).rejects.toThrow(
        /Unauthorized: Invoices are restricted to administrators/
      );
      expect(apiSpy).not.toHaveBeenCalled();
    });
  });
});
