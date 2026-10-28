# SPACE EXSPACE API Reference

This document provides a comprehensive specification of every REST API endpoint implemented in the system to date (Steps 0–5).

---

## Global API Conventions

- **Base URL**: `http://localhost:5000`
- **Content-Type**: `application/json`
- **Authentication**: Bearer Token in `Authorization` header (`Authorization: Bearer <jwt_token>`)
- **Currency & Precision**: All monetary values are represented in Saudi Riyals (SAR) as decimal strings (`numeric(12,2)`) to avoid floating-point rounding errors.
- **Quantities & Precision**: Consumable material inventory quantities use 3 decimal places (`numeric(12,3)`), accommodating partial units (e.g. 12.500 meters, 2.750 kg).
- **Timestamps**: All timestamps are formatted as ISO 8601 strings in UTC (`timestamptz`).
- **Server-Side Security & Rate Serialization**:
  - Staff accounts (`role: 'staff'`) are restricted to operational tasks (QR scanning, status/location updates, material issues).
  - Commercial terms, rate cards, agreed contract rates, and supplier purchase costs are confidential.
  - Rather than relying on client UI hiding, the server's `sanitizeFinancials()` serializer physically omits the following sensitive keys from responses sent to staff:
    `applied_rate`, `rates`, `rate_card`, `rate_cards`, `amount`, `unit_price`, `unit_cost`, `subtotal`, `vat_amount`, `total`, `discount_note`, `cost`.

---

## Table of Endpoints

| Method | Endpoint | Access Level | Description |
| :--- | :--- | :--- | :--- |
| `GET` | [`/health`](#1-get-health) | Public | Application uptime & database connectivity health probe |
| `POST` | [`/api/auth/login`](#2-post-apiauthlogin) | Public (Rate-Limited) | Authenticate user credentials & issue 8-hour JWT |
| `GET` | [`/api/auth/me`](#3-get-apiauthme) | Authenticated (`admin`, `staff`) | Retrieve current session claims and profile |
| `GET` | [`/api/rates`](#4-get-apirates) | Admin Only (`role: 'admin'`) | List standard commercial rate cards |
| `GET` | [`/api/rates/rental-quote-demo`](#5-get-apiratesrental-quote-demo) | Authenticated (`admin`, `staff`) | Quotation/rental item preview showing server-side rate stripping |
| `GET` | [`/api/equipment`](#6-get-apiequipment) | Authenticated (`admin`, `staff`) | List equipment fleet with search, filters, and pagination |
| `GET` | [`/api/equipment/:asset_code`](#7-get-apiequipmentasset_code) | Authenticated (`admin`, `staff`) | QR scan resolution: equipment details, history, active rental / maintenance |
| `POST` | [`/api/equipment/:asset_code/move`](#8-post-apiequipmentasset_codemove) | Authenticated (`admin`, `staff`) | Action: Relocate equipment (appends to `location_log` in transaction) |
| `POST` | [`/api/equipment/:asset_code/return`](#9-post-apiequipmentasset_codereturn) | Authenticated (`admin`, `staff`) | Action: Return equipment from rental (sets `returned_at` in transaction) |
| `POST` | [`/api/equipment/:asset_code/repair`](#10-post-apiequipmentasset_coderepair) | Authenticated (`admin`, `staff`) | Action: Send equipment to workshop maintenance in transaction |
| `GET` | [`/api/rentals`](#11-get-apirentals) | Authenticated (`admin`, `staff`) | List rental agreements (staff rates scrubbed) |
| `GET` | [`/api/rentals/:id`](#12-get-apirentalsid) | Authenticated (`admin`, `staff`) | Get rental contract details & items (staff rates scrubbed) |
| `POST` | [`/api/rentals`](#13-post-apirentals) | Admin Only (`role: 'admin'`) | Create rental contract with agreed rates (double-booking prevented) |
| `POST` | [`/api/rentals/:id/pickup`](#14-post-apirentalsidpickup) | Authenticated (`admin`, `staff`) | Action: Dispatch/pick up rental & relocate items to site in `location_log` |
| `POST` | [`/api/rentals/:id/return`](#15-post-apirentalsidreturn) | Authenticated (`admin`, `staff`) | Action: Return entire rental to yard & set `returned_at` in transaction |
| `GET` | [`/api/materials`](#16-get-apimaterials) | Authenticated (`admin`, `staff`) | List materials with live `SUM(qty)` stock on hand |
| `GET` | [`/api/materials/:id`](#17-get-apimaterialsid) | Authenticated (`admin`, `staff`) | Get material SKU details with stock on hand |
| `GET` | [`/api/materials/:id/movements`](#18-get-apimaterialsidmovements) | Authenticated (`admin`, `staff`) | Chronological stock ledger movements (staff unit costs scrubbed) |
| `POST` | [`/api/materials/movements`](#19-post-apimaterialsmovements) | Authenticated (`admin`, `staff`) | Record stock receipt, issue, or adjustment (negative stock rejected) |
| `GET` | [`/api/materials/:id/price-history`](#20-get-apimaterialsidprice-history) | Admin Only (`role: 'admin'`) | Material purchase price fluctuations over time from supplier invoices |
| `GET` | [`/api/invoices`](#21-get-apiinvoices) | Admin Only (`role: 'admin'`) | List stored supplier and customer invoices |
| `GET` | [`/api/invoices/:id`](#22-get-apiinvoicesid) | Admin Only (`role: 'admin'`) | Get invoice details with line items |
| `POST` | [`/api/invoices/supplier`](#23-post-apiinvoicessupplier) | Admin Only (`role: 'admin'`) | Record received supplier invoice & auto-update material price history |

---

## Endpoints

### 1. `GET /health`

Liveness and dependency health probe. Verifies the Node.js server process and executes an active connectivity check against PostgreSQL.

- **Method**: `GET`
- **Path**: `/health`
- **Auth Required**: None (Public)
- **Request Headers**: None
- **Request Body**: None

#### Responses (Admin and Staff receive identical response)

##### Response (200 OK — Healthy Database)
```json
{
  "status": "ok",
  "uptimeSeconds": 1420,
  "timestamp": "2026-10-28T07:15:00.123Z",
  "environment": "development",
  "database": {
    "status": "connected",
    "latencyMs": 0.85
  }
}
```

##### Response (503 Service Unavailable — Database Offline / Degraded)
```json
{
  "status": "degraded",
  "uptimeSeconds": 45,
  "timestamp": "2026-10-28T07:15:30.456Z",
  "environment": "development",
  "database": {
    "status": "disconnected",
    "error": "connection to server at \"127.0.0.1\", port 5433 failed: Connection refused"
  }
}
```

---

### 2. `POST /api/auth/login`

Authenticates credentials using bcrypt password verification against `users.password_hash`. Returns an 8-hour JWT token upon success. Protected by `loginRateLimiter` (10 attempts per 15 minutes per IP).

- **Method**: `POST`
- **Path**: `/api/auth/login`
- **Auth Required**: None (Public)
- **Request Headers**:
  - `Content-Type: application/json`
- **Request Body**:
```json
{
  "email": "admin@spaceexspace.com",
  "password": "Admin#2026!Dev"
}
```

#### Responses

##### Admin Login Response (200 OK)
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "name": "Abdullah Al-Dosari (Operations Director)",
    "email": "admin@spaceexspace.com",
    "role": "admin"
  }
}
```

##### Staff Login Response (200 OK)
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 2,
    "name": "Tariq Mansour (Yard Lead)",
    "email": "staff@spaceexspace.com",
    "role": "staff"
  }
}
```

---

### 3. `GET /api/auth/me`

Retrieves current session claims and profile.

- **Method**: `GET`
- **Path**: `/api/auth/me`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

---

### 4. `GET /api/rates`

Retrieves master standard commercial rate cards. **Admin only.**

- **Method**: `GET`
- **Path**: `/api/rates`
- **Auth Required**: `Bearer <token>` (`role: 'admin'`)

---

### 5. `GET /api/rates/rental-quote-demo`

Demonstration endpoint illustrating server-side rate serialization.

- **Method**: `GET`
- **Path**: `/api/rates/rental-quote-demo`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

---

### 6. `GET /api/equipment`

Queries the entire fleet reading directly from dynamic derived view `v_equipment_current`.

- **Method**: `GET`
- **Path**: `/api/equipment`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Query Parameters**: `search`, `status`, `type_id`, `location_id`, `condition`, `page`, `limit`

---

### 7. `GET /api/equipment/:asset_code`

The core **QR scan endpoint** resolving natural key `asset_code` to specifications, location history, active rental details, and maintenance.

- **Method**: `GET`
- **Path**: `/api/equipment/:asset_code`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

---

### 8. `POST /api/equipment/:asset_code/move`

Domain action to record the physical relocation of an asset.

- **Method**: `POST`
- **Path**: `/api/equipment/:asset_code/move`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

---

### 9. `POST /api/equipment/:asset_code/return`

Domain action to check an equipment unit back into a yard upon completion of a rental.

- **Method**: `POST`
- **Path**: `/api/equipment/:asset_code/return`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

---

### 10. `POST /api/equipment/:asset_code/repair`

Domain action to send a damaged machine to a maintenance workshop.

- **Method**: `POST`
- **Path**: `/api/equipment/:asset_code/repair`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

---

### 11. `GET /api/rentals`

Lists rental contracts with customer names, delivery sites, status, and item counts. Paginated.

- **Method**: `GET`
- **Path**: `/api/rentals`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Query Parameters**:
  - `status` (optional): `'quotation' | 'confirmed' | 'picked_up' | 'returned' | 'cancelled'`
  - `customer_id` (optional integer): filter by customer
  - `page` (optional integer, default `1`)
  - `limit` (optional integer, default `20`)

#### Response (200 OK)
```json
{
  "data": [
    {
      "id": 1,
      "customer_id": 4,
      "customer_name": "Apex Infrastructure Partners",
      "site_id": 6,
      "site_name": "King Salman Port Terminal Site",
      "status": "picked_up",
      "start_date": "2026-09-01",
      "expected_end": "2026-12-31",
      "created_at": "2026-10-28T07:15:00.000Z",
      "total_items": 5,
      "active_items": 5
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 3,
    "total_pages": 1
  }
}
```

---

### 12. `GET /api/rentals/:id`

Retrieves full rental contract details with all assigned line items.

- **Method**: `GET`
- **Path**: `/api/rentals/:id`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

#### Responses Comparison (Admin vs Staff)

##### Admin Response (200 OK — Full Commercial Visibility)
```json
{
  "data": {
    "id": 1,
    "customer_id": 4,
    "customer_name": "Apex Infrastructure Partners",
    "customer_contact": "Eng. Faisal Al-Subaie",
    "customer_phone": "+966 13 800 0004",
    "site_id": 6,
    "site_name": "King Salman Port Terminal Site",
    "status": "picked_up",
    "start_date": "2026-09-01",
    "expected_end": "2026-12-31",
    "items": [
      {
        "equipment_id": 1,
        "asset_code": "CRN-50-001",
        "make": "Tadano",
        "model": "GR-500EX",
        "type_name": "Hydraulic Mobile Crane",
        "applied_rate": "35000.00",
        "rate_unit": "monthly",
        "discount_note": "Contract volume discount applied",
        "returned_at": null
      }
    ]
  }
}
```

##### Staff Response (200 OK — Serialized & Stripped)
`applied_rate` and `discount_note` are physically omitted:
```json
{
  "data": {
    "id": 1,
    "customer_id": 4,
    "customer_name": "Apex Infrastructure Partners",
    "customer_contact": "Eng. Faisal Al-Subaie",
    "customer_phone": "+966 13 800 0004",
    "site_id": 6,
    "site_name": "King Salman Port Terminal Site",
    "status": "picked_up",
    "start_date": "2026-09-01",
    "expected_end": "2026-12-31",
    "items": [
      {
        "equipment_id": 1,
        "asset_code": "CRN-50-001",
        "make": "Tadano",
        "model": "GR-500EX",
        "type_name": "Hydraulic Mobile Crane",
        "rate_unit": "monthly",
        "returned_at": null
      }
    ]
  }
}
```

---

### 13. `POST /api/rentals`

Creates a new rental contract with agreed applied rates. **Admin only.**
Atomically validates availability to prevent double-booking.

- **Method**: `POST`
- **Path**: `/api/rentals`
- **Auth Required**: `Bearer <token>` (`role: 'admin'`)
- **Request Body**:
```json
{
  "customer_id": 4,
  "site_id": 5,
  "start_date": "2026-11-01",
  "expected_end": "2026-11-30",
  "status": "confirmed",
  "items": [
    {
      "equipment_id": 12,
      "applied_rate": 1850.00,
      "rate_unit": "daily",
      "discount_note": "Standard contractor day rate"
    }
  ]
}
```

#### Response (201 Created)
```json
{
  "message": "Rental agreement created successfully",
  "rental_id": 4,
  "status": "confirmed"
}
```

#### Error Response (409 Conflict — Double-booking prevented)
```json
{
  "error": "Equipment 'CRN-50-001' is currently unavailable (Status: rented)",
  "conflict_asset_code": "CRN-50-001",
  "conflict_status": "rented"
}
```

---

### 14. `POST /api/rentals/:id/pickup`

Dispatches rental agreement. Transitions status to `'picked_up'` and writes append-only entries to `location_log` transferring equipment to the client job site.

- **Method**: `POST`
- **Path**: `/api/rentals/:id/pickup`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**:
```json
{
  "note": "Mobilized with low-bed trailer"
}
```

#### Response (200 OK)
```json
{
  "message": "Rental agreement marked as picked up. Equipment locations updated to client site.",
  "rental_id": 4,
  "dispatched_items_count": 1
}
```

---

### 15. `POST /api/rentals/:id/return`

Checks all rental items back into a yard location. Sets `returned_at = CURRENT_TIMESTAMP`, updates rental status to `'returned'`, and writes return logs to `location_log`.

- **Method**: `POST`
- **Path**: `/api/rentals/:id/return`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**:
```json
{
  "location_id": 1,
  "note": "Returned clean upon project completion"
}
```

#### Response (200 OK)
```json
{
  "message": "Rental agreement successfully returned. All items freed and checked into yard.",
  "rental_id": 4,
  "returned_items_count": 1
}
```

---

### 16. `GET /api/materials`

Lists consumable materials inventory with live stock on hand derived dynamically via `SUM(stock_movements.qty)`.

- **Method**: `GET`
- **Path**: `/api/materials`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Query Parameters**:
  - `category_id` (optional integer)
  - `low_stock` (optional boolean, `'true'` returns items at or below `reorder_level`)
  - `q` (optional string search on SKU or item name)

#### Response (200 OK)
```json
{
  "data": [
    {
      "id": 1,
      "sku": "MS-PL-6MM",
      "name": "Mild Steel Plate 6mm (4x8 ft)",
      "category_id": 1,
      "category_name": "Steel & Metal Sheets",
      "unit_id": 1,
      "unit_code": "pcs",
      "unit_name": "Pieces",
      "reorder_level": "15.000",
      "current_stock": "45.000",
      "is_low_stock": false
    }
  ]
}
```

---

### 17. `GET /api/materials/:id`

Retrieves specification and live stock on hand for a single material SKU.

- **Method**: `GET`
- **Path**: `/api/materials/:id`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

---

### 18. `GET /api/materials/:id/movements`

Returns chronological ledger entries from `stock_movements`.

- **Method**: `GET`
- **Path**: `/api/materials/:id/movements`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

#### Responses Comparison (Admin vs Staff)
- **Admin**: Receives `unit_cost` for every movement.
- **Staff**: `unit_cost` is scrubbed and physically omitted.

---

### 19. `POST /api/materials/movements`

Records an inventory movement in the append-only ledger (`receipt`, `issue`, `adjustment`, `return`). Protected by database trigger `trg_check_stock_movement_non_negative`.

- **Method**: `POST`
- **Path**: `/api/materials/movements`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**:
```json
{
  "item_id": 1,
  "type": "issue",
  "qty": 5.000,
  "note": "Issued for Tadano boom reinforcement"
}
```

#### Response (201 Created)
```json
{
  "message": "Stock movement of type 'issue' recorded successfully",
  "movement_id": 17,
  "item_id": 1,
  "delta_qty": -5.000,
  "current_stock": 40.000
}
```

#### Error Response (400 Bad Request — Trigger Enforcement)
```json
{
  "error": "Cannot issue 50.000 units of item 1: current stock is 40.000",
  "code": "INSUFFICIENT_STOCK"
}
```

---

### 20. `GET /api/materials/:id/price-history`

Captures purchase price fluctuations over time directly from supplier invoice lines. **Admin only.**

- **Method**: `GET`
- **Path**: `/api/materials/:id/price-history`
- **Auth Required**: `Bearer <token>` (`role: 'admin'`)

#### Response (200 OK)
```json
{
  "item_id": 1,
  "price_history": [
    {
      "invoice_id": 1,
      "invoice_no": "INV-SUP-2026-001",
      "invoice_date": "2026-01-15",
      "supplier_id": 1,
      "supplier_name": "Gulf Heavy Metals Trading",
      "line_no": 1,
      "description": "Mild Steel Plate 6mm (4x8 ft)",
      "quantity": "50.000",
      "unit_code": "pcs",
      "unit_price": "240.00",
      "line_total": "12000.00"
    }
  ]
}
```

#### Staff Response (403 Forbidden)
```json
{
  "error": "Access forbidden: insufficient permissions",
  "requiredRoles": ["admin"],
  "currentRole": "staff"
}
```

---

### 21. `GET /api/invoices`

Lists stored supplier and customer invoices. **Admin only.**

- **Method**: `GET`
- **Path**: `/api/invoices`
- **Auth Required**: `Bearer <token>` (`role: 'admin'`)
- **Query Parameters**: `direction` (`'received' | 'issued'`), `status`, `party_id`, `page`, `limit`

---

### 22. `GET /api/invoices/:id`

Retrieves detailed invoice header and line items. **Admin only.**

- **Method**: `GET`
- **Path**: `/api/invoices/:id`
- **Auth Required**: `Bearer <token>` (`role: 'admin'`)

---

### 23. `POST /api/invoices/supplier`

Stores a received supplier invoice with item lines, updating material purchase price history and optionally writing stock receipts to the inventory ledger in one atomic transaction. **Admin only.**

- **Method**: `POST`
- **Path**: `/api/invoices/supplier`
- **Auth Required**: `Bearer <token>` (`role: 'admin'`)
- **Request Body**:
```json
{
  "party_id": 1,
  "invoice_no": "INV-SUP-2026-888",
  "invoice_date": "2026-10-28",
  "due_date": "2026-11-28",
  "subtotal": 2400.00,
  "vat_amount": 360.00,
  "total": 2760.00,
  "notes": "Emergency purchase of mild steel plates",
  "record_stock_receipt": true,
  "lines": [
    {
      "item_id": 1,
      "description": "Mild Steel Plate 6mm (4x8 ft)",
      "quantity": 10.000,
      "unit_id": 1,
      "unit_price": 240.00
    }
  ]
}
```

#### Response (201 Created)
```json
{
  "message": "Supplier invoice recorded successfully. Material purchase prices and stock updated.",
  "invoice_id": 3,
  "invoice_no": "INV-SUP-2026-888",
  "lines_recorded": 1
}
```
