import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { JwtService } from "@nestjs/jwt";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance, InjectOptions } from "fastify";
import path from "node:path";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import { applyMigrations } from "../../src/db/migrations.js";
import { createPool } from "../../src/db/pool.js";
import { withSystemTransaction, withTenantTransaction } from "../../src/db/transaction.js";
import { unwrapApiSuccess } from "../helpers/unwrap-api-success.js";

const { Pool } = pg;
const migrationDirectory = path.resolve(process.cwd(), "../database");
const runtimeRole = "pms_app";

let container: StartedPostgreSqlContainer;
let seedPool: pg.Pool;
let appPool: pg.Pool;
let app: NestFastifyApplication;
let server: FastifyInstance;
let tenantA: number;
let tenantB: number;
let ownerId: number;
let routeUserId: number;
let staffId: number;
let ownerToken: string;
let staffToken: string;
let tripId: number;
let handoverTripId: number;
let tripStopId: number;
let tripStopProductId: number;
let partyId: number;
let productId: number;
let vehicleLocationId: number;
let fullStateId: number;
let reconciliationId: string;
let tenantBReconciliationId: number;

const configFor = (databaseUrl: string): AppConfig => ({
  NODE_ENV: "test",
  APP_NAME: "pms-reconciliation-test",
  APP_PORT: 4000,
  DATABASE_URL: databaseUrl,
  DATABASE_POOL_MIN: 0,
  DATABASE_POOL_MAX: 10,
  DATABASE_RUNTIME_ROLE: runtimeRole,
  AUTH_JWT_SECRET: "test-secret-that-is-at-least-32-characters",
  AUTH_JWT_ISSUER: "pms-backend",
  AUTH_JWT_AUDIENCE: "pms-api",
  LOG_LEVEL: "silent",
  SWAGGER_ENABLED: false
});

async function inject(token: string, options: InjectOptions) {
  return unwrapApiSuccess(await server.inject({ ...options, headers: { ...(options.headers ?? {}), authorization: `Bearer ${token}` } }));
}

function errorCode(response: { json(): unknown }): string | undefined {
  return (response.json() as { error?: { code?: string } }).error?.code;
}

async function seedIdentity(tenantId: number, prefix: string, roleCode: string): Promise<number> {
  return withTenantTransaction(seedPool, { tenantId, userId: 1, roles: ["SEED"] }, async (client) => {
    for (const role of ["OWNER", "ADMIN", "ROUTE_STAFF"]) {
      await client.query(
        `INSERT INTO role (tenant_id, role_code, role_name)
         VALUES ($1, $2, $3) ON CONFLICT (tenant_id, role_code) DO NOTHING`,
        [tenantId, role, role]
      );
    }
    const userId = (await client.query<{ user_id: number }>(
      `INSERT INTO app_user (tenant_id, login_identity, display_name)
       VALUES ($1, $2, $3) RETURNING user_id`,
      [tenantId, `${prefix}-login`, `${prefix} User`]
    )).rows[0]!.user_id;
    await client.query(
      `INSERT INTO user_role (tenant_id, user_id, role_id)
       SELECT $1, $2, role_id FROM role WHERE tenant_id = $1 AND role_code = $3`,
      [tenantId, userId, roleCode]
    );
    return userId;
  }, { runtimeRole });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  seedPool = new Pool({ connectionString: container.getConnectionUri(), max: 10 });
  await applyMigrations(seedPool, migrationDirectory);
  [tenantA, tenantB] = await withSystemTransaction(seedPool, async (client) => {
    const rows = await client.query<{ tenant_id: number }>(
      `INSERT INTO pms.tenant (tenant_code, name, business_type)
       VALUES ('RECON_A', 'Reconciliation A', 'ROUTE_DELIVERY'), ('RECON_B', 'Reconciliation B', 'ROUTE_DELIVERY')
       RETURNING tenant_id`
    );
    return [rows.rows[0]!.tenant_id, rows.rows[1]!.tenant_id];
  });
  ownerId = await seedIdentity(tenantA, "recon-owner", "OWNER");
  routeUserId = await seedIdentity(tenantA, "recon-staff", "ROUTE_STAFF");
  const tenantBOwnerId = await seedIdentity(tenantB, "recon-b-owner", "OWNER");

  await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] }, async (client) => {
    staffId = (await client.query<{ staff_id: number }>(
      `INSERT INTO staff (tenant_id, user_id, name, staff_type, created_by_user_id)
       VALUES ($1, $2, 'Reconciliation Staff', 'DELIVERY_STAFF', $3) RETURNING staff_id`,
      [tenantA, routeUserId, ownerId]
    )).rows[0]!.staff_id;
    partyId = (await client.query<{ party_id: number }>(
      `INSERT INTO party
         (tenant_id, name, relationship_type, customer_status, created_source, created_by_user_id, approved_by_user_id, approved_at)
       VALUES ($1, 'Reconciliation Customer', 'SUBSCRIPTION_ROUTE', 'ACTIVE', 'ADMIN', $2, $2, NOW())
       RETURNING party_id`,
      [tenantA, ownerId]
    )).rows[0]!.party_id;
    productId = (await client.query<{ product_id: number }>(
      `INSERT INTO product (tenant_id, product_code, name, unit_type, exchange_ratio, created_by_user_id)
       VALUES ($1, 'RECON_EX', 'Recon Exchange', 'EXCHANGE', 1, $2) RETURNING product_id`,
      [tenantA, ownerId]
    )).rows[0]!.product_id;
    await client.query(
      `INSERT INTO product_price (tenant_id, product_id, price, effective_from, created_by_user_id)
       VALUES ($1, $2, 40, '2026-01-01T00:00:00Z', $3)`,
      [tenantA, productId, ownerId]
    );
    const vehicleId = (await client.query<{ vehicle_id: number }>(
      `INSERT INTO vehicle (tenant_id, registration_no, vehicle_type, created_by_user_id)
       VALUES ($1, 'RECON-VEHICLE', 'VAN', $2) RETURNING vehicle_id`,
      [tenantA, ownerId]
    )).rows[0]!.vehicle_id;
    const locations = await client.query<{ inventory_location_id: number }>(
      `INSERT INTO inventory_location
         (tenant_id, location_code, name, location_type, vehicle_id, created_by_user_id)
       VALUES ($1, 'RECON-GODOWN', 'Recon Godown', 'GODOWN', NULL, $3),
              ($1, 'RECON-VEHICLE', 'Recon Vehicle', 'VEHICLE', $2, $3)
       RETURNING inventory_location_id`,
      [tenantA, vehicleId, ownerId]
    );
    const godownLocationId = locations.rows[0]!.inventory_location_id;
    vehicleLocationId = locations.rows[1]!.inventory_location_id;
    fullStateId = (await client.query<{ inventory_state_id: number }>(
      "SELECT inventory_state_id FROM inventory_state WHERE code = 'FULL'"
    )).rows[0]!.inventory_state_id;
    tripId = (await client.query<{ trip_id: number }>(
      `INSERT INTO trip
         (tenant_id, trip_number, trip_date, vehicle_id, primary_staff_id, status, actual_start_at, created_by_user_id)
       VALUES ($1, 'RECON-TRIP', '2026-09-01', $2, $3, 'IN_PROGRESS', NOW(), $4)
       RETURNING trip_id`,
      [tenantA, vehicleId, staffId, ownerId]
    )).rows[0]!.trip_id;
    await client.query(
      `INSERT INTO trip_staff
         (tenant_id, trip_id, staff_id, trip_role, joined_at, is_primary, assigned_by_user_id)
       VALUES ($1, $2, $3, 'DELIVERY_STAFF', NOW(), TRUE, $4)`,
      [tenantA, tripId, staffId, ownerId]
    );
    tripStopId = (await client.query<{ trip_stop_id: number }>(
      `INSERT INTO trip_stop
         (tenant_id, trip_id, party_id, source, sortable_order, status, added_by_user_id)
       VALUES ($1, $2, $3, 'ADMIN_ADDED', 10, 'PENDING', $4) RETURNING trip_stop_id`,
      [tenantA, tripId, partyId, ownerId]
    )).rows[0]!.trip_stop_id;
    tripStopProductId = (await client.query<{ trip_stop_product_id: number }>(
      `INSERT INTO trip_stop_product
         (tenant_id, trip_stop_id, product_id, quantity_mode, status)
       VALUES ($1, $2, $3, 'RETURN_MATCHED', 'COMPLETED') RETURNING trip_stop_product_id`,
      [tenantA, tripStopId, productId]
    )).rows[0]!.trip_stop_product_id;
    await client.query(
      `INSERT INTO inventory_ledger_entry
         (tenant_id, product_id, from_location_id, to_location_id, from_state_id, to_state_id,
          quantity, event_type, trip_id, occurred_at, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $5, 10, 'TRIP_LOAD', $6, NOW(), $7)`,
      [tenantA, productId, godownLocationId, vehicleLocationId, fullStateId, tripId, ownerId]
    );
    await client.query(
      `INSERT INTO money_ledger_entry
         (tenant_id, party_id, staff_id, amount, direction, transaction_type, payment_method,
          account_type, trip_id, occurred_at, created_by_user_id)
       VALUES ($1, $2, $3, 100, 'IN', 'CUSTOMER_PAYMENT', 'CASH', 'STAFF_CASH', $4, NOW(), $5)`,
      [tenantA, partyId, staffId, tripId, ownerId]
    );

    handoverTripId = (await client.query<{ trip_id: number }>(
      `INSERT INTO trip
         (tenant_id, trip_number, trip_date, primary_staff_id, status, actual_start_at, completed_at, created_by_user_id)
       VALUES ($1, 'HANDOVER-TRIP', '2026-09-01', $2, 'COMPLETED', NOW(), NOW(), $3)
       RETURNING trip_id`,
      [tenantA, staffId, ownerId]
    )).rows[0]!.trip_id;
    await client.query(
      `INSERT INTO trip_staff
         (tenant_id, trip_id, staff_id, trip_role, joined_at, is_primary, assigned_by_user_id)
       VALUES ($1, $2, $3, 'DELIVERY_STAFF', NOW(), TRUE, $4)`,
      [tenantA, handoverTripId, staffId, ownerId]
    );
    await client.query(
      `INSERT INTO money_ledger_entry
         (tenant_id, party_id, staff_id, amount, direction, transaction_type, payment_method,
          account_type, trip_id, occurred_at, created_by_user_id)
       VALUES ($1, $2, $3, 100, 'IN', 'CUSTOMER_PAYMENT', 'CASH', 'STAFF_CASH', $4, NOW(), $5)`,
      [tenantA, partyId, staffId, handoverTripId, ownerId]
    );
  }, { runtimeRole });

  await withTenantTransaction(seedPool, { tenantId: tenantB, userId: tenantBOwnerId, roles: ["OWNER"] }, async (client) => {
    const trip = (await client.query<{ trip_id: number }>(
      `INSERT INTO trip
         (tenant_id, trip_number, trip_date, status, completed_at, created_by_user_id)
       VALUES ($1, 'B-RECON-TRIP', '2026-09-01', 'COMPLETED', NOW(), $2) RETURNING trip_id`,
      [tenantB, tenantBOwnerId]
    )).rows[0]!.trip_id;
    tenantBReconciliationId = (await client.query<{ reconciliation_id: number }>(
      `INSERT INTO trip_reconciliation (tenant_id, trip_id, reconciliation_number)
       VALUES ($1, $2, 'B-RECON') RETURNING reconciliation_id`,
      [tenantB, trip]
    )).rows[0]!.reconciliation_id;
  }, { runtimeRole });

  const config = configFor(container.getConnectionUri());
  appPool = createPool(config);
  app = await buildApp(config, appPool);
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
  await server.ready();
  const jwt = app.get(JwtService);
  ownerToken = await jwt.signAsync({ sub: String(ownerId), tenantId: tenantA });
  staffToken = await jwt.signAsync({ sub: String(routeUserId), tenantId: tenantA });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await seedPool?.end();
  await container?.stop();
});

describe("Sprint 0D completion and reconciliation", () => {
  it("blocks completion until every stop is explicitly handled", async () => {
    const blocked = await inject(staffToken, { method: "POST", url: `/api/v1/trips/${tripId}/complete` });
    expect(blocked.statusCode).toBe(409);
    expect(errorCode(blocked)).toBe("UNRESOLVED_TRIP_STOPS");

    await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] },
      (client) => client.query(
        "UPDATE trip_stop SET status = 'SKIPPED', reason_code = 'CUSTOMER_REQUEST' WHERE trip_stop_id = $1",
        [tripStopId]
      ), { runtimeRole });
    const completed = await inject(staffToken, { method: "POST", url: `/api/v1/trips/${tripId}/complete` });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ status: "COMPLETED" });
  });

  it("creates an OPEN reconciliation with ledger-derived expectations", async () => {
    const response = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trips/${tripId}/reconciliation`,
      payload: { notes: "End of trip" }
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      reconciliationId: string;
      status: string;
      expectedStock: { expectedQty: string }[];
      expectedCash: { expectedCash: string }[];
    };
    reconciliationId = body.reconciliationId;
    expect(body.status).toBe("OPEN");
    expect(body.expectedStock).toEqual(expect.arrayContaining([expect.objectContaining({ expectedQty: "10" })]));
    expect(body.expectedCash).toEqual(expect.arrayContaining([expect.objectContaining({ expectedCash: "100" })]));
  });

  it("requires variance reasons and records pending stock/cash variances", async () => {
    const missingStockReason = await inject(staffToken, {
      method: "PUT",
      url: `/api/v1/reconciliations/${reconciliationId}/stock`,
      payload: { inventoryLocationId: vehicleLocationId, productId, inventoryStateId: fullStateId, actualQty: 9 }
    });
    expect(errorCode(missingStockReason)).toBe("STOCK_VARIANCE_REASON_REQUIRED");
    const stock = await inject(staffToken, {
      method: "PUT",
      url: `/api/v1/reconciliations/${reconciliationId}/stock`,
      payload: {
        inventoryLocationId: vehicleLocationId,
        productId,
        inventoryStateId: fullStateId,
        actualQty: 9,
        varianceReasonCode: "COUNT_SHORT"
      }
    });
    expect(stock.statusCode).toBe(200);
    expect(stock.json()).toMatchObject({ expectedQty: "10", actualQty: "9", varianceQty: "-1", approvalStatus: "PENDING" });

    const missingCashReason = await inject(staffToken, {
      method: "PUT",
      url: `/api/v1/reconciliations/${reconciliationId}/cash`,
      payload: { staffId, actualCash: 90 }
    });
    expect(errorCode(missingCashReason)).toBe("CASH_VARIANCE_REASON_REQUIRED");
    const cash = await inject(staffToken, {
      method: "PUT",
      url: `/api/v1/reconciliations/${reconciliationId}/cash`,
      payload: { staffId, actualCash: 90, varianceReasonCode: "CASH_SHORT" }
    });
    expect(cash.statusCode).toBe(200);
    expect(cash.json()).toMatchObject({ expectedCash: "100", actualCash: "90", varianceAmount: "-10", approvalStatus: "PENDING" });
  });

  it("submits reconciliation and restricts approval to Owner/Admin", async () => {
    const submitted = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/reconciliations/${reconciliationId}/submit`
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({ status: "SUBMITTED" });
    expect((submitted.json() as { exceptions: unknown[] }).exceptions).toHaveLength(2);

    const staffApproval = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/reconciliations/${reconciliationId}/approve`
    });
    expect(staffApproval.statusCode).toBe(403);

    const approved = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/reconciliations/${reconciliationId}/approve`
    });
    expect(approved.statusCode).toBe(200);
    const body = approved.json() as {
      status: string;
      stock: { approvalStatus: string; adjustmentInventoryLedgerId: string | null }[];
      cash: { approvalStatus: string; adjustmentMoneyLedgerId: string | null }[];
      exceptions: { status: string }[];
    };
    expect(body.status).toBe("APPROVED");
    expect(body.stock[0]).toMatchObject({ approvalStatus: "APPROVED" });
    expect(body.stock[0]!.adjustmentInventoryLedgerId).not.toBeNull();
    expect(body.cash[0]!.adjustmentMoneyLedgerId).not.toBeNull();
    expect(body.exceptions.every((exception) => exception.status === "RESOLVED")).toBe(true);
  });

  it("blocks trip reconciliation for an open exception, then closes after resolution", async () => {
    const exceptionId = await withTenantTransaction(
      seedPool,
      { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] },
      async (client) => (await client.query<{ reconciliation_exception_id: number }>(
        `INSERT INTO reconciliation_exception
           (tenant_id, reconciliation_id, exception_type, severity, trip_id, detected_source, description)
         VALUES ($1, $2, 'OTHER', 'CRITICAL', $3, 'ADMIN', 'Manual close blocker')
         RETURNING reconciliation_exception_id`,
        [tenantA, Number(reconciliationId), tripId]
      )).rows[0]!.reconciliation_exception_id,
      { runtimeRole }
    );
    const blocked = await inject(ownerToken, { method: "POST", url: `/api/v1/trips/${tripId}/reconcile` });
    expect(errorCode(blocked)).toBe("OPEN_RECONCILIATION_EXCEPTION");
    expect((await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/reconciliation-exceptions/${exceptionId}/resolve`,
      payload: { resolutionNotes: "Reviewed and cleared" }
    })).statusCode).toBe(200);
    const closed = await inject(ownerToken, { method: "POST", url: `/api/v1/trips/${tripId}/reconcile` });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ status: "RECONCILED" });
  });

  it("submits, disputes, and confirms a cash handover with one immutable ledger effect", async () => {
    const submitted = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trips/${handoverTripId}/cash-handovers`,
      payload: { toUserId: ownerId, amount: 60 }
    });
    expect(submitted.statusCode).toBe(201);
    const handoverId = (submitted.json() as { cashHandoverId: string }).cashHandoverId;
    const disputed = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/cash-handovers/${handoverId}/dispute`,
      payload: { reason: "Count needs review" }
    });
    expect(disputed.json()).toMatchObject({ status: "DISPUTED" });
    const confirmed = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/cash-handovers/${handoverId}/confirm`
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ status: "CONFIRMED" });
    expect((confirmed.json() as { moneyLedgerId: string | null }).moneyLedgerId).not.toBeNull();
    const ledgerCount = await withTenantTransaction(
      seedPool,
      { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] },
      async (client) => Number((await client.query(
        "SELECT COUNT(*) FROM money_ledger_entry WHERE reference_type = 'CASH_HANDOVER' AND reference_id = $1",
        [handoverId]
      )).rows[0].count),
      { runtimeRole }
    );
    expect(ledgerCount).toBe(1);
  });

  it("quarantines an idempotent late event and posts effects only after adjustment approval", async () => {
    const payload = {
      clientUuid: randomUUID(),
      eventTime: "2026-09-01T12:00:00+05:30",
      products: [{ tripStopProductId, productId, goodEmptyQty: 1, fullQtyDelivered: 1 }]
    };
    const late = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${tripStopId}/events`,
      payload
    });
    expect(late.statusCode).toBe(201);
    const body = late.json() as {
      stopEventId: string;
      inventoryLedgerEntries: unknown[];
      moneyLedgerEntries: unknown[];
      reconciliationReview: {
        reconciliationExceptionId: string;
        adjustmentId: string;
        adjustmentStatus: string;
      };
    };
    expect(body.inventoryLedgerEntries).toHaveLength(0);
    expect(body.moneyLedgerEntries).toHaveLength(0);
    expect(body.reconciliationReview).toMatchObject({ adjustmentStatus: "PENDING" });

    const retry = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${tripStopId}/events`,
      payload
    });
    expect(retry.json()).toMatchObject({ duplicate: true, stopEventId: body.stopEventId });

    const staffApproval = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/post-reconciliation-adjustments/${body.reconciliationReview.adjustmentId}/approve`
    });
    expect(staffApproval.statusCode).toBe(403);
    const approved = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/post-reconciliation-adjustments/${body.reconciliationReview.adjustmentId}/approve`
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ approvalStatus: "APPROVED", stopEventId: body.stopEventId });

    const result = await withTenantTransaction(
      seedPool,
      { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] },
      async (client) => ({
        inventory: Number((await client.query(
          "SELECT COUNT(*) FROM inventory_ledger_entry WHERE stop_event_id = $1",
          [body.stopEventId]
        )).rows[0].count),
        money: Number((await client.query(
          "SELECT COUNT(*) FROM money_ledger_entry WHERE stop_event_id = $1",
          [body.stopEventId]
        )).rows[0].count),
        exceptionStatus: (await client.query(
          "SELECT status FROM reconciliation_exception WHERE reconciliation_exception_id = $1",
          [body.reconciliationReview.reconciliationExceptionId]
        )).rows[0].status
      }),
      { runtimeRole }
    );
    expect(result).toEqual({ inventory: 2, money: 1, exceptionStatus: "RESOLVED" });
  });

  it("isolates reconciliation aggregates by authenticated tenant", async () => {
    const response = await inject(ownerToken, {
      method: "GET",
      url: `/api/v1/reconciliations/${tenantBReconciliationId}`
    });
    expect(response.statusCode).toBe(404);
    expect(errorCode(response)).toBe("RECONCILIATION_NOT_FOUND");
  });
});
