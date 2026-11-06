import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchInvoices,
  fetchInvoiceById,
  createSupplierInvoice,
  createCustomerInvoice,
  markInvoicePayment,
  computeInvoiceTotals,
  fetchParties,
  InvoiceListItem,
  InvoiceDetail,
  CreateSupplierInvoicePayload,
  CreateCustomerInvoicePayload,
} from '../data/invoicesSource';
import { api } from '../api/client';

describe('invoicesSource — Data fetching, creation & role policy', () => {
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
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('computeInvoiceTotals', () => {
    it('accurately computes subtotal, 15% VAT, and total without float drift', () => {
      const lines = [
        { quantity: 5, unit_price: 45.5 }, // 227.50
        { quantity: 2, unit_price: 100 },  // 200.00
      ];
      const res = computeInvoiceTotals(lines);

      expect(res.subtotal).toBe(427.5);
      expect(res.vat_amount).toBe(64.13); // 427.50 * 0.15 = 64.125 -> 64.13
      expect(res.total).toBe(491.63);      // 427.50 + 64.13 = 491.63
    });

    it('handles decimal quantities and 4-decimal unit prices cleanly with decimal.js', () => {
      const lines = [
        { quantity: '10.5', unit_price: '4.5555' }, // 47.83275 -> 47.83
      ];
      const res = computeInvoiceTotals(lines);

      expect(res.subtotal).toBe(47.83);
      expect(res.vat_amount).toBe(7.17); // 47.83 * 0.15 = 7.1745 -> 7.17
      expect(res.total).toBe(55.0);
    });

    it('supports customizable VAT rate percentage with decimal.js', () => {
      const lines = [{ quantity: 10, unit_price: 100 }]; // 1000.00
      const resZero = computeInvoiceTotals(lines, 0);
      expect(resZero.subtotal).toBe(1000);
      expect(resZero.vat_amount).toBe(0);
      expect(resZero.total).toBe(1000);

      const resFive = computeInvoiceTotals(lines, 5);
      expect(resFive.subtotal).toBe(1000);
      expect(resFive.vat_amount).toBe(50);
      expect(resFive.total).toBe(1050);
    });
  });

  describe('fetchParties', () => {
    it('queries GET /api/parties with role and search query for admin', async () => {
      const apiSpy = vi.spyOn(api, 'get').mockResolvedValueOnce({
        data: [
          {
            id: 1,
            name: 'Gulf Heavy Metals Trading',
            contact_person: 'Ahmed',
            phone: null,
            email: null,
            vat_no: '3000000001',
            address: null,
            notes: null,
            is_customer: false,
            is_supplier: true,
            active: true,
            created_at: '2026-10-27T00:00:00Z',
          },
        ],
        count: 1,
      });

      const res = await fetchParties('supplier', 'Gulf');
      expect(apiSpy).toHaveBeenCalledWith('/api/parties?role=supplier&search=Gulf');
      expect(res).toHaveLength(1);
      expect(res[0].name).toBe('Gulf Heavy Metals Trading');
    });
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

  describe('createSupplierInvoice', () => {
    const sampleSupplierPayload: CreateSupplierInvoicePayload = {
      party_id: 2,
      invoice_no: 'INV-SUP-2026-999',
      invoice_date: '2026-11-04',
      due_date: '2026-12-04',
      subtotal: 455.0,
      vat_amount: 68.25,
      total: 523.25,
      notes: 'Stock replenishment for yard',
      file_url: 'invoices/scan-999.pdf',
      record_stock_receipt: true,
      lines: [
        {
          item_id: 1,
          description: 'Hydraulic Oil ISO 46',
          quantity: 10,
          unit_id: 1,
          unit_price: 45.5,
        },
      ],
    };

    it('posts supplier invoice payload for admin', async () => {
      const apiSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({
        message: 'Supplier invoice recorded successfully.',
        invoice_id: 42,
        invoice_no: 'INV-SUP-2026-999',
        lines_recorded: 1,
      });

      const res = await createSupplierInvoice(sampleSupplierPayload, 'admin');

      expect(apiSpy).toHaveBeenCalledWith('/api/invoices/supplier', sampleSupplierPayload);
      expect(res.invoice_id).toBe(42);
      expect(res.invoice_no).toBe('INV-SUP-2026-999');
    });

    it('rejects creation attempt by non-admin users without sending request', async () => {
      const apiSpy = vi.spyOn(api, 'post');

      await expect(createSupplierInvoice(sampleSupplierPayload, 'staff')).rejects.toThrow(
        /Unauthorized: Only administrators can record supplier invoices/
      );
      expect(apiSpy).not.toHaveBeenCalled();
    });
  });

  describe('createCustomerInvoice', () => {
    const sampleCustomerPayload: CreateCustomerInvoicePayload = {
      party_id: 4,
      invoice_no: 'INV-CUST-2026-888',
      rental_id: 1,
      invoice_date: '2026-11-04',
      due_date: '2026-12-04',
      subtotal: 1000.0,
      vat_amount: 150.0,
      total: 1150.0,
      notes: 'Monthly crane rental invoice',
      file_url: 'invoices/billing-888.pdf',
      lines: [
        {
          description: 'Rough Terrain Crane 50T - Monthly Rental',
          item_id: null,
          quantity: 1,
          unit_id: 1,
          unit_price: 1000.0,
        },
      ],
    };

    it('posts customer invoice payload for admin', async () => {
      const apiSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({
        message: 'Customer invoice recorded successfully',
        invoice_id: 43,
        invoice_no: 'INV-CUST-2026-888',
        direction: 'issued',
        lines_recorded: 1,
      });

      const res = await createCustomerInvoice(sampleCustomerPayload, 'admin');

      expect(apiSpy).toHaveBeenCalledWith('/api/invoices/customer', sampleCustomerPayload);
      expect(res.invoice_id).toBe(43);
      expect(res.invoice_no).toBe('INV-CUST-2026-888');
    });

    it('rejects customer invoice creation by non-admin users without sending request', async () => {
      const apiSpy = vi.spyOn(api, 'post');

      await expect(createCustomerInvoice(sampleCustomerPayload, 'staff')).rejects.toThrow(
        /Unauthorized: Only administrators can record customer invoices/
      );
      expect(apiSpy).not.toHaveBeenCalled();
    });
  });

  describe('markInvoicePayment', () => {
    it('sends PATCH request to record invoice payment for admin', async () => {
      const apiSpy = vi.spyOn(api, 'patch').mockResolvedValueOnce({
        message: 'Invoice marked as paid successfully',
        data: {
          id: 1,
          direction: 'received',
          invoice_no: 'INV-SUP-001',
          status: 'paid',
          paid_on: '2026-11-04',
          paid_by: 1,
        },
      });

      const res = await markInvoicePayment(1, '2026-11-04', 'admin');

      expect(apiSpy).toHaveBeenCalledWith('/api/invoices/1/payment', {
        paid_on: '2026-11-04',
      });
      expect(res.data.status).toBe('paid');
      expect(res.data.paid_on).toBe('2026-11-04');
      expect(res.data.invoice_no).toBe('INV-SUP-001');
    });

    it('rejects mark invoice payment by non-admin users without sending request', async () => {
      const apiSpy = vi.spyOn(api, 'patch');

      await expect(markInvoicePayment(1, '2026-11-04', 'staff')).rejects.toThrow(
        /Unauthorized: Only administrators can record invoice payments/
      );
      expect(apiSpy).not.toHaveBeenCalled();
    });
  });
});
