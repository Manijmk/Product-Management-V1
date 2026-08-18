# Product Management System (PMS)

PMS is a multi-tenant SaaS platform for recurring route delivery and exchange businesses.

Seed vertical: water-can delivery.

The platform is intentionally generic enough to support future verticals such as LPG, dairy, newspaper delivery, and similar recurring route operations.

## Core Model

```text
Route Template
      ↓
Trip
      ↓
TripStop
      ↓
StopEvent
      ↓
Inventory Ledger + Money Ledger
      ↓
Reconciliation
```

Key principles:

- Route is a template; Trip is the actual day.
- StopEvent records what actually happened.
- Ledgers are append-only source of truth.
- Customer balance, stock-on-hand, staff cash-in-hand and container position are derived.
- All tenant-owned data is isolated at database level with PostgreSQL RLS.
- Offline event posting must be idempotent.

## Repository Layout

```text
AGENTS.md
README.md
docs/
database/
backend/
mobile/
web/
```

## Database Migration Order

Apply in order:

1. `database/001_foundation.sql`
2. `database/002_operations.sql`
3. `database/003_execution_ledgers.sql`
4. `database/004_reconciliation.sql`

## Backend Status

The backend folder is intentionally empty for the Codex implementation handoff.

The implementation agent must read `AGENTS.md` and all Sprint 0 docs before scaffolding the backend.

## Sprint 0 Goal

Deliver a secure, tested backend foundation capable of:

- tenant/user/role/staff management,
- product/customer/price configuration,
- route templates,
- flexible trips,
- stop execution,
- return-matched shop exchange,
- inventory and money ledger posting,
- idempotent offline sync,
- trip reconciliation and cash handover.

Future ERP modules are out of scope for this handoff.
