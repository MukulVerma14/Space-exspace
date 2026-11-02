# ADR 016: Store-Only Issued Customer Invoices, Math Reconciliation Invariants, and Payment State Auditing

## Status
Accepted

## Context
In SPACE EXSPACE Company's equipment and materials management workflow, commercial accounting requires tracking both accounts payable (received supplier invoices) and accounts receivable (issued customer invoices).

In Step 5, we implemented received supplier invoice storage (`POST /api/invoices/supplier`), which simultaneously recorded vendor purchase prices to power material price fluctuation history and posted positive receipts to the single-entry inventory ledger (`stock_movements`).

However, issued customer invoices have fundamentally different operational, commercial, and inventory semantics:
1. **Rental & Service Billing Scope**: Customer invoices bill clients for equipment rental agreements (e.g. mobile crane monthly rentals, site office rentals) or consumables supplied on site. They do not represent incoming physical warehouse stock.
2. **Accounting Reconciliation Integrity**: Client applications or manual accounting entries may submit calculated subtotals, VAT amounts, and gross totals. Allowing arbitrary totals creates a severe risk of ledger discrepancies, rounding drift, or deliberate tampering.
3. **Rental Contract Linkage**: When an invoice references a rental contract (`rental_id`), the rental must exist and belong strictly to that customer party to prevent cross-customer data leakage.
4. **Disallowance of Complex PDF/ZATCA Pipelines**: As confirmed in [Open Questions #4](../OPEN_QUESTIONS.md), full PDF layout generation and ZATCA Phase 2 cryptographic e-invoicing pipelines are out of scope for this prototype; the system is required to store commercial invoices, line items, and payment statuses accurately.
5. **Payment Lifecycle & Auditability**: Once issued or received, invoices require payment tracking (`status = 'paid'`, payment date `paid_on`), which must record who executed the change (`paid_by`), refuse future dates, and reject payments against already paid or void records.

---

## Decisions

### 1. Dedicated Store-Only Customer Invoices Endpoint (`POST /api/invoices/customer`)
We introduce a dedicated endpoint restricted strictly to the `admin` role (`staff` receive 403 Forbidden):
- Inserts an invoice record into `invoices` with `direction = 'issued'` and default `status = 'unpaid'`.
- Inserts itemized lines into `invoice_lines` with `line_no`, `description`, optional `item_id`, `quantity`, `unit_id`, and `unit_price`.
- Atomic transaction (`BEGIN ... COMMIT`) guarantees that invoice header and line items are stored consistently or rolled back together on any error.

### 2. Server-Enforced Mathematical Reconciliation (2 Decimal Places)
The server strictly computes subtotal from line items and validates that all financial figures reconcile mathematically:
- For each line $i$: $\text{line\_total}_i = \text{round}_2(\text{quantity}_i \times \text{unit\_price}_i)$.
- $\text{computed\_subtotal} = \sum_i \text{line\_total}_i$.
- **Reconciliation 1**: $|\text{client\_subtotal} - \text{computed\_subtotal}| \le 0.009$; otherwise rejects with `400 Bad Request` ("Totals mismatch: Subtotal does not reconcile with sum of lines").
- **Reconciliation 2**: $|\text{client\_total} - (\text{client\_subtotal} + \text{client\_vat\_amount})| \le 0.009$; otherwise rejects with `400 Bad Request` ("Totals mismatch: Total does not reconcile with subtotal + vat_amount").
- **Precision Validation**: All amounts (`subtotal`, `vat_amount`, `total`, and line `unit_price`) must have at most 2 decimal places.

### 3. Relational Foreign Rental & Customer Guards
- **Party Type Invariant**: The invoice `party_id` must reference an existing party record where `is_customer = true`.
- **Foreign Rental Invariant**: If `rental_id` is supplied, the server queries `rentals WHERE id = $1` and verifies `rental.customer_id === party_id`. If the rental belongs to another customer, the server aborts the transaction with `400 Bad Request` ("Foreign rental").
- **Natural Key Idempotency**: Natural key uniqueness on `(direction, party_id, invoice_no)` rejects duplicates with `409 Conflict`.

### 4. Zero Inventory Ledger Side-Effects
Unlike supplier invoices (which optionally post `stock_movements` receipts), `POST /api/invoices/customer` writes strictly to `invoices` and `invoice_lines`. It **never** writes to `stock_movements`. Materials issued to rental jobs are tracked via operational dispatches or maintenance issues, not by customer billing records.

### 5. Plain File Reference Strings with Scheme Sanitization
The `file_url` property on both supplier and customer invoices is treated as a plain reference string (document identifier, archive path, or external link):
- Maximum length 500 characters.
- Strictly rejects dangerous executable schemes (`javascript:`, `data:`, `vbscript:`) to prevent cross-site scripting (XSS) risks.

### 6. Universal Payment Settlement & Auditing (`PATCH /api/invoices/:id/payment`)
We provide a unified payment endpoint supporting both issued and received invoices:
- **Default Settlement Date**: Defaults `paid_on` to today's date (`YYYY-MM-DD`).
- **No Future Dates**: Rejects any `paid_on` timestamp strictly greater than today with `400 Bad Request`.
- **State Transition Guards**:
  - If `status === 'paid'`, rejects with `400 Bad Request` ("Invoice already paid").
  - If `status === 'void'`, rejects with `400 Bad Request` ("Invoice is void").
- **Audit Logging**: Migration `1730000000004_invoice_payment_audit.sql` introduces `paid_by INTEGER REFERENCES users(id)`, recording the exact authenticated admin user who authorized the payment settlement.

---

## Alternatives Considered & Rejected

1. **Client-Trusted Totals Without Server Line Summation**:
   - *Rejected*: Trusting client-supplied subtotals without validating against itemized line sums results in accounting discrepancies, tax calculation errors, and data integrity corruption.
2. **Automated Client PDF Generation / ZATCA Phase 2 XML Generation**:
   - *Rejected for Prototype*: Generating PDF graphics or ZATCA compliant UBL 2.1 XML with ECDSA cryptographic signatures requires dedicated signing certificates and external tax authority clearance APIs. Storing structured billing lines with server-side reconciliation satisfies client requirements while maintaining architectural simplicity.
3. **Recording Stock Movements on Customer Invoices**:
   - *Rejected*: Rental invoices bill for equipment utilization periods (e.g. 30 days of crane hire), not the permanent transfer of physical machinery. Deducting stock on customer invoices would break physical asset availability tracking.
