# PMS Development Rules

These instructions apply to the entire repository.

## Product Intent

PMS is a multi-tenant recurring route-delivery and exchange operations platform.
The seed vertical is water-can delivery, but implementation must remain configuration-driven and reusable.

Core distinction:

- Route = reusable planning template.
- Trip = actual operational run.
- TripStop = stop intended/added for a Trip.
- StopEvent = what actually happened.
- InventoryLedgerEntry / MoneyLedgerEntry = accounting truth.
- Balances and stock views are derived, not manually maintained.

## Architecture Rules

- PostgreSQL is the primary database.
- Every tenant-owned row must remain tenant scoped.
- Never trust a `tenant_id` supplied by the client.
- Tenant context must come from authenticated server context.
- PostgreSQL RLS must remain enabled and enforced.
- Prefer clear application/domain service boundaries over business logic in controllers.
- Do not couple business-specific terminology such as "water can" into generic core services.

## Ledger Rules

- `inventory_ledger_entry` is append-only.
- `money_ledger_entry` is append-only.
- Never UPDATE or DELETE posted ledger rows.
- Corrections use reversal/adjustment entries.
- Never store mutable `customer_balance`, `vehicle_stock`, `staff_cash_in_hand`, or `container_due` as authoritative state.
- Derived projections/views may be cached later, but ledgers remain source of truth.

## Route / Trip Rules

- Route is a reusable template only.
- Trip may exist without Route.
- Stops may be added after dispatch while Trip is PLANNED, LOADED, DISPATCHED, or IN_PROGRESS.
- Pending stops may be reordered.
- Completed historical stops must not be silently deleted.
- Delivery staff may add an existing customer if permitted.
- Delivery staff may create a temporary customer without owner approval.
- A permanent customer created by staff remains PENDING_APPROVAL until owner/admin approval.

## Quantity Modes

Supported quantity modes:

- `FIXED_PLANNED`
- `RETURN_MATCHED`
- `AD_HOC`

For `RETURN_MATCHED` customers:

1. Count eligible empty containers first.
2. Record damaged/rejected empties separately.
3. Calculate suggested full-container delivery from eligible empties and exchange ratio.
4. Record actual full quantity independently.
5. `forecast_qty` is planning-only and must never post inventory, billing, or money effects.
6. If excess empties exist and full stock is insufficient, support:
   - accept only the number replaced, or
   - accept all eligible empties and create container credit.
7. If fewer empties are returned than full containers delivered, delivery staff may authorize container due.
8. No fixed daily maximum is required for shops unless future configuration explicitly adds one.

## Container States

Initial supported states:

- FULL
- EMPTY
- DAMAGED
- CLEANING
- REFILL
- LOST

State and location are separate dimensions.

## Damage Rules

Damaged/broken/lost container charges are time-versioned.
At transaction time, the business may:

- charge the customer,
- accept without charge,
- reject the container.

Historical charges must not change when future rates change.

## Pricing Rules

Price resolution order:

1. Active customer-specific price.
2. Active product default price.
3. Staff-entered override requiring approval.

The applied price must be snapshotted on the transaction.
Do not recalculate historical transactions using current prices.

## Offline / Idempotency Rules

- Offline StopEvents must use a client-generated UUID.
- Reposting the same `(tenant_id, client_uuid)` must be idempotent.
- Duplicate retries must not create duplicate StopEvents, inventory ledger entries, or money ledger entries.
- Late-arriving events after reconciliation must become explicit reconciliation exceptions.

## Reconciliation Rules

- Expected stock comes from inventory ledger.
- Expected cash comes from money ledger.
- Staff may submit actual stock/cash.
- Only Tenant Owner/Admin may approve cash or stock variance adjustments.
- Reconciled Trips are operationally closed.
- Post-reconciliation corrections require explicit exception + adjustment workflow.

## Coding Rules

- Keep controllers thin.
- Put transactional workflows in application services.
- Put reusable business calculations in domain services.
- Repositories/data-access code must not contain hidden business rules.
- Every write workflow that affects stock or money must execute inside one database transaction.
- Return stable machine-readable error codes in APIs.
- Never silently coerce invalid business inputs.

## Testing Rules

No feature is complete without tests.

Mandatory categories:

- tenant isolation tests,
- RLS behavior tests,
- StopEvent idempotency tests,
- inventory ledger correctness tests,
- money ledger correctness tests,
- RETURN_MATCHED exchange tests,
- correction/reversal tests,
- reconciliation close tests,
- late offline event tests.

Ledger-critical tests must block merge if failing.

## Scope Control

Sprint 0 implementation should not expand into:

- invoicing,
- payroll,
- customer portal,
- WhatsApp/SMS,
- procurement,
- full accounting/P&L,
- advanced vehicle compliance,
- analytics beyond foundation views.

Do not redesign core architecture without documenting the reason and updating relevant docs.
