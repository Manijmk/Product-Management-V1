# 01 — Product Overview

## Product Definition

PMS is a configurable, multi-tenant operations platform for recurring route-delivery businesses.

The seed use case is water-can delivery. The architecture must not hardcode the seed vertical.

## Core Operational Pattern

The recurring pattern is:

```text
Tenant
  ↓
Customer / Party
  ↓
Product
  ↓
Route Template
  ↓
Trip
  ↓
TripStop
  ↓
StopEvent
  ↓
Inventory + Money Movement
  ↓
End-of-Day Reconciliation
```

## Core Entities

- Tenant
- AppUser / Role / Staff
- Product
- Party
- Route / RouteStopTemplate
- Vehicle
- Trip / TripStaff
- TripStop / TripStopProduct
- StopEvent / StopEventProduct
- InventoryLedgerEntry
- MoneyLedgerEntry
- Reconciliation entities

## Source-of-Truth Rules

`TripStop` tells us what was intended for today's run.

`StopEvent` tells us what actually happened.

`InventoryLedgerEntry` and `MoneyLedgerEntry` tell us the accounting consequences.

Derived views answer:

- current stock,
- customer container due/credit,
- customer outstanding,
- staff cash-in-hand.

These are not manually maintained balances.

## Trip Flexibility

A Trip is allowed to change after dispatch.

New stops may come from:

- Route template
- Admin-added stop
- Staff-added stop
- Customer order
- Ad-hoc new customer
- Reschedule

This must not modify the permanent Route automatically.

## Seed Shop Behavior

Some shop customers have no known delivery quantity before arrival.

For these customers:

- quantity mode = `RETURN_MATCHED`
- staff counts eligible empties first
- full quantity is derived from actual eligible empties and exchange ratio
- forecast quantity may exist for loading only
- billing and inventory use actual StopEvent quantities
