# 09 — Technology Stack Decision

## Final Decision

### Runtime
Node.js 24 LTS

### Language
TypeScript

### Framework
NestJS

### HTTP
Fastify via NestJS Fastify adapter

### Database
PostgreSQL

### Data Access
Prisma for typed application access plus parameterized PostgreSQL SQL where required.

### API
REST

### API Documentation
OpenAPI / Swagger

### Validation
NestJS DTO validation

### Logging
Structured Pino-compatible logging

### Testing
Jest with real PostgreSQL integration tests

### Local Development
Docker Compose

### Architecture
Modular Monolith

### Async Processing
Redis + BullMQ later, not during initial backend bootstrap unless required.

## Why This Stack

The system is expected to grow across:

- tenancy,
- RBAC,
- customers,
- products,
- routes,
- trips,
- offline execution,
- inventory ledger,
- money ledger,
- reconciliation,
- billing,
- payroll,
- notifications,
- reporting.

NestJS gives the backend strong module boundaries and dependency injection while TypeScript provides explicit contracts for the large number of workflow states.

Fastify reduces HTTP overhead while remaining fully supported by NestJS.

PostgreSQL is required for the current architecture because the schema relies on:

- row-level security,
- strong transactions,
- constraints,
- append-only protections,
- generated columns,
- views,
- PostgreSQL-specific operational behavior.

Prisma is intentionally not the database authority. It is the typed application data-access layer above the SQL-defined database.
