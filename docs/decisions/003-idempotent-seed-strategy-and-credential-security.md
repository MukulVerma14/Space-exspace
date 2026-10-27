# ADR 003: Idempotent Seed Strategy and Credential Security

## Context
A client-facing prototype and automated test harness must be resilient to resets:
1. When demonstrating to stakeholders or onboarding developers, running the database seed script repeatedly must never crash with primary key or unique constraint violations.
2. The initial equipment fleet (~41 realistic items) spans complex interconnected relationships: models, standard rate cards, physical locations, append-only location logs, customer rentals with frozen applied rates, repair tickets, materials SKUs, and invoices with ledger receipts.
3. Test passwords must be documented clearly for interviewers and developers, but securely hashed with `bcrypt` in the database so development practices model production security standards.
4. Fictional, clearly fabricated company names and mock VAT numbers must be used to ensure no unintended resemblance to actual commercial entities.

## Decision
1. **Strict Idempotency via Natural Key Lookups and Upserts**:
   - Master entities (`users`, `equipment_types`, `equipment_models`, `locations`, `equipment`, `items`) use PostgreSQL `ON CONFLICT (...) DO UPDATE` or explicit natural-key lookups (`name`, `email`, `asset_code`, `sku`).
   - Dependent relational entities (`rental_items`, `location_log`, `maintenance`, `invoices`, `stock_movements`) check for existing association rows before inserting, ensuring subsequent runs safely update rather than duplicating.
   - The entire seeding operation is wrapped in an atomic PostgreSQL transaction (`BEGIN ... COMMIT`). If any statement fails, the transaction is rolled back completely.
   - **Production Guard**: The seeder explicitly checks `NODE_ENV === 'production'` and immediately throws an error to prevent accidental execution in production environments.
2. **Fictional Data & Mock Identifiers**:
   - All seeded parties use completely fictional names (e.g. "Gulf Heavy Metals Trading", "Apex Infrastructure Partners") with obviously fake mock VAT numbers (e.g. `100000000000001`, `200000000000001`). No real corporate entities or official tax registrations are represented.
   - Rentals represent 2 active agreements containing 5 and 2 items respectively (total 7 items currently rented), plus 1 historical returned rental.
3. **Credential Security**:
   - Passwords for the two seeded roles (`admin@spaceexspace.com` and `staff@spaceexspace.com`) are hashed using standard `bcrypt` (10 salt rounds).
   - Plaintext passwords (`Admin#2026!Dev` and `Staff#2026!Dev`) are documented strictly in `README.md` for local testing only. Production environments will use dynamic environment variables or invite-token flows.

## Alternatives Considered
1. **Truncating / Dropping Tables Before Seeding (`TRUNCATE CASCADE`)**:
   - *Why rejected*: Destructive truncation breaks persistent development states and causes severe concurrency issues if automated test runners or local development servers are actively listening to connections. An upsert-based idempotent seeder preserves non-conflicting records and tests real-world data update paths.
2. **Mocking Data in Application Memory**:
   - *Why rejected*: In-memory mocks do not test real PostgreSQL constraints, foreign key cascades, partial indexes, or derived view joins (`v_equipment_current`).

## Consequences
### Positive
- Developers and CI/CD pipelines can run `npm run seed` at any point to guarantee demo data readiness without wiping the database.
- Uses realistic equipment specifications (crane tonnage, kVA generators) while keeping corporate identities and tax IDs strictly fictional.
- Automated tests verify password hashes using real bcrypt decryption.

### Negative / Trade-offs
- Upsert logic requires slightly more verbose seeding code compared to naive `INSERT` scripts.
