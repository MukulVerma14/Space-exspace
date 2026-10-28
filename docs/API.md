# SPACE EXSPACE API Reference

This document provides a comprehensive specification of every REST API endpoint implemented in the system to date (Steps 0–4).

---

## Global API Conventions

- **Base URL**: `http://localhost:5000`
- **Content-Type**: `application/json`
- **Authentication**: Bearer Token in `Authorization` header (`Authorization: Bearer <jwt_token>`)
- **Currency & Precision**: All monetary values are represented in Saudi Riyals (SAR) as decimal strings (`numeric(12,2)`) to avoid floating-point rounding errors.
- **Timestamps**: All timestamps are formatted as ISO 8601 strings in UTC (`timestamptz`).
- **Server-Side Security & Rate Serialization**:
  - Staff accounts (`role: 'staff'`) are restricted to operational tasks (QR scanning, status/location updates).
  - Commercial terms and pricing are proprietary confidential data.
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

##### Error Responses
- **400 Bad Request** (Malformed input or invalid email format):
```json
{
  "error": "Validation failed",
  "details": {
    "email": ["Invalid email address format"]
  }
}
```
- **401 Unauthorized** (Wrong password or non-existent email — identical generic error prevents account enumeration):
```json
{
  "error": "Invalid email or password"
}
```

---

### 3. `GET /api/auth/me`

Retrieves the currently authenticated user's profile and permissions claims. Validates the JWT Bearer token and verifies in PostgreSQL that the user account is active.

- **Method**: `GET`
- **Path**: `/api/auth/me`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Headers**:
  - `Authorization: Bearer <token>`
- **Request Body**: None

#### Responses

##### Admin Response (200 OK)
```json
{
  "user": {
    "id": 1,
    "name": "Abdullah Al-Dosari (Operations Director)",
    "email": "admin@spaceexspace.com",
    "role": "admin"
  }
}
```

##### Staff Response (200 OK)
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

Retrieves the company's master commercial rate cards (standard daily, weekly, monthly pricing in SAR across all equipment models). **Strictly restricted to administrators.**

- **Method**: `GET`
- **Path**: `/api/rates`
- **Auth Required**: `Bearer <token>` (`role: 'admin'`)
- **Request Headers**:
  - `Authorization: Bearer <token>`
- **Request Body**: None

#### Responses

##### Admin Response (200 OK)
```json
{
  "rates": [
    {
      "model_id": 1,
      "make": "Tadano",
      "model": "GR-500EX",
      "unit": "daily",
      "amount": "2200.00",
      "vat_included": false,
      "valid_from": "2026-01-01T00:00:00.000Z"
    },
    {
      "model_id": 1,
      "make": "Tadano",
      "model": "GR-500EX",
      "unit": "monthly",
      "amount": "38000.00",
      "vat_included": false,
      "valid_from": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

##### Staff Response (403 Forbidden)
```json
{
  "error": "Access forbidden: insufficient permissions",
  "requiredRoles": ["admin"],
  "currentRole": "staff"
}
```

---

### 5. `GET /api/rates/rental-quote-demo`

Demonstration endpoint illustrating server-side rate serialization on shared operational endpoints. Accessible to both **Admin** and **Staff**.

- **Method**: `GET`
- **Path**: `/api/rates/rental-quote-demo`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**: None

#### Responses Comparison (Admin vs Staff)

##### Admin Response (200 OK — Full Financial Visibility)
```json
{
  "role": "admin",
  "data": {
    "rental_id": 1,
    "rental_status": "picked_up",
    "customer_name": "Apex Infrastructure Partners",
    "site_name": "King Salman Port Terminal Site",
    "asset_code": "CRN-50-001",
    "applied_rate": "35000.00",
    "rate_unit": "monthly",
    "discount_note": "Contract volume discount applied"
  }
}
```

##### Staff Response (200 OK — Serialized & Stripped)
`applied_rate` and `discount_note` are physically omitted by `sanitizeFinancials()`:
```json
{
  "role": "staff",
  "data": {
    "rental_id": 1,
    "rental_status": "picked_up",
    "customer_name": "Apex Infrastructure Partners",
    "site_name": "King Salman Port Terminal Site",
    "asset_code": "CRN-50-001",
    "rate_unit": "monthly"
  }
}
```

---

### 6. `GET /api/equipment`

Queries the entire fleet reading directly from the dynamic derived view `v_equipment_current`. Supports search, multi-field filtering, and pagination.

- **Method**: `GET`
- **Path**: `/api/equipment`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Query Parameters**:
  - `search` (optional string): case-insensitive search across `asset_code`, `make`, `model`, `type_name`, `current_location_name`
  - `status` (optional enum): `'available' | 'rented' | 'under_repair'`
  - `type_id` (optional integer): filter by equipment category ID
  - `location_id` (optional integer): filter by current physical yard or site
  - `condition` (optional enum): `'good' | 'fair' | 'needs_repair'`
  - `page` (optional integer, default `1`)
  - `limit` (optional integer, default `20`, max `100`)

#### Responses (Admin & Staff receive paginated list)

##### Response (200 OK)
```json
{
  "items": [
    {
      "id": 1,
      "asset_code": "CRN-50-001",
      "serial_no": "TAD-50-8812",
      "condition": "good",
      "active": true,
      "created_at": "2026-10-28T07:15:00.000Z",
      "model_id": 1,
      "make": "Tadano",
      "model": "GR-500EX",
      "capacity_value": "50.00",
      "type_id": 1,
      "type_name": "Hydraulic Mobile Crane",
      "capacity_unit": "ton",
      "current_location_id": 6,
      "current_location_name": "King Salman Port Terminal Site",
      "current_location_kind": "client_site",
      "last_moved_at": "2026-02-01T05:00:00.000Z",
      "last_moved_by": 1,
      "last_moved_by_name": "Abdullah Al-Dosari (Operations Director)",
      "status": "rented",
      "current_rental_id": 1,
      "current_customer_id": 4,
      "current_customer_name": "Apex Infrastructure Partners",
      "current_site_name": "King Salman Port Terminal Site",
      "current_rental_expected_end": "2026-12-31"
    }
  ],
  "pagination": {
    "total": 41,
    "page": 1,
    "limit": 20,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

### 7. `GET /api/equipment/:asset_code`

The core **QR scan endpoint**. Technicians scan the physical QR barcode on an asset frame, sending its natural key `asset_code` (e.g. `CRN-50-001`). Resolves specifications, current location, recent movement log, active rental contract, and open maintenance tickets.

- **Method**: `GET`
- **Path**: `/api/equipment/:asset_code`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**: None

#### Responses Comparison (Admin vs Staff)

##### Admin Response (200 OK — Full Commercial & Maintenance Visibility)
```json
{
  "id": 1,
  "asset_code": "CRN-50-001",
  "serial_no": "TAD-50-8812",
  "condition": "good",
  "active": true,
  "created_at": "2026-10-28T07:15:00.000Z",
  "model_id": 1,
  "make": "Tadano",
  "model": "GR-500EX",
  "capacity_value": "50.00",
  "type_id": 1,
  "type_name": "Hydraulic Mobile Crane",
  "capacity_unit": "ton",
  "current_location_id": 6,
  "current_location_name": "King Salman Port Terminal Site",
  "status": "rented",
  "current_rental_id": 1,
  "current_customer_name": "Apex Infrastructure Partners",
  "location_history": [
    {
      "id": 1,
      "location_id": 6,
      "location_name": "King Salman Port Terminal Site",
      "location_kind": "client_site",
      "moved_at": "2026-02-01T05:00:00.000Z",
      "note": "Initial fleet deployment",
      "moved_by_name": "Abdullah Al-Dosari (Operations Director)"
    }
  ],
  "active_rental": {
    "rental_id": 1,
    "rental_status": "picked_up",
    "customer_name": "Apex Infrastructure Partners",
    "customer_phone": "+966 13 800 0004",
    "site_name": "King Salman Port Terminal Site",
    "start_date": "2026-09-01",
    "expected_end": "2026-12-31",
    "applied_rate": "35000.00",
    "rate_unit": "monthly",
    "discount_note": "Contract volume discount applied"
  },
  "standard_rates": [
    {
      "unit": "monthly",
      "amount": "38000.00",
      "vat_included": false,
      "valid_from": "2026-01-01T00:00:00.000Z"
    },
    {
      "unit": "daily",
      "amount": "2200.00",
      "vat_included": false,
      "valid_from": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

##### Staff Response (200 OK — Operational Only, Financials Withheld)
`applied_rate`, `discount_note`, and `standard_rates` are physically omitted from the response:
```json
{
  "id": 1,
  "asset_code": "CRN-50-001",
  "serial_no": "TAD-50-8812",
  "condition": "good",
  "active": true,
  "created_at": "2026-10-28T07:15:00.000Z",
  "model_id": 1,
  "make": "Tadano",
  "model": "GR-500EX",
  "capacity_value": "50.00",
  "type_id": 1,
  "type_name": "Hydraulic Mobile Crane",
  "capacity_unit": "ton",
  "current_location_id": 6,
  "current_location_name": "King Salman Port Terminal Site",
  "status": "rented",
  "current_rental_id": 1,
  "current_customer_name": "Apex Infrastructure Partners",
  "location_history": [
    {
      "id": 1,
      "location_id": 6,
      "location_name": "King Salman Port Terminal Site",
      "location_kind": "client_site",
      "moved_at": "2026-02-01T05:00:00.000Z",
      "note": "Initial fleet deployment",
      "moved_by_name": "Abdullah Al-Dosari (Operations Director)"
    }
  ],
  "active_rental": {
    "rental_id": 1,
    "rental_status": "picked_up",
    "customer_name": "Apex Infrastructure Partners",
    "customer_phone": "+966 13 800 0004",
    "site_name": "King Salman Port Terminal Site",
    "start_date": "2026-09-01",
    "expected_end": "2026-12-31",
    "rate_unit": "monthly"
  }
}
```

---

### 8. `POST /api/equipment/:asset_code/move`

Domain action to record the physical relocation of an asset between yards, client sites, or workshops. Appends an immutable row to `location_log` inside an atomic transaction.

- **Method**: `POST`
- **Path**: `/api/equipment/:asset_code/move`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**:
```json
{
  "location_id": 2,
  "note": "Transferred by low-bed trailer to Jubail"
}
```

#### Response (200 OK)
```json
{
  "message": "Equipment CRN-50-003 successfully moved to Jubail Storage Yard",
  "equipment": {
    "id": 3,
    "asset_code": "CRN-50-003",
    "current_location_id": 2,
    "current_location_name": "Jubail Storage Yard",
    "status": "available"
  }
}
```

---

### 9. `POST /api/equipment/:asset_code/return`

Domain action to check an equipment unit back into a yard upon completion of a rental. Executes inside an atomic transaction:
1. Sets `returned_at = CURRENT_TIMESTAMP` on `rental_items`.
2. Updates `equipment.condition` if provided.
3. Appends a reception entry to `location_log`.
4. Checks if all items for the rental contract are returned; if so, sets `rentals.status = 'returned'`.
5. `v_equipment_current` immediately recalculates status to `'available'`.

- **Method**: `POST`
- **Path**: `/api/equipment/:asset_code/return`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**:
```json
{
  "location_id": 1,
  "condition": "good",
  "note": "Completed project at Ras Tanura; returned clean"
}
```

#### Response (200 OK)
```json
{
  "message": "Equipment CRN-50-001 successfully returned from rental #1 to SPACE Central Dammam Yard",
  "equipment": {
    "id": 1,
    "asset_code": "CRN-50-001",
    "current_location_name": "SPACE Central Dammam Yard",
    "status": "available",
    "condition": "good"
  }
}
```

#### Error Response (400 Bad Request — If equipment is not actively rented)
```json
{
  "error": "Equipment CRN-50-003 does not have an active rental to return"
}
```

---

### 10. `POST /api/equipment/:asset_code/repair`

Domain action to send a damaged or servicing-due machine to a maintenance workshop. Executes inside an atomic transaction:
1. Verifies asset is not actively rented (returns 400 if actively rented).
2. Verifies asset does not already have an open maintenance record.
3. Inserts row into `maintenance`.
4. Updates `equipment.condition = 'needs_repair'`.
5. Appends relocation entry to `location_log` targeting the workshop.
6. `v_equipment_current` immediately derives status as `'under_repair'`.

- **Method**: `POST`
- **Path**: `/api/equipment/:asset_code/repair`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Body**:
```json
{
  "kind": "repair",
  "description": "Main boom cylinder seal leaking hydraulic oil",
  "workshop_location_id": 3,
  "note": "Urgent repair needed before upcoming rental"
}
```

#### Response (200 OK)
```json
{
  "message": "Equipment CRN-50-005 successfully sent to maintenance",
  "equipment": {
    "id": 5,
    "asset_code": "CRN-50-005",
    "current_location_name": "Dammam Heavy Fleet Workshop",
    "status": "under_repair",
    "condition": "needs_repair",
    "current_maintenance_desc": "Main boom cylinder seal leaking hydraulic oil"
  }
}
```

#### Error Responses
- **400 Bad Request** (Equipment actively rented):
```json
{
  "error": "Equipment CRN-50-001 is actively rented. It must be returned to a yard before opening maintenance."
}
```
- **400 Bad Request** (Already under repair):
```json
{
  "error": "Equipment CRN-50-004 already has an open maintenance work order."
}
```
