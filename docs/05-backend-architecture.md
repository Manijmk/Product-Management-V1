# 05 — Backend Architecture

## Locked Stack

- Node.js 24 LTS
- TypeScript
- NestJS
- Fastify
- PostgreSQL
- Prisma for typed application data access
- Parameterized PostgreSQL SQL for DB-specific operations
- REST APIs
- Swagger/OpenAPI
- Jest
- Docker Compose
- Modular Monolith

Redis + BullMQ are intentionally deferred until asynchronous workloads are introduced.

## Goal

Keep HTTP transport, workflow orchestration, business rules and persistence clearly separated.

Recommended layering:

```text
NestJS Controller
        ↓
Application Service
        ↓
Domain Services
        ↓
Repository / Prisma / SQL
        ↓
PostgreSQL
```

## NestJS Modules

Initial modules:

```text
auth
tenancy
users
staff
products
customers
routes
vehicles
trips
stop-events
inventory
money
reconciliation
```

Avoid one giant "core" module.

## Fastify

NestJS must run using the Fastify adapter.

`main.ts` should bootstrap `NestFastifyApplication`.

Global concerns should include:

- validation,
- structured logging,
- API version prefix,
- Swagger/OpenAPI,
- request correlation ID,
- consistent exception mapping.

## TypeScript

Enable strict mode.

Do not use `any` to bypass domain typing.

Prefer explicit types/unions for business states such as:

- TripStatus
- QuantityMode
- PartyStatus
- StopStatus
- ExchangeResolution
- ReconciliationStatus

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

1. active PartyProductPrice,
2. active ProductPrice,
3. approved staff override.

Returns an immutable pricing snapshot for the StopEvent.

### DamageChargeService

Resolves time-versioned ProductDamageRate and selected damage resolution.

### InventoryPostingService

Produces deterministic ledger rows from accepted operational events.

### MoneyPostingService

Produces deterministic charges, payments, damage charges, cash handovers and adjustments.

### ReconciliationService

Calculates expected stock and cash from ledgers and enforces close rules.

## Prisma / SQL Strategy

SQL migrations under `/database` are authoritative.

Prisma must map to the existing schema.

Do not allow Prisma migrations to:

- remove RLS,
- remove triggers,
- change append-only ledger protections,
- drop derived views,
- simplify constraints that encode business invariants.

Use Prisma for normal typed data access.

Use parameterized raw SQL for operations such as:

- `SET LOCAL app.tenant_id`,
- view/report access where convenient,
- PostgreSQL-specific behavior that Prisma does not model cleanly.

## Tenant Transaction Pattern

Every protected request that touches tenant data should conceptually execute:

```text
BEGIN
SET LOCAL app.tenant_id = authenticated tenant
perform service work
COMMIT
```

Tenant ID comes from authenticated server context, never from arbitrary client input.

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

Never leave a StopEvent committed without required ledger consequences.

## Append-Only Strategy

Do not expose generic repository methods such as:

- `updateInventoryLedger()`
- `deleteInventoryLedger()`
- `updateMoneyLedger()`
- `deleteMoneyLedger()`

Corrections use explicit operations:

- reverse original,
- create adjustment,
- create correction event.

## Testing

Use Jest.

Integration tests must execute against real PostgreSQL behavior so RLS, constraints, triggers and transaction handling are actually exercised.

Mock-only tests are not sufficient for ledger-critical workflows.

## Background Work

Sprint 0 may keep reconciliation synchronous.

Later introduce:

```text
Redis
  ↓
BullMQ
```

for:

- billing,
- payroll,
- notifications,
- scheduled EOD checks,
- retryable external integrations.

## Observability

At minimum log:

- request correlation ID,
- tenant ID,
- authenticated user/staff ID,
- Trip ID where relevant,
- StopEvent client UUID,
- transaction outcome,
- error code.

Never log secrets, auth tokens, or sensitive payment credentials.
