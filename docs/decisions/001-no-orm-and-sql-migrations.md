# ADR 001: Plain SQL Migrations and No ORM (Direct `pg` Driver)

## Context
SPACE EXSPACE requires a robust relational data model for industrial equipment tracking, rentals, and materials inventory. The core architecture relies heavily on advanced relational database capabilities:
1. **Derived State via Views**: `v_equipment_current` derives physical asset status dynamically from the latest `location_log`, active `rental_items`, and active `maintenance` rows.
2. **Integrity via Partial Unique Indexes**: Enforcing business rules directly in the database (e.g. `CREATE UNIQUE INDEX ... ON rental_items (equipment_id) WHERE returned_at IS NULL` to physically prevent renting an already-rented asset).
3. **Database Constraints**: `CHECK` constraints on monetary amounts (`amount > 0`), date ranges (`expected_end >= start_date`), and non-negative stock movements.
4. **Pedagogical and Client Explainability**: A final-year CS student must understand, defend, and clearly demonstrate how data integrity is enforced without magical ORM abstractions obscuring the query execution plan.

## Decision
We choose **plain SQL migrations (`node-pg-migrate`)** and the native **PostgreSQL client driver (`pg`)** without an Object-Relational Mapper (such as Prisma, TypeORM, or Sequelize).
- All schema objects (tables, constraints, triggers, indexes, views) will be written in pure PostgreSQL DDL scripts.
- Application queries will use raw, parameterized SQL queries (`$1, $2, ...`) with strict schema validation on results using Zod.

## Alternatives Considered
1. **Prisma ORM**:
   - *Why rejected*: Prisma obscures advanced PostgreSQL features. Partial unique indexes and SQL views have limited native support or require awkward escape hatches (`@@index(..., map: ...)` and manual `$queryRaw`). Prisma's client generation step also adds build complexity and disconnects the developer from understanding the underlying SQL and query plan.
2. **TypeORM / Sequelize**:
   - *Why rejected*: Heavy Active-Record / Data-Mapper abstractions prone to N+1 query pitfalls, cumbersome migration synchronization, and hidden SQL generation that makes it difficult to reason about transactions, locking, and constraints.
3. **Kysely / Knex (Query Builders)**:
   - *Why rejected*: While closer to raw SQL than ORMs, query builders introduce an intermediate syntax layer that still needs translation when explaining database design decisions to clients or interviewers. Raw parameterized SQL is universally understood and portable.

## Consequences
### Positive
- **Full Power of PostgreSQL**: Direct access to partial indexes, conditional uniqueness, CTEs (`WITH` queries), views, and window functions.
- **Zero Abstraction Tax**: Queries run exactly as written; predictable query execution plans and index utilization.
- **Educational Clarity**: Clear separation between SQL relational logic and TypeScript application logic.
- **Auditability & Security**: Explicit parameterized queries prevent SQL injection while making data mutation boundaries evident.

### Negative / Trade-offs
- Manual mapping between SQL query results and TypeScript types (mitigated by Zod runtime schemas).
- Schema refactors require manual coordination of SQL migration files and application models.
