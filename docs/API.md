# SPACE EXSPACE API Reference

This document provides a comprehensive specification of every REST API endpoint implemented in the system, covering Core Fleet Operations, Commercial Billing, Materials Ledger, and Offline Resilient Sync (Steps 0–5 and Offline Sync O1–O4).

---

## Global API Conventions

- **Base URL**: `http://localhost:5000`
- **Content-Type**: `application/json`
- **Authentication**: Bearer Token in `Authorization` header (`Authorization: Bearer <jwt_token>`)
- **Currency & Precision**: All monetary values are represented in Saudi Riyals (SAR) as decimal strings (`numeric(12,2)`) to avoid floating-point rounding errors.
- **Quantities & Precision**: Consumable material inventory quantities use 3 decimal places (`numeric(12,3)`), accommodating partial units (e.g. 12.500 meters, 2.750 kg).
- **Timestamps**: All timestamps are formatted as ISO 8601 strings in UTC (`timestamptz`).
- **Server-Side Security & Rate Serialization**:
  - Staff accounts (`role: 'staff'`) are restricted to operational tasks (QR scanning, status/location updates, material issues, offline receipts).
  - Commercial terms, rate cards, agreed contract rates, and supplier purchase costs are confidential.
  - Rather than relying on client UI hiding, the server's `sanitizeFinancials()` serializer physically omits the following sensitive keys from responses sent to staff:
    `applied_rate`, `rates`, `rate_card`, `rate_cards`, `amount`, `unit_price`, `unit_cost`, `subtotal`, `vat_amount`, `total`, `discount_note`, `cost`, `standard_rates`.

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
| `GET` | [`/api/materials/:id/price-history`](#20-get-apimaterialsidprice-history) | Admin Only (`role: 'admin'`) | Material purchase price fluctuations and valuation (excludes NULL costs) |
| `GET` | [`/api/invoices`](#21-get-apiinvoices) | Admin Only (`role: 'admin'`) | List stored supplier and customer invoices |
| `GET` | [`/api/invoices/:id`](#22-get-apiinvoicesid) | Admin Only (`role: 'admin'`) | Get invoice details with line items |
| `POST` | [`/api/invoices/supplier`](#23-post-apiinvoicessupplier) | Admin Only (`role: 'admin'`) | Record received supplier invoice & auto-update material price history |
| `GET` | [`/api/sync/snapshot`](#24-get-apisyncsnapshot) | Authenticated (`admin`, `staff`) | Fetch offline read snapshot (ETag conditional caching, role-filtered) |
| `POST` | [`/api/sync`](#25-post-apisync) | Authenticated (`admin`, `staff`) | Replay offline event batches (idempotent UUIDs, row-locked trigger guards) |
| `GET` | [`/api/labels/sheet`](#26-get-apilabelssheet) | Authenticated (`admin`, `staff`) | Printable A4 PDF/HTML grid of equipment QR labels (error correction H, plain asset code payload) |

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
- **Request Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "email": "admin@spaceexspace.com",
  "password": "Admin#2026!Dev"
}
```

#### Responses

##### Response (200 OK)
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "name": "Abdullah Al-Dosari (Operations Director)",
    "email": "admin@spaceexspace.com",
    "role": "admin"
  }
}
```

##### Error Response (401 Unauthorized — Invalid Credentials)
```json
{
  "error": "Invalid email or password"
}
```

##### Error Response (429 Too Many Requests — Rate Limit Exceeded)
```json
{
  "error": "Too many login attempts from this IP. Please try again after 15 minutes."
}
```

---

### 3. `GET /api/auth/me`

Retrieves the currently authenticated user's profile and active session role.

- **Method**: `GET`
- **Path**: `/api/auth/me`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Headers**: `Authorization: Bearer <jwt_token>`

#### Response (200 OK)
```json
{
  "user": {
    "id": 2,
    "name": "Tariq Mansour (Yard Lead)",
    "email": "staff@spaceexspace.com",
    "role": "staff"
  }
}
```

---

### 4. `GET /api/rates`

Lists all standard commercial equipment rental rate cards. **Admin only.**

- **Method**: `GET`
- **Path**: `/api/rates`
- **Auth Required**: `Bearer <token>` (`role: 'admin'`)
- **Query Parameters**: `model_id` (optional integer), `unit` (optional `'daily' | 'weekly' | 'monthly'`)

#### Response (200 OK)
```json
{
  "data": [
    {
      "model_id": 1,
      "make": "Tadano",
      "model": "GR-500EX",
      "type_name": "Rough Terrain Crane",
      "unit": "monthly",
      "amount": "35000.00",
      "vat_included": false,
      "valid_from": "2026-01-01T00:00:00.000Z"
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

### 5. `GET /api/rates/rental-quote-demo`

Demonstrates server-side rate stripping on quotation previews.

- **Method**: `GET`
- **Path**: `/api/rates/rental-quote-demo`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

#### Responses Comparison (Admin vs Staff)

##### Admin Response (200 OK — Full Commercial Visibility)
```json
{
  "quote_id": 101,
  "customer": "Saudi Aramco Offshore Projects",
  "equipment_code": "CRN-50-001",
  "daily_rate": 2500.00,
  "discount_percentage": 10.0,
  "final_agreed_rate": 2250.00,
  "currency": "SAR"
}
```

##### Staff Response (200 OK — Sanitized Operational Data)
```json
{
  "quote_id": 101,
  "customer": "Saudi Aramco Offshore Projects",
  "equipment_code": "CRN-50-001",
  "currency": "SAR"
}
```

---

### 6. `GET /api/equipment`

Lists the entire fleet from `v_equipment_current`.

- **Method**: `GET`
- **Path**: `/api/equipment`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Query Parameters**: `status` (`'available' | 'rented' | 'under_repair'`), `type_id`, `location_id`, `search`, `page`, `limit`

#### Response (200 OK)
```json
{
  "data": [
    {
      "id": 1,
      "asset_code": "CRN-50-001",
      "serial_no": "TD-500-9841",
      "condition": "good",
      "active": true,
      "make": "Tadano",
      "model": "GR-500EX",
      "type_name": "Rough Terrain Crane",
      "current_location_id": 3,
      "current_location_name": "King Salman Port Terminal Site",
      "status": "rented",
      "current_rental_id": 1,
      "current_customer_name": "Apex Infrastructure Partners"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 24,
    "total_pages": 2
  }
}
```

---

### 7. `GET /api/equipment/:asset_code`

Resolves a QR scan on a physical asset tag.

- **Method**: `GET`
- **Path**: `/api/equipment/:asset_code`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

#### Responses Comparison (Admin vs Staff)

##### Admin Response (200 OK)
```json
{
  "equipment": {
    "id": 1,
    "asset_code": "CRN-50-001",
    "serial_no": "TD-500-9841",
    "condition": "good",
    "status": "rented",
    "current_location_name": "King Salman Port Terminal Site",
    "current_rental_id": 1,
    "current_customer_name": "Apex Infrastructure Partners",
    "applied_rate": "35000.00",
    "rate_unit": "monthly"
  },
  "history": {
    "location_history": [
      {
        "location_name": "King Salman Port Terminal Site",
        "moved_by_name": "Tariq Mansour (Yard Lead)",
        "moved_at": "2026-09-01T08:00:00.000Z",
        "note": "Dispatched for Rental #1"
      }
    ],
    "maintenance_history": []
  }
}
```

##### Staff Response (200 OK — Rates Sanitized)
```json
{
  "equipment": {
    "id": 1,
    "asset_code": "CRN-50-001",
    "serial_no": "TD-500-9841",
    "condition": "good",
    "status": "rented",
    "current_location_name": "King Salman Port Terminal Site",
    "current_rental_id": 1,
    "current_customer_name": "Apex Infrastructure Partners"
  },
  "history": {
    "location_history": [
      {
        "location_name": "King Salman Port Terminal Site",
        "moved_by_name": "Tariq Mansour (Yard Lead)",
        "moved_at": "2026-09-01T08:00:00.000Z",
        "note": "Dispatched for Rental #1"
      }
    ],
    "maintenance_history": []
  }
}
```

---

### 8. `POST /api/equipment/:asset_code/move`

Appends an immutable movement event to `location_log`.

- **Method**: `POST`
- **Path**: `/api/equipment/:asset_code/move`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**:
```json
{
  "location_id": 2,
  "note": "Relocated to Jubail Industrial Yard"
}
```

#### Response (201 Created)
```json
{
  "message": "Equipment CRN-50-001 relocated successfully",
  "log_id": 42,
  "equipment": {
    "asset_code": "CRN-50-001",
    "status": "available",
    "current_location_id": 2,
    "current_location_name": "Jubail Industrial Yard"
  }
}
```

---

### 9. `POST /api/equipment/:asset_code/return`

Returns a single equipment item from an active rental. If all line items on the rental agreement are returned, the rental header status updates to `'returned'`.

- **Method**: `POST`
- **Path**: `/api/equipment/:asset_code/return`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**:
```json
{
  "location_id": 1,
  "condition": "good",
  "note": "Returned off-hire inspection completed"
}
```

#### Response (200 OK)
```json
{
  "message": "Equipment CRN-50-001 returned successfully from rental #1",
  "rental_id": 1,
  "equipment": {
    "asset_code": "CRN-50-001",
    "status": "available",
    "current_location_name": "Dammam Central Yard"
  }
}
```

---

### 10. `POST /api/equipment/:asset_code/repair`

Sends equipment to workshop maintenance and transitions condition to `'needs_repair'`.

- **Method**: `POST`
- **Path**: `/api/equipment/:asset_code/repair`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**:
```json
{
  "kind": "repair",
  "description": "Hydraulic cylinder seal leaking under load",
  "cost": 1500.00,
  "note": "Urgent turnaround requested"
}
```

#### Response (201 Created)
```json
{
  "message": "Maintenance work order opened and equipment relocated to workshop",
  "maintenance_id": 7,
  "equipment": {
    "asset_code": "CRN-50-001",
    "status": "under_repair",
    "current_location_name": "Central Maintenance Workshop"
  }
}
```

---

### 11. `GET /api/rentals`

Lists rental contracts. Staff responses sanitize all rates (`applied_rate`).

- **Method**: `GET`
- **Path**: `/api/rentals`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Query Parameters**: `status` (`'quotation' | 'confirmed' | 'picked_up' | 'returned' | 'cancelled'`), `customer_id`, `page`, `limit`

---

### 12. `GET /api/rentals/:id`

Retrieves a single rental contract and its line items.

- **Method**: `GET`
- **Path**: `/api/rentals/:id`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

#### Responses Comparison (Admin vs Staff)

##### Admin Response (200 OK — With Financial Rates)
```json
{
  "data": {
    "id": 1,
    "customer_name": "Apex Infrastructure Partners",
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
        "applied_rate": "35000.00",
        "rate_unit": "monthly",
        "discount_note": "Contract volume discount applied",
        "returned_at": null
      }
    ]
  }
}
```

##### Staff Response (200 OK — Rates Scrubbed)
```json
{
  "data": {
    "id": 1,
    "customer_name": "Apex Infrastructure Partners",
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
        "returned_at": null
      }
    ]
  }
}
```

---

### 13. `POST /api/rentals`

Creates a new rental contract with agreed commercial rates. **Admin only.** Prevents double-booking via partial unique index `idx_uq_active_rental_per_equipment`.

- **Method**: `POST`
- **Path**: `/api/rentals`
- **Auth Required**: `Bearer <token>` (`role: 'admin'`)
- **Request Body**:
```json
{
  "customer_id": 1,
  "site_id": 3,
  "start_date": "2026-11-01",
  "expected_end": "2026-11-30",
  "items": [
    {
      "equipment_id": 5,
      "applied_rate": 28000.00,
      "rate_unit": "monthly",
      "discount_note": "Long-term client discount"
    }
  ]
}
```

#### Response (201 Created)
```json
{
  "message": "Rental agreement created successfully in 'confirmed' status",
  "rental_id": 4,
  "item_count": 1
}
```

#### Error Response (400 Bad Request — Double Booking)
```json
{
  "error": "Double-booking rejected: equipment 'CRN-50-001' already has an active or confirmed rental agreement",
  "conflicting_equipment_id": 1
}
```

---

### 14. `POST /api/rentals/:id/pickup`

Transitions rental to `'picked_up'` and dispatches all equipment items to client site.

- **Method**: `POST`
- **Path**: `/api/rentals/:id/pickup`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)

---

### 15. `POST /api/rentals/:id/return`

Closes an entire rental agreement, marks all items returned, and logs yard check-in.

- **Method**: `POST`
- **Path**: `/api/rentals/:id/return`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**:
```json
{
  "location_id": 1,
  "note": "Full rental agreement returned to Dammam Yard"
}
```

#### Response (200 OK)
```json
{
  "message": "Rental agreement successfully returned. All items freed and checked into yard.",
  "rental_id": 1,
  "returned_items_count": 5
}
```

---

### 16. `GET /api/materials`

Lists consumable materials inventory with stock on hand calculated from `SUM(sm.qty)`.

- **Method**: `GET`
- **Path**: `/api/materials`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Query Parameters**: `category_id`, `low_stock` (`true`), `q` (search SKU/name)

#### Response (200 OK)
```json
{
  "data": [
    {
      "id": 1,
      "sku": "MAT-LUB-001",
      "name": "Hydraulic Oil ISO VG 46 (200L Drum)",
      "category_name": "Fluids & Lubricants",
      "unit_code": "drum",
      "reorder_level": "5.000",
      "current_stock": "18.000",
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

Captures purchase price fluctuations over time directly from supplier invoice lines and computes inventory valuation. **Admin only.**

> [!NOTE]
> Offline goods receipts (which have `unit_cost IS NULL`) and unpriced movements are strictly excluded from price history and weighted average cost calculations, preserving financial valuation accuracy without dilution from unpriced quantities.

- **Method**: `GET`
- **Path**: `/api/materials/:id/price-history`
- **Auth Required**: `Bearer <token>` (`role: 'admin'`)

#### Response (200 OK — Admin Only)
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
  ],
  "valuation": {
    "total_valuation": 12000.00,
    "average_cost": 240.00,
    "priced_qty": 50.000,
    "priced_receipts_count": 1
  }
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

---

### 24. `GET /api/sync/snapshot`

Returns cacheable operational data according to the caller's role for offline client storage. Supports HTTP conditional caching via deterministic ETag and private caching headers.

- **Method**: `GET`
- **Path**: `/api/sync/snapshot`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Response Headers**:
  - `Cache-Control: private` (prevents shared edge proxies from caching role-specific payloads)
  - `ETag: W/"<sha256-hash>"`
- **Conditional Request Headers**:
  - `If-None-Match: W/"<sha256-hash>"` -> Returns `304 Not Modified` with empty body if server state is unchanged.

#### Important: Client Clock Drift Correction
The response body includes `server_time` (ISO 8601). Mobile and browser clients must calculate clock skew delta:
$$\Delta t = \text{server\_time} - \text{client\_now}$$
When creating offline events, clients must add $\Delta t$ to local time so `occurred_at` matches server time within the allowable 5-minute skew window (`CLOCK_SKEW_EXCEEDED`).

#### Responses Comparison (Admin vs Staff)

##### Staff Response (200 OK — Zero Commercial Rates / Prices)
```json
{
  "server_time": "2026-10-29T13:30:00.000Z",
  "etag": "W/\"3d9fa0e8b15e47a988d8b1e4a11f92e8\"",
  "role": "staff",
  "equipment": [
    {
      "id": 1,
      "asset_code": "CRN-50-001",
      "serial_no": "TD-500-9841",
      "condition": "good",
      "active": true,
      "make": "Tadano",
      "model": "GR-500EX",
      "capacity_value": "50.00",
      "type_name": "Rough Terrain Crane",
      "capacity_unit": "ton",
      "current_location_id": 1,
      "current_location_name": "Dammam Central Yard",
      "current_location_kind": "yard",
      "status": "available",
      "current_rental_id": null,
      "current_customer_id": null,
      "current_customer_name": null,
      "current_site_name": null,
      "current_maintenance_id": null
    }
  ],
  "locations": [
    { "id": 1, "name": "Dammam Central Yard", "kind": "yard" },
    { "id": 2, "name": "Jubail Industrial Yard", "kind": "yard" },
    { "id": 3, "name": "Central Maintenance Workshop", "kind": "workshop" }
  ],
  "materials": [
    {
      "id": 1,
      "sku": "MAT-LUB-001",
      "name": "Hydraulic Oil ISO VG 46 (200L Drum)",
      "category_name": "Fluids & Lubricants",
      "unit_code": "drum",
      "stock_on_hand": "18.000",
      "reorder_level": "5.000",
      "is_low_stock": false
    }
  ]
}
```

##### Admin Response (200 OK — Includes Rate Cards)
```json
{
  "server_time": "2026-10-29T13:30:00.000Z",
  "etag": "W/\"8a11bc4ef91102eac33190ab77221e90\"",
  "role": "admin",
  "equipment": [ /* equipment fleet array */ ],
  "locations": [ /* locations array */ ],
  "materials": [ /* materials array */ ],
  "standard_rates": [
    {
      "model_id": 1,
      "make": "Tadano",
      "model": "GR-500EX",
      "unit": "monthly",
      "amount": "35000.00",
      "vat_included": false,
      "valid_from": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

##### Conditional Cache Response (304 Not Modified)
- **Status**: `304 Not Modified`
- **Headers**:
  - `ETag: W/"3d9fa0e8b15e47a988d8b1e4a11f92e8"`
  - `Cache-Control: private`
- **Body**: *Empty*

---

### 25. `POST /api/sync`

Batch replayer for offline field events. Accepts up to 50 events per batch.

- **Method**: `POST`
- **Path**: `/api/sync`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Batch Processing Guarantees**:
  1. **Strict Ordering**: Events are sorted and processed in ascending physical `occurred_at` order.
  2. **Per-Event Transaction Isolation**: Each event executes in its own isolated transaction (`BEGIN ... COMMIT / ROLLBACK`). A failure in event #3 does not roll back event #1 or event #2.
  3. **Idempotency**: Client-generated UUID (`client_event_id`) ensures duplicate replays return stored results without side-effects.
  4. **Precondition Re-evaluation**: All business rules are re-verified at sync time.
  5. **Negative Stock Concurrency Guard**: Stock decrements acquire row-level locks on the item (`FOR UPDATE`) inside the database trigger `trg_check_stock_movement_non_negative`, guaranteeing concurrent sync requests cannot over-draw inventory.
  6. **Audit Retention**: Rejected events are never dropped; their rejection status and reason are permanently stored in `sync_events`.
  7. **Financial Redaction**: Staff sync responses physically omit commercial rates and prices.

#### Supported Event Types
- `equipment.move`: Relocate equipment to yard, site, or workshop.
- `equipment.return`: Check in equipment from rental. Closes rental agreement when all items on that agreement are returned.
- `equipment.repair`: Open maintenance work order and send equipment to workshop.
- `material.goods_received`: Record physical receipt of consumable stock (stored with `unit_cost = NULL`).
- `material.issue`: Deduct material inventory from stock (blocked if requested quantity exceeds current stock).

#### Request Body
```json
{
  "events": [
    {
      "client_event_id": "7b8e5c4a-9123-4dfb-8a21-9311e4210ab1",
      "user_id": 2,
      "type": "equipment.move",
      "payload": {
        "asset_code": "CRN-50-001",
        "location_id": 2,
        "note": "Moved to Jubail Yard"
      },
      "occurred_at": "2026-10-29T10:15:00.000Z"
    },
    {
      "client_event_id": "8c9f6d5b-0234-4efc-9b32-0422f5321bc2",
      "user_id": 2,
      "type": "material.goods_received",
      "payload": {
        "item_id": 1,
        "qty": 10.000,
        "note": "Field delivery of hydraulic oil"
      },
      "occurred_at": "2026-10-29T10:20:00.000Z"
    },
    {
      "client_event_id": "9da07e6c-1345-4ffd-ac43-153306432cd3",
      "user_id": 2,
      "type": "material.issue",
      "payload": {
        "item_id": 1,
        "qty": 500.000,
        "note": "Exceeds available stock"
      },
      "occurred_at": "2026-10-29T10:25:00.000Z"
    }
  ]
}
```

#### Response (200 OK — Mixed Results Example)
```json
{
  "processed": 3,
  "results": [
    {
      "client_event_id": "7b8e5c4a-9123-4dfb-8a21-9311e4210ab1",
      "status": "accepted",
      "result": {
        "action": "equipment.move",
        "asset_code": "CRN-50-001",
        "new_location_id": 2,
        "location_name": "Jubail Industrial Yard",
        "equipment": {
          "asset_code": "CRN-50-001",
          "status": "available",
          "current_location_id": 2,
          "current_location_name": "Jubail Industrial Yard"
        }
      }
    },
    {
      "client_event_id": "8c9f6d5b-0234-4efc-9b32-0422f5321bc2",
      "status": "accepted",
      "result": {
        "action": "material.goods_received",
        "movement_id": 55,
        "item_id": 1,
        "delta_qty": 10.000,
        "current_stock": 28.000
      }
    },
    {
      "client_event_id": "9da07e6c-1345-4ffd-ac43-153306432cd3",
      "status": "rejected",
      "error": "INSUFFICIENT_STOCK",
      "message": "Stock cannot become negative"
    }
  ]
}
```

#### Duplicate Replay Response
When re-submitting an already processed `client_event_id`:
```json
{
  "client_event_id": "7b8e5c4a-9123-4dfb-8a21-9311e4210ab1",
  "status": "duplicate",
  "result": {
    "action": "equipment.move",
    "asset_code": "CRN-50-001",
    "new_location_id": 2,
    "location_name": "Jubail Industrial Yard"
  }
}
```

#### Rejection Error Codes
| Rejection Code | Description | Cause |
| :--- | :--- | :--- |
| `CLOCK_SKEW_EXCEEDED` | Event `occurred_at` timestamp is > 5 minutes in the future | Client clock out of sync with server |
| `USER_MISMATCH` | `event.user_id` does not match the authenticated JWT token | Device credential tampering |
| `INSUFFICIENT_STOCK` | Stock cannot become negative | Precondition check or concurrency trigger blocked over-draw |
| `NOT_RENTED` | Cannot return equipment that is not actively rented | Asset already returned or never rented |
| `ALREADY_UNDER_REPAIR` | Equipment already has an open maintenance work order | Duplicate repair dispatched |
| `EQUIPMENT_RENTED` | Cannot send equipment to repair while on active rental | Must return to yard first |
| `EQUIPMENT_NOT_FOUND` | Specified `asset_code` not found in database | Stale QR code or non-existent asset |
| `LOCATION_NOT_FOUND` | Destination `location_id` does not exist | Invalid location selected |
| `ITEM_NOT_FOUND` | Material `item_id` not found or deactivated | Invalid material SKU |
| `UNSUPPORTED_EVENT_TYPE` | Event type not in scope for offline sync | Administrative or financial event attempted offline |


---

### 26. `GET /api/labels/sheet`

Generates a printable A4 HTML sheet or JSON feed of equipment QR labels.

- **Method**: `GET`
- **Path**: `/api/labels/sheet`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Query Parameters**:
  - `assetCodes`: Comma-separated list or array of asset codes (e.g. `CRN-50-001,GEN-250-001`).
  - `type_id`: Filter by equipment type ID (integer).
  - `type`: Filter by equipment type name (case-insensitive substring, e.g. `Crane`).
  - `status`: Filter by status (`available`, `rented`, `under_repair`).
  - `location_id`: Filter by current yard/site location ID (integer).
  - `limit`: Maximum number of labels to return (integer, default 50, maximum hard cap 50).
  - `format`: `html` (default, printable A4 grid) or `json`.

#### Architectural Invariants:
1. **Plain Text Natural Key Payload**: The QR code encodes strictly the natural `asset_code` (e.g. `CRN-50-001`). No URLs, protocols, or hostnames are included. Survives domain name migrations, routing re-architectures, and intranet shifts permanently (see [ADR 012](decisions/012-plain-text-qr-payload-and-high-error-correction.md)).
2. **Error Correction Level H**: Encoded using ISO/IEC 18004 High error correction (~30% recovery capability), ensuring outdoor equipment tags scratched by rigging wire or stained with oil remain 100% readable.
3. **Strict Zero-Money Invariant**: Completely strips and omits all financial data (no rental rates, costs, replacement values, prices, or tax fields). Safe for public/jobsite field tagging.
4. **Hard Cap of 50 Labels**: Enforces a strict maximum of 50 labels per sheet request to avoid server-side rendering denial-of-service and fit standard multi-page A4 print batches.

#### Responses

##### Printable A4 HTML Response (`format=html` or default browser navigation)
- **Status**: `200 OK`
- **Content-Type**: `text/html; charset=utf-8`
- **Body**: Complete self-contained HTML document formatted with `@page { size: A4 portrait; margin: 10mm; }`, `@media print`, 2-column grid layout, high-DPI QR PNG data URLs, bold monospace asset codes, and technical model/type specifications.

##### JSON Response (`format=json` or `Accept: application/json`)
- **Status**: `200 OK`
- **Content-Type**: `application/json`
- **Body**:
```json
{
  "count": 2,
  "labels": [
    {
      "asset_code": "CRN-50-001",
      "serial_no": "TD-500-9841",
      "make": "Tadano",
      "model": "GR-500EX",
      "type_name": "Rough Terrain Crane",
      "capacity_value": "50.00",
      "capacity_unit": "ton",
      "current_location_name": "Dammam Central Yard",
      "qr_data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABbVsRNAAAABlBMVEX///8AAABVwtN+AA..."
    },
    {
      "asset_code": "GEN-250-001",
      "serial_no": "CU-250-3312",
      "make": "Cummins",
      "model": "C250D5",
      "type_name": "Diesel Generator",
      "capacity_value": "250.00",
      "capacity_unit": "kVA",
      "current_location_name": "Dammam Central Yard",
      "qr_data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABbVsRNAAAABlBMVEX///8AAABVwtN+AA..."
    }
  ]
}
```

##### Error Responses
- **400 Bad Request** (Exceeds hard cap of 50 labels):
```json
{
  "error": "Label limit exceeded",
  "message": "Requested 55 asset codes exceeds the hard cap of 50 labels per sheet"
}
```
- **400 Bad Request** (Missing both assetCodes and filter criteria):
```json
{
  "error": "Invalid request",
  "message": "Must provide either assetCodes or filter criteria (type_id, type, status, location_id)"
}
```
- **404 Not Found** (Unknown or missing asset code):
```json
{
  "error": "Equipment not found",
  "message": "One or more requested asset codes do not exist: UNKNOWN-999"
}
```
