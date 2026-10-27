# SPACE EXSPACE Equipment & Materials Tracker — Architecture

## 1. System Overview
SPACE EXSPACE (Dammam, Saudi Arabia) operates an equipment rental and industrial services fleet (crane rental, containers, portable offices, diesel generators, cleaning machinery) alongside materials inventory (metal sheets, conduits, wires, paints) and invoice tracking.

This system provides:
- **Mobile PWA** for yard and field technicians: Scan QR code on physical assets, view specifications, and execute physical state changes (move, dispatch, return, send to repair).
- **Web Dashboard** for office administrators: Full fleet visibility, rate cards, active rentals, material stock levels, and historical invoice material price tracking.
- **REST API Backend**: High-reliability Node.js + TypeScript service backed by PostgreSQL 16.

```mermaid
flowchart TD
    subgraph Clients
        PWA["Mobile PWA (Field Staff)"]
        Desk["Office Web Dashboard (Admin)"]
    end

    subgraph Backend ["Backend API (Node.js + Express)"]
        Auth["Auth & Role Guard (JWT)"]
        EqAPI["Equipment & QR API"]
        MatAPI["Materials & Invoices API"]
        ViewEngine["Derived State View Engine"]
    end

    subgraph Storage ["PostgreSQL 16"]
        Users[("users")]
        Equip[("equipment + models + types")]
        Log[("location_log (Append-only)")]
        Rentals[("rentals + rental_items")]
        Maint[("maintenance")]
        Stock[("stock_movements (Ledger)")]
        Invoices[("invoices + invoice_lines")]
        View[("v_equipment_current (SQL View)")]
    end

    PWA -->|Scan QR / Move Asset| Auth
    Desk -->|Manage Fleet / Rates / Stock| Auth
    Auth --> EqAPI
    Auth --> MatAPI
    EqAPI --> Equip
    EqAPI --> Log
    EqAPI --> Rentals
    EqAPI --> Maint
    MatAPI --> Stock
    MatAPI --> Invoices
    EqAPI -.-> ViewEngine -.-> View
```

## 2. Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    users {
        int id PK
        string name
        string email UK
        string password_hash
        string role
        boolean active
        timestamptz created_at
    }

    equipment_types {
        int id PK
        string name UK
        string capacity_unit
        timestamptz created_at
    }

    equipment_models {
        int id PK
        int type_id FK
        string make
        string model
        numeric capacity_value
        timestamptz created_at
    }

    rates {
        int model_id PK,FK
        string unit PK
        numeric amount
        boolean vat_included
        timestamptz valid_from PK
    }

    parties {
        int id PK
        string name
        string contact_person
        string phone
        string email
        string vat_no
        text address
        boolean is_customer
        boolean is_supplier
        boolean active
        timestamptz created_at
    }

    locations {
        int id PK
        string name UK
        string kind
        int party_id FK
        timestamptz created_at
    }

    equipment {
        int id PK
        string asset_code UK
        int model_id FK
        string serial_no
        string condition
        boolean active
        timestamptz created_at
    }

    location_log {
        bigint id PK
        int equipment_id FK
        int location_id FK
        int moved_by FK
        timestamptz moved_at
        text note
    }

    maintenance {
        bigint id PK
        int equipment_id FK
        string kind
        text description
        numeric cost
        timestamptz opened_at
        timestamptz closed_at
        int reported_by FK
    }

    rentals {
        bigint id PK
        int customer_id FK
        int site_id FK
        string status
        date start_date
        date expected_end
        timestamptz created_at
    }

    rental_items {
        bigint rental_id PK,FK
        int equipment_id PK,FK
        numeric applied_rate
        string rate_unit
        text discount_note
        timestamptz returned_at
    }

    item_categories {
        int id PK
        string name UK
    }

    units {
        int id PK
        string code UK
        string name
    }

    items {
        int id PK
        string sku UK
        string name
        int category_id FK
        int unit_id FK
        numeric reorder_level
        boolean active
        timestamptz created_at
    }

    invoices {
        bigint id PK
        string direction
        string invoice_no
        int party_id FK
        bigint rental_id FK
        date invoice_date
        date due_date
        numeric subtotal
        numeric vat_amount
        numeric total
        string status
        date paid_on
        text file_url
        timestamptz created_at
    }

    invoice_lines {
        bigint invoice_id PK,FK
        int line_no PK
        text description
        int item_id FK
        numeric quantity
        int unit_id FK
        numeric unit_price
    }

    stock_movements {
        bigint id PK
        int item_id FK
        numeric qty
        string type
        bigint invoice_line_invoice_id FK
        int invoice_line_no FK
        bigint maintenance_id FK
        numeric unit_cost
        int moved_by FK
        timestamptz moved_at
        text note
    }

    equipment_types ||--o{ equipment_models : "categorizes"
    equipment_models ||--o{ rates : "priced_by"
    equipment_models ||--o{ equipment : "manufactures"
    parties ||--o{ locations : "owns_site"
    parties ||--o{ rentals : "rents"
    parties ||--o{ invoices : "bills"
    locations ||--o{ location_log : "destination"
    locations ||--o{ rentals : "site"
    equipment ||--o{ location_log : "tracked_in"
    equipment ||--o{ maintenance : "repaired_in"
    equipment ||--o{ rental_items : "assigned_to"
    rentals ||--o{ rental_items : "contains"
    rentals ||--o{ invoices : "billed_via"
    item_categories ||--o{ items : "classifies"
    units ||--o{ items : "measured_in"
    units ||--o{ invoice_lines : "measured_in"
    items ||--o{ invoice_lines : "priced_in"
    items ||--o{ stock_movements : "tracked_in"
    invoices ||--o{ invoice_lines : "items"
    invoice_lines ||--o{ stock_movements : "received_via"
    maintenance ||--o{ stock_movements : "consumed_by"
    users ||--o{ location_log : "logged_by"
    users ||--o{ maintenance : "reported_by"
    users ||--o{ stock_movements : "authorized_by"
```

## 3. Directory Structure
```text
/
├── backend/
│   ├── src/
│   │   ├── config/          # Validated environment configuration (Zod)
│   │   ├── db/              # PostgreSQL pool & connection management
│   │   ├── utils/           # Structured logging (Pino) & helpers
│   │   ├── app.ts           # Express application & middleware chain
│   │   ├── server.ts        # Server entrypoint with graceful shutdown
│   │   └── __tests__/       # Vitest test suites (health, schema, business rules)
│   ├── migrations/          # Plain SQL migrations (node-pg-migrate)
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── frontend/                # Mobile-first Vite + React + TypeScript PWA
├── docs/
│   ├── decisions/           # Architectural Decision Records (ADRs)
│   ├── ARCHITECTURE.md      # System architecture & ER diagram
│   ├── LEARNING_LOG.md      # Step-by-step educational log
│   ├── OPEN_QUESTIONS.md    # Unconfirmed client requirements
│   ├── DEMO.md              # 5-7 minute client walkthrough script
│   └── INTERVIEW_QA.md      # 25 core technical interview questions
├── docker-compose.yml       # PostgreSQL 16 container definition
└── README.md                # Quickstart and run instructions
```

## 4. Core Architectural Principles
1. **Derived State Over Stored State**: Physical equipment status (`available`, `rented`, `under_repair`) is derived dynamically in a SQL View (`v_equipment_current`) from immutable action records rather than mutable status columns.
2. **Append-Only Ledgers**:
   - Location tracking is stored as an immutable audit trail in `location_log`.
   - Materials inventory is stored as an immutable double-entry ledger in `stock_movements`.
3. **No ORM (Raw Parameterised SQL)**: Direct SQL allows explicit control over partial indexes, CHECK constraints, multi-table transactions, and database views without leaky abstraction layers.
4. **Defense in Depth**: Role boundaries (Admin vs Staff) are enforced server-side via data serialization guards, ensuring sensitive financial rates are never sent over the wire to unauthorized staff.
