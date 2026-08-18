# 04 — API Contract v1

This document defines the initial Sprint 0 backend API surface.

All endpoints are tenant-scoped from authenticated server context.
Clients must not control tenant isolation by passing arbitrary tenant IDs.

Suggested base path:

`/api/v1`

## Common Error Shape

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

## Authentication / Context

### POST /auth/login

Purpose: establish authenticated user and tenant context.

Implementation-specific OTP/token details may be scaffolded, but all protected endpoints must expose a resolved server-side tenant context.

---

# Products

### GET /products

Roles:

- OWNER
- ADMIN
- ROUTE_STAFF (read-only if needed)

Returns tenant products only.

### POST /products

Roles:

- OWNER
- ADMIN

Request:

```json
{
  "productCode": "CAN20",
  "name": "20L Water Can",
  "unitType": "EXCHANGE",
  "exchangeRatio": 1
}
```

### POST /products/:productId/prices

Roles:

- OWNER
- ADMIN

Request:

```json
{
  "price": 40,
  "effectiveFrom": "2026-08-18T00:00:00+05:30"
}
```

### POST /products/:productId/damage-rates

Roles:

- OWNER
- ADMIN

Request:

```json
{
  "damageType": "BROKEN",
  "rate": 350,
  "effectiveFrom": "2026-08-18T00:00:00+05:30"
}
```

---

# Customers / Parties

### GET /customers

Tenant-scoped list.

### POST /customers

Roles:

- OWNER
- ADMIN
- ROUTE_STAFF

Request:

```json
{
  "name": "ABC Shop",
  "mobile": "9000000000",
  "relationshipType": "SUBSCRIPTION_ROUTE",
  "creationMode": "PERMANENT"
}
```

Behavior:

- OWNER/ADMIN may create ACTIVE according to policy.
- staff-created permanent customer becomes PENDING_APPROVAL.
- staff-created temporary customer becomes TEMPORARY.

### POST /customers/:partyId/approve

Roles:

- OWNER
- ADMIN

### POST /customers/:partyId/products

Request:

```json
{
  "productId": 12,
  "quantityMode": "RETURN_MATCHED",
  "forecastQty": 8,
  "exchangePolicy": "STAFF_OVERRIDE"
}
```

### POST /customers/:partyId/products/:productId/prices

Creates time-versioned customer-specific price.

---

# Routes

### GET /routes

### POST /routes

Roles:

- OWNER
- ADMIN

### POST /routes/:routeId/stops

Request:

```json
{
  "partyId": 101,
  "defaultSequence": 20,
  "products": [
    {
      "partyProductId": 501,
      "quantityMode": "RETURN_MATCHED",
      "forecastQty": 8
    }
  ]
}
```

---

# Vehicles

### GET /vehicles

### POST /vehicles

Roles:

- OWNER
- ADMIN

---

# Trips

### POST /trips

Roles:

- OWNER
- ADMIN

Request:

```json
{
  "routeId": 15,
  "tripDate": "2026-08-18",
  "vehicleId": 8,
  "primaryStaffId": 44
}
```

Behavior:

- if routeId exists, active RouteStopTemplates are copied into TripStops
- routeId may be null for a fully ad-hoc Trip

### GET /trips/:tripId

Returns:

- Trip
- assigned staff
- ordered stops
- stop products
- current statuses

### POST /trips/:tripId/staff

Adds driver/helper/reliever.

### POST /trips/:tripId/stops

Roles:

- OWNER
- ADMIN
- permitted ROUTE_STAFF

Allowed Trip states:

- PLANNED
- LOADED
- DISPATCHED
- IN_PROGRESS

Request:

```json
{
  "partyId": 205,
  "source": "STAFF_ADDED",
  "sortableOrder": 25,
  "products": [
    {
      "productId": 12,
      "quantityMode": "AD_HOC",
      "plannedQty": 3
    }
  ]
}
```

### PATCH /trips/:tripId/stops/:tripStopId/order

Reorders pending/unexecuted stop.

Request:

```json
{
  "sortableOrder": 25
}
```

### POST /trips/:tripId/load

Records vehicle loading by posting inventory ledger entries.

Request:

```json
{
  "lines": [
    {
      "productId": 12,
      "state": "FULL",
      "quantity": 100,
      "fromLocationId": 1,
      "toLocationId": 9
    }
  ]
}
```

Effect:

- inventory ledger only
- no mutable vehicle stock field

### POST /trips/:tripId/dispatch

Transitions LOADED → DISPATCHED.

### POST /trips/:tripId/start

Transitions DISPATCHED → IN_PROGRESS.

---

# Stop Execution

### POST /trip-stops/:tripStopId/events

This is a critical transactional endpoint.

Request example for RETURN_MATCHED:

```json
{
  "clientUuid": "550e8400-e29b-41d4-a716-446655440000",
  "eventTime": "2026-08-18T10:35:00+05:30",
  "products": [
    {
      "tripStopProductId": 7001,
      "productId": 12,
      "quantityMode": "RETURN_MATCHED",
      "goodEmptyQty": 8,
      "damagedEmptyQty": 1,
      "rejectedEmptyQty": 0,
      "fullQtyDelivered": 8,
      "damageResolution": "CHARGE_DAMAGE"
    }
  ],
  "payments": [
    {
      "amount": 304,
      "paymentMethod": "CASH"
    }
  ]
}
```

Server responsibilities in ONE transaction:

1. Validate tenant/Trip/TripStop.
2. Validate Trip state.
3. Enforce `(tenant_id, client_uuid)` idempotency.
4. Resolve/snapshot applicable price.
5. Validate exchange behavior.
6. Create StopEvent.
7. Create StopEventProduct rows.
8. Create ExchangeException and/or PriceOverride records when needed.
9. Post inventory ledger movements.
10. Post money charges/payments.
11. Update TripStop execution status.
12. Return committed result.

Duplicate client UUID:

- return original accepted result
- do not repost ledger rows

### POST /trip-stops/:tripStopId/skip

Request:

```json
{
  "reasonCode": "CUSTOMER_REQUEST"
}
```

### POST /trip-stops/:tripStopId/fail

Request:

```json
{
  "reasonCode": "NOT_AVAILABLE",
  "notes": "Shop closed"
}
```

### POST /trip-stops/:tripStopId/follow-up

Used for partial delivery.

Request:

```json
{
  "productId": 12,
  "remainingQty": 4,
  "resolutionType": "FOLLOW_UP"
}
```

or create linked TripStop.

---

# Trip Completion

### POST /trips/:tripId/complete

Preconditions:

- all TripStops are terminal or explicitly handled
- no unclassified PENDING stop remains unless policy allows it

Transitions:

`IN_PROGRESS -> COMPLETED`

---

# Reconciliation

### POST /trips/:tripId/reconciliation

Creates OPEN reconciliation and computes ledger-derived expectations.

### PUT /reconciliations/:reconciliationId/stock

Staff/user submits physical stock count.

### PUT /reconciliations/:reconciliationId/cash

Staff/user submits actual cash.

### POST /reconciliations/:reconciliationId/submit

### POST /reconciliations/:reconciliationId/approve

Roles:

- OWNER
- ADMIN

Preconditions:

- required variances reviewed
- unresolved critical reconciliation exceptions = 0

### POST /trips/:tripId/reconcile

Transitions COMPLETED → RECONCILED only after approved reconciliation.

---

# Cash Handover

### POST /trips/:tripId/cash-handovers

Delivery staff submits amount.

### POST /cash-handovers/:cashHandoverId/confirm

Roles:

- OWNER
- ADMIN

On confirmation:

- create immutable `STAFF_CASH_HANDOVER` MoneyLedgerEntry
- link cash_handover to that ledger row

### POST /cash-handovers/:cashHandoverId/dispute

Roles:

- OWNER
- ADMIN

---

# Corrections / Late Events

A genuine event received after reconciliation must not silently alter closed EOD.

Expected server flow:

1. create reconciliation exception,
2. create/review post-reconciliation adjustment,
3. append correction/reversal ledger entries,
4. resolve exception.

Exact correction endpoint shapes may be implemented after the first end-to-end slice, but no implementation may bypass this rule.
