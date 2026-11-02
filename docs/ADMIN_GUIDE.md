# SPACE EXSPACE — Administrator & Operations Guide

This guide covers operational administration procedures, inventory ledger governance, and financial invoice lifecycle management for system administrators of **SPACE EXSPACE Company**.

---

## 1. Invoice Voiding & Inventory Interlocks

### Overview
In SPACE EXSPACE's commercial architecture, invoices are immutable legal documents. Once created, invoices are **never deleted** (`DELETE FROM invoices` is prohibited). Instead, erroneous or disputed invoices are voided via `PATCH /api/invoices/:id/void` by an authenticated `admin`.

When an issued customer invoice is voided:
- Invoice status transitions to `'void'`.
- Audit attributes (`voided_by`, `voided_at`, `void_reason`) are permanently captured.
- Zero stock movements are created (customer rental billing does not alter warehouse physical stock).

When a received supplier invoice is voided:
- Invoice status transitions to `'void'`.
- The system automatically appends compensating reversing stock movements with `type = 'void_reversal'` and signed negative quantity (`-qty`) for every positive receipt originally created by that invoice.
- Historical `receipt` movements are **never deleted**, preserving complete provenance.
- Price history and inventory valuation immediately exclude the voided invoice lines.

---

## 2. Handling Insufficient Stock When Voiding a Supplier Invoice

### The Interlock & Exact Error Message
If materials received on a supplier invoice have already been issued to workshop maintenance, consumed on client job sites, or transferred out of the yard, the remaining stock on hand may be less than the original receipt quantity.

Attempting to void the supplier invoice in this state triggers the PostgreSQL concurrency lock trigger `check_stock_movement_non_negative()`, aborting the transaction with **HTTP 400 Bad Request**:

```json
{
  "error": "Insufficient stock to void invoice",
  "message": "Cannot void invoice: received items have already been consumed or issued, reducing remaining stock below the receipt quantity (Cannot issue 5.000 units of item 12: current stock is 2.000)"
}
```

### Why the System Blocks This
In a single-entry, signed, append-only inventory ledger, stock on hand is $\sum \text{qty}$. Physical inventory in a warehouse cannot be negative. If the system permitted voiding without sufficient stock on hand, the warehouse balance would drop below zero, creating "phantom inventory deficit" and invalidating all downstream operations.

---

### Step-by-Step Resolution Procedure (Adjust, Then Void)

When an administrator encounters this error, follow this three-step procedure:

```
┌─────────────────────────────────┐
│  Attempt Void (HTTP 400 Error)  │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Step 1: Physical Yard Audit     │ ── Confirm actual items on hand in warehouse
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Step 2: Post Stock Adjustment   │ ── POST /api/materials/movements (type='adjustment')
└────────────────┬────────────────┘    Temporarily credit missing balance to enable reversal
                 │
                 ▼
┌─────────────────────────────────┐
│ Step 3: Execute Invoice Void    │ ── PATCH /api/invoices/:id/void
└────────────────┬────────────────┘    System appends 'void_reversal' (-qty)
                 │
                 ▼
┌─────────────────────────────────┐
│ Step 4: Record Replacement /    │ ── POST /api/invoices/supplier (with correct prices/qty)
│         Reconcile True Balance  │
└─────────────────────────────────┘
```

#### Step 1: Perform a Physical Yard Count
Inspect the warehouse or yard to determine the actual physical quantity of the material currently in stock and verify which work orders or dispatches consumed the original shipment.

#### Step 2: Record an Administrative Inventory Adjustment
Before the invoice can be voided, the on-hand stock for the item must be temporarily or permanently adjusted so that $\text{current\_stock} \ge \text{receipt\_qty}$.

The administrator posts a stock adjustment via the API:
- **Endpoint**: `POST /api/materials/movements`
- **Method**: `POST`
- **Headers**: `Authorization: Bearer <admin_token>`
- **Request Body**:
```json
{
  "item_id": 12,
  "type": "adjustment",
  "qty": 3.000,
  "unit_cost": null,
  "note": "Administrative inventory adjustment to enable void reversal for disputed supplier invoice #INV-SUP-2026-088"
}
```
*Note: Set `qty` to at least the difference required to satisfy the reversal ($5.000 - 2.000 = 3.000$ units).*

#### Step 3: Execute the Invoice Void
Once the adjustment increases the on-hand balance to cover the receipt, retry the void request:
- **Endpoint**: `PATCH /api/invoices/:id/void`
- **Method**: `PATCH`
- **Headers**: `Authorization: Bearer <admin_token>`
- **Request Body**:
```json
{
  "reason": "Supplier delivered wrong specification grade; commercial billing cancelled and vendor credit note issued"
}
```

**Expected Response (HTTP 200 OK)**:
```json
{
  "message": "Invoice voided successfully",
  "data": {
    "id": 88,
    "direction": "received",
    "invoice_no": "INV-SUP-2026-088",
    "status": "void",
    "voided_at": "2026-11-03T01:30:00Z",
    "voided_by": 1,
    "void_reason": "Supplier delivered wrong specification grade; commercial billing cancelled and vendor credit note issued",
    "reversal_movements_created": 1
  }
}
```

The system automatically appends a stock movement with:
- `type = 'void_reversal'`
- `qty = -5.000` (deducts the original receipt)
- `unit_cost = 50.00` (preserves historical valuation)
- `note = 'Void reversal for supplier invoice #INV-SUP-2026-088: Supplier delivered wrong specification grade...'`

#### Step 4: Record Replacement Invoice or Final Count
If the supplier provided a replacement invoice with corrected quantities or prices, record the new invoice via `POST /api/invoices/supplier`. If no replacement goods are arriving and physical stock was consumed, log a final inventory adjustment or maintenance charge to match actual physical yard inventory.

---

## 3. Stock Movement Types Reference

| Type | Signed Qty | Financial Impact | Description |
| :--- | :--- | :--- | :--- |
| `receipt` | Positive (`+qty`) | Affects Valuation & Price History | Physical goods received into yard from a supplier invoice or offline field intake. |
| `issue` | Negative (`-qty`) | Deducts Stock | Material issued to maintenance repair or consumed on a customer rental site. |
| `adjustment` | Signed (`+/-qty`) | Affects Stock | Cycle count discrepancy correction or administrative adjustment. |
| `return` | Positive (`+qty`) | Restores Stock | Unused material returned from a job site back to yard inventory. |
| `void_reversal`| Negative (`-qty`) | Neutralizes Receipt | System-generated compensating movement posted when voiding a received supplier invoice. |

---

## 4. Payment Settlement Verification

Invoices can only be settled by an administrator:
- Endpoint: `PATCH /api/invoices/:id/payment`
- Supported: Both `issued` and `received` invoices.
- Invariants:
  - `paid_on` cannot be in the future.
  - Already `paid` or `void` invoices cannot be settled.
  - Authenticated admin user ID is recorded in `paid_by`.
