import { Router } from 'express';
import {
  listInvoices,
  getInvoiceById,
  createSupplierInvoice,
  createCustomerInvoice,
  markInvoicePayment,
  voidInvoice
} from '../controllers/invoicesController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// Invoices are restricted to Admin role (commercial accounting & pricing)
router.use(authenticate, requireRole('admin'));

// List invoices (with filters for direction, status, party)
router.get('/', listInvoices);

// Get single invoice with lines
router.get('/:id', getInvoiceById);

// Record received supplier invoice with line items (updates material price history and stock)
router.post('/supplier', createSupplierInvoice);

// Record issued customer invoice with line items (commercial rental/service billing, no stock movements)
router.post('/customer', createCustomerInvoice);

// Mark invoice as paid (works for both issued and received invoices)
router.patch('/:id/payment', markInvoicePayment);

// Void an unpaid, non-void invoice (creates compensating stock movement for received invoices, never deletes)
router.patch('/:id/void', voidInvoice);

export default router;
