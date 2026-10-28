# SPACE EXSPACE API Reference

This document provides a comprehensive specification of every REST API endpoint implemented in the system to date (Steps 0–3).

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

---

## Endpoints

### 1. `GET /health`

Liveness and dependency health probe. Verifies the Node.js server process and executes an active connectivity check against PostgreSQL.

- **Method**: `GET`
- **Path**: `/health`
- **Auth Required**: None (Public)
- **Request Headers**: None
- **Request Body**: None

#### Responses

Both **Admin** and **Staff** (and unauthenticated monitoring systems) receive identical responses.

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
- **401 Unauthorized** (User account soft-deactivated via `active = false`):
```json
{
  "error": "User account has been deactivated"
}
```
- **429 Too Many Requests** (Brute-force throttle exceeded):
```json
{
  "error": "Too many login attempts from this IP, please try again after 15 minutes"
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

##### Error Responses
- **401 Unauthorized** (Token missing or malformed):
```json
{
  "error": "Authentication required: missing or malformed token"
}
```
- **401 Unauthorized** (Token expired or signature invalid):
```json
{
  "error": "Authentication token has expired"
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
Admins have full visibility into standard commercial rates:
```json
{
  "rates": [
    {
      "model_id": 1,
      "make": "Tadano",
      "model": "GR-500EX",
      "unit": "daily",
      "amount": "1200.00",
      "vat_included": false,
      "valid_from": "2026-01-01T00:00:00.000Z"
    },
    {
      "model_id": 1,
      "make": "Tadano",
      "model": "GR-500EX",
      "unit": "monthly",
      "amount": "26000.00",
      "vat_included": false,
      "valid_from": "2026-01-01T00:00:00.000Z"
    },
    {
      "model_id": 4,
      "make": "Cummins",
      "model": "C250D5",
      "unit": "daily",
      "amount": "450.00",
      "vat_included": false,
      "valid_from": "2026-01-01T00:00:00.000Z"
    },
    {
      "model_id": 4,
      "make": "Cummins",
      "model": "C250D5",
      "unit": "monthly",
      "amount": "9500.00",
      "vat_included": false,
      "valid_from": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

##### Staff Response (403 Forbidden)
Staff calling this route are blocked immediately by the `requireRole('admin')` guard. **Zero rate data is returned:**
```json
{
  "error": "Access forbidden: insufficient permissions",
  "requiredRoles": [
    "admin"
  ],
  "currentRole": "staff"
}
```

---

### 5. `GET /api/rates/rental-quote-demo`

Demonstration endpoint illustrating server-side rate serialization on shared operational endpoints. Accessible to both **Admin** and **Staff**, returning rental contract line items.

- **Method**: `GET`
- **Path**: `/api/rates/rental-quote-demo`
- **Auth Required**: `Bearer <token>` (`admin` or `staff`)
- **Request Headers**:
  - `Authorization: Bearer <token>`
- **Request Body**: None

#### Responses Comparison (Admin vs Staff)

##### Admin Response (200 OK — Full Financial Visibility)
Admins see operational data **plus** negotiated commercial rates, rate units, and discount notes:
```json
{
  "role": "admin",
  "data": {
    "rental_id": 1,
    "rental_status": "picked_up",
    "customer_name": "Apex Infrastructure Partners",
    "site_name": "Ras Tanura Refinery Expansion",
    "asset_code": "CRN-50-001",
    "applied_rate": "1150.00",
    "rate_unit": "daily",
    "discount_note": "Long term lease discount applied"
  }
}
```

##### Staff Response (200 OK — Serialized & Stripped)
Staff see all operational information required to inspect or handle the equipment (`asset_code`, `customer_name`, `site_name`, `rental_status`, `rate_unit`), but **confidential financial fields are physically omitted** by `sanitizeFinancials()`:
```json
{
  "role": "staff",
  "data": {
    "rental_id": 1,
    "rental_status": "picked_up",
    "customer_name": "Apex Infrastructure Partners",
    "site_name": "Ras Tanura Refinery Expansion",
    "asset_code": "CRN-50-001",
    "rate_unit": "daily"
  }
}
```

#### Fields Withheld from Staff

| Field | Visible to Admin | Visible to Staff | Explanation |
| :--- | :---: | :---: | :--- |
| `applied_rate` | Yes (`"1150.00"`) | **Omitted** | Agreed commercial hire price in SAR. Staff have no operational need to see client billing rates. |
| `discount_note` | Yes (`"Long term..."`) | **Omitted** | Internal commercial negotiation terms and special margin adjustments. |
| `amount` | Yes | **Omitted** | Standard list rate amounts on rate cards. |
| `unit_price` / `unit_cost` | Yes | **Omitted** | Material purchase prices or invoice unit costs. |
| `subtotal` / `vat_amount` / `total` | Yes | **Omitted** | Aggregated billing sums and tax line amounts on invoices. |
| `cost` | Yes | **Omitted** | Maintenance work order and repair expenditure figures. |
