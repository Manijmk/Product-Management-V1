# 05 — Backend Architecture

## Goal

Keep HTTP transport, workflow orchestration, business rules and persistence clearly separated.

Recommended layering:

```text
Controller / Route Handler
          ↓
Application Service
          ↓
Domain Services
          ↓
Repositories
          ↓
PostgreSQL
```

## Controller Responsibilities

Controllers should:

- parse request,
- invoke validation,
- obtain authenticated user/tenant context,
- call application service,
- map service result to HTTP response.

Controllers should not:

- calculate exchange balances,
- write ledger rows directly,
- calculate pricing,
- manage reconciliation rules,
- contain large SQL queries.

## Application Services

Examples:

- `CreateTripService`
- `AddTripStopService`
- `LoadTripVehicleService`
- `CompleteStopService`
- `CompleteTripService`
- `CreateReconciliationService`
- `ApproveReconciliationService`
- `ConfirmCashHandoverService`

Application services own transaction boundaries for multi-step writes.

## Domain Services

Examples:

### ExchangeCalculationService

Inputs:

- quantity mode,
- exchange ratio,
- good empties,
- damaged empties,
- full stock available,
- selected exception resolution.

Outputs:

- suggested delivery,
- actual exchange position,
- container due,
- container credit,
- validation errors.

### PricingService

Resolution:

1. active PartyProductPrice
2. active ProductPrice
3. approved staff override

Returns an immutable pricing snapshot for the StopEvent.

### DamageChargeService

Resolves time-versioned ProductDamageRate and selected damage resolution.

### InventoryPostingService

Produces deterministic ledger rows from accepted operational events.

### MoneyPostingService

Produces deterministic charges, payments, damage charges, cash handovers and adjustments.

### ReconciliationService

Calculates expected stock and cash from ledgers and enforces close rules.

## Repository Layer

Repositories should:

- execute persistence operations,
- honor tenant context,
- expose explicit query methods,
- avoid embedding business policy.

## Request Transaction Pattern

Every protected request that touches tenant data should conceptually execute:

```text
BEGIN
SET LOCAL app.tenant_id = authenticated tenant
perform service work
COMMIT
```

This ensures PostgreSQL RLS uses server-resolved tenant context.

## Stop Completion Transaction

`POST /trip-stops/:id/events` is the critical atomic transaction.

All of these must succeed or fail together:

- idempotency check,
- StopEvent,
- StopEventProduct,
- exchange exception,
- price snapshot/override,
- inventory ledger posting,
- money ledger posting,
- TripStop state change.

Never leave a StopEvent committed without its required ledger consequences.

## Append-Only Strategy

Do not write generic repository methods such as:

- `updateInventoryLedger()`
- `deleteInventoryLedger()`
- `updateMoneyLedger()`

Corrections use explicit operations:

- reverse original,
- create adjustment,
- create correction event.

## Background Work

Sprint 0 may keep reconciliation synchronous for simplicity.

Future job-runner responsibilities:

- scheduled reconciliation alerts,
- billing,
- payroll,
- dues aging,
- compliance alerts,
- notifications.

Do not couple those future engines into the first operational APIs.

## Observability

At minimum log:

- request correlation ID,
- tenant ID,
- authenticated user/staff ID,
- Trip ID where relevant,
- StopEvent client UUID,
- transaction outcome,
- error code.

Never log secrets or sensitive authentication tokens.
