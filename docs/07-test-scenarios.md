# 07 — Test Scenarios

These scenarios are the minimum behavioral test catalog for Sprint 0.

## TS-001 Normal Fixed Delivery

- Route TripStop exists.
- Planned 2.
- Deliver 2.
- Receive 2 empties.
- Verify StopEvent.
- Verify inventory movements.
- Verify charge/payment behavior.

## TS-002 Return-Matched Shop

- No planned quantity.
- Forecast = 8.
- Good empties = 8.
- Deliver 8.
- Verify forecast caused no ledger movement by itself.

## TS-003 Excess Empties + Credit

- Good empties = 12.
- Full stock = 8.
- Accept all.
- Deliver 8.
- Verify credit = 4.

## TS-004 Excess Empties + Replacement Only

- Good empties observed = 12.
- Accept only 8.
- Deliver 8.
- Verify no credit.

## TS-005 Container Due

- Deliver 5.
- Good empties received = 3.
- Staff authorizes due = 2.
- Verify audit record.

## TS-006 Damaged Can Charged

- Good = 4.
- Damaged = 1.
- Active damage rate exists.
- Select CHARGE_DAMAGE.
- Verify correct financial charge.

## TS-007 Damaged Can No Charge

- Damaged = 1.
- Select ACCEPT_DAMAGE_WITHOUT_CHARGE.
- Verify stock state movement without damage charge.

## TS-008 Damaged Can Rejected

- Damaged = 1.
- Select REJECT_DAMAGE.
- Verify it does not count as accepted eligible return.

## TS-009 Staff Adds Existing Customer During Trip

- Trip IN_PROGRESS.
- Staff adds existing Party.
- Verify source = STAFF_ADDED.

## TS-010 Staff Creates Temporary Customer

- Staff creates temporary Party.
- Add it to current Trip.
- Complete delivery.

## TS-011 Staff Creates Permanent Customer

- Staff creates permanent Party.
- Verify PENDING_APPROVAL.
- Owner approves.
- Verify ACTIVE.

## TS-012 Admin Adds Stop Remotely

- Trip IN_PROGRESS.
- Admin adds stop.
- Verify mobile-facing query returns it after sync.

## TS-013 Stop Reorder

- Stops 10,20,30.
- Insert/reorder to 25.
- Verify pending order.
- Verify completed historical event is untouched.

## TS-014 Partial Delivery → Follow-Up

- Required 10.
- Deliver 6.
- Create follow-up remaining 4.

## TS-015 Partial Delivery → New TripStop

- Required 10.
- Deliver 6.
- Create linked future TripStop for 4.

## TS-016 Additional Vehicle Loading

- Trip active.
- Post extra Godown → Vehicle FULL movement.
- Verify derived stock increases.

## TS-017 Full Cash Payment

- Charge 400.
- Collect 400 cash.
- Verify staff cash-in-hand increases.

## TS-018 Partial Payment

- Charge 400.
- Collect 250.
- Verify outstanding 150.

## TS-019 Old Dues Payment

- Old charge exists.
- New payment allocated to old charge.
- Verify allocation rules.

## TS-020 Advance Payment

- Payment exceeds current charge.
- Verify customer credit/unallocated position according to service policy.

## TS-021 Offline StopEvent

- Save client UUID.
- Post after connectivity returns.
- Verify single accepted event.

## TS-022 Duplicate Retry

- Submit identical client UUID twice.
- Verify no duplicate ledgers.

## TS-023 Two Devices Same Stop

- Competing normal completion attempts.
- First valid write wins.
- Second receives existing completion/conflict result.

## TS-024 Pre-Reconciliation Correction

- Original event wrong.
- Post correction/reversal.
- Verify original remains auditable.

## TS-025 Late Event After Reconciliation

- Reconcile Trip.
- Post genuine offline late event.
- Verify reconciliation exception.

## TS-026 Wrong Customer Correction

- Event posted to wrong Party.
- Use explicit reversal/correction flow.
- Verify no destructive historical reassignment.

## TS-027 Trip Completion With Pending Stop

- One PENDING remains.
- Completion rejected until handled.

## TS-028 Stock Variance

- Expected full = 20.
- Actual full = 19.
- Reason required.
- Admin approval required according to service policy.

## TS-029 Cash Variance

- Expected cash = 10,200.
- Actual cash = 10,000.
- Reason required.
- Admin/owner approval.

## TS-030 Cash Handover

- Staff submits 10,000.
- Admin confirms.
- Verify immutable handover ledger effect.

## TS-031 Tenant Isolation Across Every Core Aggregate

Create equivalent IDs/data under two tenants.
Attempt cross-tenant reads/writes through repositories and APIs.
Verify isolation.

## TS-032 Price History

- Product price 40 until date X.
- New price 45 from date X.
- Historical StopEvent retains old snapshot.

## TS-033 Damage Rate History

- Damage rate changes over time.
- Historical damage charge remains unchanged.

## TS-034 Container Lifecycle

Exercise:

EMPTY → CLEANING → REFILL → FULL

Verify stock-on-hand by state/location after each movement.

## TS-035 Reconciliation Approval Guard

Attempt Trip RECONCILED without approved reconciliation.
Must fail.

## TS-036 Open Exception Guard

Approved reconciliation has open critical exception.
Trip close must fail until exception resolved.
