# PMS Sprint 0 Backend Bootstrap

Implemented with the repository's locked stack:

- Node.js 24 LTS
- TypeScript
- NestJS
- Fastify
- PostgreSQL
- Prisma + PostgreSQL SQL
- Jest
- Swagger/OpenAPI
- Docker Compose

## Local setup

```text
cd backend
npm install
docker compose up -d postgres
copy .env.example .env
npm run db:migrate
npm run prisma:generate
npm run dev
```

Health is available at `http://localhost:4000/api/v1/health` and Swagger UI at
`http://localhost:4000/api/docs`.

Protected endpoints require a bearer JWT signed with `AUTH_JWT_SECRET` and the
configured issuer/audience. The signed claims provide `sub` (AppUser ID) and
`tenantId`; the server revalidates the active AppUser and role assignments
under PostgreSQL RLS before executing the request. Login/OTP issuance remains
an external auth integration concern for this slice.

## Quality commands

```text
npm run typecheck
npm test
npm run build
npm audit
```

The Jest integration suite starts PostgreSQL 16 with Testcontainers, applies
exactly `001_foundation.sql` through `006_schema_fixes.sql` on a clean
database, switches to the non-owner `pms_app` role, and proves forced RLS and
derived-view isolation.

## Tenancy foundation

`AuthenticatedTenantContext` is resolved by the global authentication guard.
Both PostgreSQL and Prisma tenant transaction services set tenant scope inside
the same transaction with the parameterized PostgreSQL equivalent of
`SET LOCAL app.tenant_id`.

`database/005_runtime_security.sql` creates the NOLOGIN `pms_app` capability
role. Deployment must create a separate environment-specific non-superuser
LOGIN role and grant it membership in `pms_app`; database credentials are never
stored in migrations. Tenant transactions use `SET LOCAL ROLE pms_app` before
setting the tenant context.

`DATABASE_MIGRATION_URL` is reserved for the privileged migration connection.
NestJS and Prisma use `DATABASE_URL`, which must identify the deployment-created
non-superuser runtime login.

Sprint 0A implements protected users/roles/staff, products/prices/damage rates,
customers/PartyProduct/customer prices, and customer approval APIs. Routes,
trips, StopEvents, ledger workflows, reconciliation, invoicing, and payroll are
not implemented.

## Structure

```text
src/config           validated environment configuration
src/db               PostgreSQL pool, migration runner, transactions
src/infrastructure   Nest providers, Prisma, and structured logging
src/auth             signed-token authentication and role authorization
src/tenancy          authenticated context and tenant transaction boundaries
src/users            AppUser listing/creation and existing-role assignment
src/staff            staff master data, with optional AppUser linkage
src/products         product and append-only price/damage-rate history APIs
src/customers        party, PartyProduct, price, and approval workflows
prisma/schema.prisma typed mappings over SQL-owned tables
tests                config tests and real-PostgreSQL bootstrap/RLS tests
```

SQL under `/database` remains the schema source of truth. Prisma is generated from mappings and is never used to replace RLS, triggers, constraints, append-only guards, generated columns, or views.
