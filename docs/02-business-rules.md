# 02 — Business Rules

## 1. Quantity Modes

### FIXED_PLANNED

Used when the normal quantity is known before the Trip.

Example:

- House customer
- Planned quantity: 2

### RETURN_MATCHED

Used for shops where quantity is known only at the stop.

Example:

- Good empties: 8
- Damaged empties: 1
- Exchange ratio: 1:1
- Eligible exchange: 8
- Vehicle full stock: 10
- Suggested delivery: 8

`planned_qty` may be null.
`forecast_qty` may be populated for vehicle loading only.

### AD_HOC

Used when quantity is decided during an order/visit.

## 2. Excess Empties With Insufficient Full Stock

Example:

- Eligible empties: 12
- Full stock available: 8

Allowed outcomes:

### A. Accept as credit

- accept 12 empties
- deliver 8 full
- customer container credit = 4

### B. Accept only replacement quantity

- accept 8 empties
- deliver 8 full
- remaining 4 empties stay with customer

The chosen resolution must be recorded explicitly.

## 3. Fewer Empties Than Full Containers Delivered

Example:

- full delivered: 5
- eligible empties returned: 3

Delivery staff may authorize:

- container due = 2

The authorization must be audited.

## 4. Damaged / Broken / Lost Containers

Rates are time-versioned.

Transaction-time outcomes:

- `CHARGE_DAMAGE`
- `ACCEPT_DAMAGE_WITHOUT_CHARGE`
- `REJECT_DAMAGE`

Historical applied damage charges are immutable.

## 5. Shop Maximum Quantity

No default maximum daily exchange quantity exists for the seed shop workflow.

Vehicle stock and business availability remain the operational constraints.

## 6. Customer Creation

### Temporary Customer

Delivery staff may create without owner approval.

Typical status:

- `TEMPORARY`

### Permanent Customer

Delivery staff may create the record, but it remains:

- `PENDING_APPROVAL`

Owner/Admin approves it before it becomes:

- `ACTIVE`

## 7. Pricing

Resolution order:

1. Customer-specific active price.
2. Product default active price.
3. Staff override with approval.

Applied price is snapshotted on actual StopEvent product execution.

## 8. Partial Delivery

Example:

- required: 10
- delivered: 6
- remaining: 4

Allowed resolutions:

- create new linked TripStop,
- create follow-up,
- cancel remaining demand with reason.

The decision is contextual and must be explicit.

## 9. Container States

Initial states:

- FULL
- EMPTY
- DAMAGED
- CLEANING
- REFILL
- LOST

State and physical location must be represented independently.

## 10. Cash Reconciliation

Delivery staff submits actual cash/handover.

Tenant Owner/Admin may:

- confirm handover,
- approve shortage,
- approve excess,
- approve cash variance adjustment.

Staff must not approve their own variance.

## 11. GPS / Proof Photo

Neither GPS nor proof photo is mandatory in Sprint 0.

Both fields remain nullable and may later become tenant-configurable.

## 12. Reconciled Trips

Normal edits are blocked after reconciliation.

Late genuine StopEvents must:

1. create a reconciliation exception,
2. be reviewed,
3. create explicit post-reconciliation adjustment/correction records if accepted.
