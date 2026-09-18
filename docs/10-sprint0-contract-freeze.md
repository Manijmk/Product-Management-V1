# PMS Sprint 0 API Contract Freeze

Contract version: `1.0.0`

The machine-readable contract is checked in at `docs/openapi-v1.json`.
At runtime it is available at `GET /api/openapi.json`; Swagger UI is at `GET /api/docs` when `SWAGGER_ENABLED=true`.

## Cross-cutting contract

- Base path: `/api/v1`.
- Login requires `tenantCode`, tenant-scoped `loginIdentity`, and `password`. Successful login returns a 30-minute bearer JWT.
- Protected endpoints require a bearer JWT. The server resolves tenant and user context from token identity and reloads roles from PostgreSQL; request `tenantId` fields are rejected.
- List endpoints accept `limit` (default 50, maximum 100), `offset` (default 0), `q`, and `status`.
- List responses are `{ "data": [], "meta": { "page", "pageSize", "total", "totalPages" } }`.
- Single-resource and workflow responses are `{ "data": { ... } }`.
- Errors are `{ "error": { "code", "message", "details" } }`. Codes are frozen in `backend/src/http/error-codes.ts` and published in OpenAPI as `x-pms-error-codes`.
- StopEvent retries are keyed by authenticated tenant plus `clientUuid`. A retry returns the original event with `duplicate: true` and does not repost ledger effects.
- All identifiers represented by PostgreSQL `BIGINT` are JSON strings in responses.

## Frozen endpoint inventory

| Method | Path |
|---|---|
| GET | `/api/v1/health` |
| POST | `/api/v1/auth/login` |
| GET | `/api/v1/auth/me` |
| POST | `/api/v1/auth/logout` |
| GET, POST | `/api/v1/users` |
| GET | `/api/v1/roles` |
| POST | `/api/v1/users/{userId}/roles` |
| GET, POST | `/api/v1/staff` |
| GET | `/api/v1/staff/{staffId}` |
| GET, POST | `/api/v1/products` |
| GET | `/api/v1/products/{productId}` |
| POST | `/api/v1/products/{productId}/prices` |
| POST | `/api/v1/products/{productId}/damage-rates` |
| GET, POST | `/api/v1/customers` |
| GET | `/api/v1/customers/{partyId}` |
| POST | `/api/v1/customers/{partyId}/approve` |
| POST | `/api/v1/customers/{partyId}/products` |
| POST | `/api/v1/customers/{partyId}/products/{productId}/prices` |
| GET, POST | `/api/v1/routes` |
| GET | `/api/v1/routes/{routeId}` |
| POST | `/api/v1/routes/{routeId}/stops` |
| PATCH | `/api/v1/routes/{routeId}/stops/{routeStopId}/order` |
| GET, POST | `/api/v1/vehicles` |
| GET | `/api/v1/vehicles/{vehicleId}` |
| GET, POST | `/api/v1/trips` |
| GET | `/api/v1/trips/{tripId}` |
| POST | `/api/v1/trips/{tripId}/staff` |
| POST | `/api/v1/trips/{tripId}/stops` |
| PATCH | `/api/v1/trips/{tripId}/stops/{tripStopId}/order` |
| POST | `/api/v1/trips/{tripId}/dispatch` |
| POST | `/api/v1/trips/{tripId}/start` |
| POST | `/api/v1/trip-stops/{tripStopId}/events` |
| POST | `/api/v1/trip-stops/{tripStopId}/follow-up` |
| POST | `/api/v1/trips/{tripId}/complete` |
| POST | `/api/v1/trips/{tripId}/reconciliation` |
| GET | `/api/v1/reconciliations/{reconciliationId}` |
| PUT | `/api/v1/reconciliations/{reconciliationId}/stock` |
| PUT | `/api/v1/reconciliations/{reconciliationId}/cash` |
| POST | `/api/v1/reconciliations/{reconciliationId}/submit` |
| POST | `/api/v1/reconciliations/{reconciliationId}/approve` |
| POST | `/api/v1/trips/{tripId}/reconcile` |
| POST | `/api/v1/trips/{tripId}/cash-handovers` |
| POST | `/api/v1/cash-handovers/{cashHandoverId}/confirm` |
| POST | `/api/v1/cash-handovers/{cashHandoverId}/dispute` |
| POST | `/api/v1/post-reconciliation-adjustments/{adjustmentId}/approve` |
| POST | `/api/v1/reconciliation-exceptions/{exceptionId}/resolve` |

## Explicitly not frozen

The design documents mention the following operations, but no implementation exists in Sprint 0 and they are not part of this contract:

- `POST /api/v1/trips/{tripId}/load`
- `POST /api/v1/trip-stops/{tripStopId}/skip`
- `POST /api/v1/trip-stops/{tripStopId}/fail`
- pre-reconciliation StopEvent correction/reversal APIs
- explicit container lifecycle transition APIs

No invoicing, payroll, notification, procurement, customer portal, frontend, or mobile endpoints are included.
