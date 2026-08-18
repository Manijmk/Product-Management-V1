# 08 — Codex Sprint 0 Implementation Task

## Objective

Implement the first production-quality PMS backend slice from the repository specifications.

## Locked Stack

Use exactly:

- Node.js 24 LTS
- TypeScript
- NestJS
- Fastify
- PostgreSQL
- Prisma + parameterized PostgreSQL SQL
- REST + OpenAPI
- Jest
- Docker Compose
- Modular Monolith

Do not replace NestJS with Express/Fastify-only, another framework, another database, or another ORM without explicit approval.

Do not introduce Redis/BullMQ yet unless a documented Sprint 0 requirement genuinely needs it.

## Required Reading

Before changing code, read:

1. `AGENTS.md`
2. `README.md`
3. `docs/01-product-overview.md`
4. `docs/02-business-rules.md`
5. `docs/03-domain-model.md`
6. `docs/04-api-contract-v1.md`
7. `docs/05-backend-architecture.md`
8. `docs/06-sprint-0-acceptance-criteria.md`
9. `docs/07-test-scenarios.md`
10. all SQL files in `/database`

## First Implementation Step

Before implementing business APIs:

1. Scaffold NestJS using Fastify.
2. Enable TypeScript strict mode.
3. Add config/env validation.
4. Add structured logging.
5. Add Swagger/OpenAPI.
6. Add PostgreSQL connectivity.
7. Add Prisma mapped to the existing SQL schema.
8. Add database migration/bootstrap scripts that apply `/database` files in order.
9. Add a tenant-context transaction helper that executes `SET LOCAL app.tenant_id`.
10. Add test infrastructure against PostgreSQL.
11. Run all four SQL migrations against a clean database.
12. Verify RLS is active in integration tests.

Only then begin feature APIs.

## Scope

Implement:

- backend project scaffold,
- configuration/env handling,
- PostgreSQL connection + migration/bootstrap,
- authenticated tenant context abstraction,
- foundation/master-data APIs,
- route/trip APIs,
- StopEvent execution workflow,
- inventory ledger posting,
- money ledger posting,
- idempotent StopEvent submission,
- reconciliation APIs,
- cash handover APIs,
- automated tests.

## Explicit Non-Goals

Do not implement:

- invoicing,
- payroll,
- customer portal,
- notifications,
- procurement,
- advanced accounting/P&L,
- full vehicle maintenance/compliance,
- multi-vertical UI.

## Database Rules

- SQL migrations under `/database` are authoritative.
- Prisma must map to the resulting DB.
- Do not replace SQL RLS, triggers, generated columns, views or ledger guards with Prisma-only equivalents.
- Never disable RLS to make implementation easier.
- `tenant_id` must come from authenticated server context.
- Do not add authoritative mutable stock/balance fields.

## Implementation Requirements

- Follow `AGENTS.md`.
- Keep controllers thin.
- Use application services for transactional workflows.
- Use domain services for exchange/pricing/damage/reconciliation calculations.
- Apply all database migrations in order.
- Use stable API error codes.
- Add local development seed data.
- Add Docker Compose for PostgreSQL.
- Add README setup/run/test commands after scaffolding.

## Test Gate

At minimum automate acceptance criteria:

- tenant isolation,
- RLS enforcement,
- Route → Trip copy,
- live TripStop addition,
- temporary/permanent staff-created customer behavior,
- RETURN_MATCHED delivery,
- excess-empty credit,
- container due,
- damage charge,
- pricing resolution,
- duplicate client UUID,
- append-only ledgers,
- partial delivery,
- Trip completion guard,
- reconciliation,
- cash handover,
- late event exception.

## Completion Output

When implementation is complete:

1. run tests,
2. run migrations against a clean database,
3. report test results,
4. summarize architecture decisions,
5. list any spec ambiguity encountered,
6. do not silently alter agreed business rules.
