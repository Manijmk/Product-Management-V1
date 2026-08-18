# 03 — Domain Model

## Entity Relationships

```text
Tenant
│
├── AppUser
│   └── UserRole ── Role
│
├── Staff
│
├── Product
│   ├── ProductPrice
│   └── ProductDamageRate
│
├── Party
│   ├── PartyProduct
│   └── PartyProductPrice
│
├── Route
│   └── RouteStopTemplate
│       └── RouteStopProduct
│
├── Vehicle
│
└── Trip
    ├── TripStaff
    └── TripStop
        ├── TripStopProduct
        └── StopEvent
            └── StopEventProduct
                ├── ExchangeException
                └── PriceOverride
```

Execution produces:

```text
StopEvent
   ├── InventoryLedgerEntry
   └── MoneyLedgerEntry
```

Reconciliation:

```text
Trip
  └── TripReconciliation
      ├── TripStockReconciliation
      ├── TripCashReconciliation
      ├── ReconciliationException
      └── PostReconciliationAdjustment
```

## Stored vs Derived

### Stored

- master data
- Trip/TripStop
- actual StopEvents
- ledger movements
- physical reconciliation counts
- approvals
- follow-ups
- explicit exceptions

### Derived

- StockOnHand
- CustomerContainerBalance
- CustomerBalance
- StaffCashInHand
- expected reconciliation amounts

## Route vs Trip

Route is reusable planning data.

Trip is one execution.

Trip may:

- copy Route stops,
- add new stops,
- reorder pending stops,
- include temporary/new customers,
- exist with no Route.

## StopEvent

StopEvent is the atomic actual operational event.

Important fields include:

- tenant
- Trip
- TripStop
- Party
- client UUID
- event time
- performer
- optional GPS
- correction link

Product details belong to StopEventProduct to support multiple products per stop.

## Inventory Ledger

Each row expresses a movement/state transition.

Examples:

```text
Godown FULL → Vehicle FULL
Vehicle FULL → Customer
Customer → Vehicle EMPTY
Godown EMPTY → Cleaning CLEANING
Cleaning CLEANING → Refill REFILL
Refill REFILL → Godown FULL
```

## Money Ledger

Charges and payments are separate facts.

Example:

```text
Delivery charge      ₹400
Damage charge        ₹300
Payment              ₹500

Outstanding          ₹200
```

Do not replace this with a mutable customer balance field.
