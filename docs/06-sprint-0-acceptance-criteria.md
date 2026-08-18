# 06 — Sprint 0 Acceptance Criteria

These criteria define completion for the first Codex implementation slice.

## AC-01 Tenant Isolation

Given Tenant A and Tenant B exist,
when Tenant A queries customers/products/trips,
then no Tenant B rows are returned.

Cross-tenant writes must fail.

## AC-02 RLS Is Active

Given direct repository access under Tenant A database context,
attempting to select or insert Tenant B rows is rejected/filtered by PostgreSQL RLS.

## AC-03 Route Is a Template

Creating a Trip from a Route copies active template stops.

Changing an active TripStop does not mutate the RouteStopTemplate automatically.

## AC-04 Ad-hoc Trip

A Trip can be created with `route_id = null`.

## AC-05 Live Stop Addition

Given a Trip is IN_PROGRESS,
permitted staff/admin can add an existing customer as a new TripStop.

## AC-06 Temporary Customer

Delivery staff can create a TEMPORARY customer and use it on an active Trip without owner approval.

## AC-07 Permanent Customer Approval

A permanent customer created by delivery staff is PENDING_APPROVAL.

Only owner/admin approval makes it ACTIVE.

## AC-08 Pending Stop Reorder

Pending TripStops can be reordered without changing completed-stop historical execution.

## AC-09 Fixed Planned Delivery

Given planned quantity = 2,
staff can deliver 2, receive 2 empties and create correct StopEvent + ledger rows.

## AC-10 Return-Matched Shop

Given:

- quantity mode = RETURN_MATCHED
- good empties = 8
- exchange ratio = 1:1
- vehicle full stock >= 8

system suggests 8 full containers.

Actual delivery is recorded from StopEvent, not forecast quantity.

## AC-11 Excess Empties as Credit

Given:

- good empties = 12
- vehicle full stock = 8

staff can choose accept-all-as-credit.

Result:

- full delivered = 8
- eligible empties accepted = 12
- container credit = 4
- ledger reflects actual physical movement.

## AC-12 Accept Only Replaced Empties

For the same shortage,
staff can instead accept 8 empties and deliver 8.

No container credit is created.

## AC-13 Container Due

Given:

- full delivered = 5
- good empties = 3

delivery staff can authorize container due = 2.

## AC-14 Damage Charge

Given one damaged return and active damage rate,
staff can select CHARGE_DAMAGE.

A damage charge is posted using the effective rate snapshot.

## AC-15 Damage Accepted Without Charge

The same damaged return can be accepted without financial charge when selected.

## AC-16 Customer-Specific Price

If a customer-specific active price exists, it is used before product default.

## AC-17 Staff Price Override

Staff may request a price override.

The system records approval status and does not silently replace standard pricing history.

## AC-18 StopEvent Idempotency

Submitting the same `(tenant_id, client_uuid)` twice produces:

- one StopEvent,
- one set of inventory ledger effects,
- one set of money ledger effects.

The second request returns the already accepted result.

## AC-19 Append-Only Inventory Ledger

UPDATE and DELETE of posted inventory ledger rows are rejected.

## AC-20 Append-Only Money Ledger

UPDATE and DELETE of posted money ledger rows are rejected.

## AC-21 Partial Delivery Follow-Up

Given requested/expected 10 and delivered 6,
remaining 4 may create:

- linked new TripStop, or
- follow-up record.

## AC-22 Trip Completion Guard

Trip cannot complete with unexplained pending stops.

Every stop must be completed, partial, skipped, failed, rescheduled, cancelled, or otherwise explicitly handled.

## AC-23 Stock Reconciliation

Expected stock is calculated from inventory ledger.

Staff records actual stock.

Variance is displayed and requires reason when non-zero.

## AC-24 Cash Reconciliation

Expected cash is calculated from money ledger.

Staff records actual cash.

Non-zero variance requires reason.

## AC-25 Variance Approval

Only Owner/Admin can approve stock/cash variance adjustments.

## AC-26 Cash Handover

Staff submits handover.

Owner/Admin confirms.

Confirmation creates immutable `STAFF_CASH_HANDOVER` money ledger effect.

## AC-27 Reconciliation Close

Trip can transition COMPLETED → RECONCILED only after reconciliation is APPROVED and blocking exceptions are resolved.

## AC-28 Late Offline Event

A genuine StopEvent received after Trip reconciliation:

- is not silently folded into closed reconciliation,
- creates a reconciliation exception,
- requires explicit post-reconciliation adjustment flow.

## AC-29 Derived Stock

Vehicle/godown stock is derived from inventory ledger; no authoritative mutable stock counter is required.

## AC-30 Derived Customer / Staff Balances

Customer outstanding, customer container position and staff cash-in-hand are derived from event/ledger history.
