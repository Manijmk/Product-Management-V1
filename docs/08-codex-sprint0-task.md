# 08 — Codex Sprint 0 Implementation Task

## Objective

Implement the first production-quality PMS backend slice from the repository specifications.

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

## Scope

Implement:

- backend project scaffold,
- configuration/env handling,
- PostgreSQL connection + migrations,
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

## Implementation Requirements

- Follow `AGENTS.md`.
- Keep controllers thin.
- Use application services for transactional workflows.
- Use domain services for exchange/pricing/damage/reconciliation calculations.
- Apply all database migrations in order.
- Never disable RLS to make tests pass.
- Use server-resolved tenant context.
- Do not add mutable balance/stock columns.
- Do not add ledger UPDATE/DELETE operations.
- Implement stable API error codes.
- Add migrations/seeds needed for local development.
- Add README setup instructions after selecting the concrete backend stack.

## Test Gate

At minimum automate acceptance criteria:

- tenant isolation,
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
2. run migrations on a clean local database,
3. report test results,
4. summarize architecture decisions,
5. list any spec ambiguity encountered,
6. do not silently alter agreed business rules.
