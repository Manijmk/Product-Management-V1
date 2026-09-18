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
let routeStaffId: number;
let ownerToken: string;
let staffToken: string;
let partyId: number;
let productId: number;
let tripId: number;
let vehicleLocationId: number;
let tenantBStopId: number;
const stops: Record<string, { stopId: number; productId: number }> = {};

const configFor = (databaseUrl: string): AppConfig => ({
  NODE_ENV: "test",
  APP_NAME: "pms-stop-execution-test",
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
  return unwrapApiSuccess(await server.inject({
    ...options,
    headers: { ...(options.headers ?? {}), authorization: `Bearer ${token}` }
  }));
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
    const result = await client.query<{ tenant_id: number }>(
      `INSERT INTO pms.tenant (tenant_code, name, business_type)
       VALUES ('EXEC_A', 'Execution A', 'ROUTE_DELIVERY'), ('EXEC_B', 'Execution B', 'ROUTE_DELIVERY')
       RETURNING tenant_id`
    );
    return [result.rows[0]!.tenant_id, result.rows[1]!.tenant_id];
  });
  ownerId = await seedIdentity(tenantA, "exec-owner", "OWNER");
  routeUserId = await seedIdentity(tenantA, "exec-staff", "ROUTE_STAFF");
  const tenantBOwnerId = await seedIdentity(tenantB, "exec-b-owner", "OWNER");

  await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] }, async (client) => {
    routeStaffId = (await client.query<{ staff_id: number }>(
      `INSERT INTO staff (tenant_id, user_id, name, staff_type, created_by_user_id)
       VALUES ($1, $2, 'Route Staff', 'DELIVERY_STAFF', $3) RETURNING staff_id`,
      [tenantA, routeUserId, ownerId]
    )).rows[0]!.staff_id;
    productId = (await client.query<{ product_id: number }>(
      `INSERT INTO product (tenant_id, product_code, name, unit_type, exchange_ratio, created_by_user_id)
       VALUES ($1, 'EXEC_EX', 'Exchange Container', 'EXCHANGE', 1, $2) RETURNING product_id`,
      [tenantA, ownerId]
    )).rows[0]!.product_id;
    partyId = (await client.query<{ party_id: number }>(
      `INSERT INTO party
         (tenant_id, name, relationship_type, customer_status, created_source,
          created_by_user_id, approved_by_user_id, approved_at)
       VALUES ($1, 'Execution Customer', 'SUBSCRIPTION_ROUTE', 'ACTIVE', 'ADMIN', $2, $2, NOW())
       RETURNING party_id`,
      [tenantA, ownerId]
    )).rows[0]!.party_id;
    await client.query(
      `INSERT INTO party_product
         (tenant_id, party_id, product_id, quantity_mode, forecast_qty, created_by_user_id)
       VALUES ($1, $2, $3, 'RETURN_MATCHED', 8, $4)`,
      [tenantA, partyId, productId, ownerId]
    );
    await client.query(
      `INSERT INTO product_price
         (tenant_id, product_id, price, effective_from, created_by_user_id)
       VALUES ($1, $2, 40, '2026-01-01T00:00:00Z', $3)`,
      [tenantA, productId, ownerId]
    );
    await client.query(
      `INSERT INTO party_product_price
         (tenant_id, party_id, product_id, price, effective_from, approval_status,
          created_by_user_id, approved_by_user_id, approved_at)
       VALUES ($1, $2, $3, 38, '2026-01-01T00:00:00Z', 'APPROVED', $4, $4, NOW())`,
      [tenantA, partyId, productId, ownerId]
    );
    await client.query(
      `INSERT INTO product_damage_rate
         (tenant_id, product_id, damage_type, rate, effective_from, created_by_user_id)
       VALUES ($1, $2, 'DAMAGED', 300, '2026-01-01T00:00:00Z', $3)`,
      [tenantA, productId, ownerId]
    );
    const vehicleId = (await client.query<{ vehicle_id: number }>(
      `INSERT INTO vehicle (tenant_id, registration_no, vehicle_type, created_by_user_id)
       VALUES ($1, 'EXEC-VEHICLE', 'VAN', $2) RETURNING vehicle_id`,
      [tenantA, ownerId]
    )).rows[0]!.vehicle_id;
    const locations = await client.query<{ inventory_location_id: number }>(
      `INSERT INTO inventory_location
         (tenant_id, location_code, name, location_type, vehicle_id, created_by_user_id)
       VALUES ($1, 'EXEC-GODOWN', 'Main Godown', 'GODOWN', NULL, $3),
              ($1, 'EXEC-VEHICLE', 'Execution Vehicle', 'VEHICLE', $2, $3)
       RETURNING inventory_location_id`,
      [tenantA, vehicleId, ownerId]
    );
    const godownLocationId = locations.rows[0]!.inventory_location_id;
    vehicleLocationId = locations.rows[1]!.inventory_location_id;
    tripId = (await client.query<{ trip_id: number }>(
      `INSERT INTO trip
         (tenant_id, trip_number, trip_date, vehicle_id, primary_staff_id, status, actual_start_at, created_by_user_id)
       VALUES ($1, 'EXEC-TRIP', '2026-09-01', $2, $3, 'IN_PROGRESS', NOW(), $4)
       RETURNING trip_id`,
      [tenantA, vehicleId, routeStaffId, ownerId]
    )).rows[0]!.trip_id;

    const seedStop = async (key: string, quantityMode: string, plannedQty: number | null, order: number) => {
      const stopId = (await client.query<{ trip_stop_id: number }>(
        `INSERT INTO trip_stop
           (tenant_id, trip_id, party_id, source, sortable_order, added_by_user_id)
         VALUES ($1, $2, $3, 'ADMIN_ADDED', $4, $5) RETURNING trip_stop_id`,
        [tenantA, tripId, partyId, order, ownerId]
      )).rows[0]!.trip_stop_id;
      const stopProductId = (await client.query<{ trip_stop_product_id: number }>(
        `INSERT INTO trip_stop_product
           (tenant_id, trip_stop_id, product_id, quantity_mode, planned_qty, forecast_qty)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING trip_stop_product_id`,
        [tenantA, stopId, productId, quantityMode, plannedQty, quantityMode === "RETURN_MATCHED" ? 8 : null]
      )).rows[0]!.trip_stop_product_id;
      stops[key] = { stopId, productId: stopProductId };
    };
    await seedStop("fixed", "FIXED_PLANNED", 2, 10);
    await seedStop("matched", "RETURN_MATCHED", null, 20);
    await seedStop("credit", "RETURN_MATCHED", null, 30);
    await seedStop("replacement", "RETURN_MATCHED", null, 40);
    await seedStop("due", "RETURN_MATCHED", null, 50);
    await seedStop("dueInvalid", "RETURN_MATCHED", null, 55);
    await seedStop("damageCharge", "RETURN_MATCHED", null, 60);
    await seedStop("damageNoCharge", "RETURN_MATCHED", null, 70);
    await seedStop("damageReject", "RETURN_MATCHED", null, 80);
    await seedStop("override", "RETURN_MATCHED", null, 90);
    await seedStop("overrideAdmin", "RETURN_MATCHED", null, 92);
    await seedStop("oldPayment", "RETURN_MATCHED", null, 94);
    await seedStop("advancePayment", "RETURN_MATCHED", null, 96);
    await seedStop("shortage", "RETURN_MATCHED", null, 98);
    await seedStop("partial", "FIXED_PLANNED", 10, 100);

    const fullStateId = (await client.query<{ inventory_state_id: number }>(
      "SELECT inventory_state_id FROM inventory_state WHERE code = 'FULL'"
    )).rows[0]!.inventory_state_id;
    await client.query(
      `INSERT INTO inventory_ledger_entry
         (tenant_id, product_id, from_location_id, to_location_id, from_state_id, to_state_id,
          quantity, event_type, trip_id, occurred_at, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $5, 200, 'TRIP_LOAD', $6, NOW(), $7)`,
      [tenantA, productId, godownLocationId, vehicleLocationId, fullStateId, tripId, ownerId]
    );
  }, { runtimeRole });

  await withTenantTransaction(seedPool, { tenantId: tenantB, userId: tenantBOwnerId, roles: ["OWNER"] }, async (client) => {
    const party = (await client.query<{ party_id: number }>(
      `INSERT INTO party
         (tenant_id, name, relationship_type, customer_status, created_source, created_by_user_id, approved_by_user_id, approved_at)
       VALUES ($1, 'Tenant B Customer', 'AD_HOC', 'ACTIVE', 'ADMIN', $2, $2, NOW()) RETURNING party_id`,
      [tenantB, tenantBOwnerId]
    )).rows[0]!.party_id;
    const product = (await client.query<{ product_id: number }>(
      `INSERT INTO product (tenant_id, product_code, name, unit_type, exchange_ratio, created_by_user_id)
       VALUES ($1, 'B-EX', 'B Product', 'EXCHANGE', 1, $2) RETURNING product_id`,
      [tenantB, tenantBOwnerId]
    )).rows[0]!.product_id;
    const trip = (await client.query<{ trip_id: number }>(
      `INSERT INTO trip (tenant_id, trip_number, trip_date, status, actual_start_at, created_by_user_id)
       VALUES ($1, 'B-EXEC', '2026-09-01', 'IN_PROGRESS', NOW(), $2) RETURNING trip_id`,
      [tenantB, tenantBOwnerId]
    )).rows[0]!.trip_id;
    tenantBStopId = (await client.query<{ trip_stop_id: number }>(
      `INSERT INTO trip_stop (tenant_id, trip_id, party_id, source, sortable_order, added_by_user_id)
       VALUES ($1, $2, $3, 'ADMIN_ADDED', 10, $4) RETURNING trip_stop_id`,
      [tenantB, trip, party, tenantBOwnerId]
    )).rows[0]!.trip_stop_id;
    await client.query(
      `INSERT INTO trip_stop_product (tenant_id, trip_stop_id, product_id, quantity_mode)
       VALUES ($1, $2, $3, 'RETURN_MATCHED')`,
      [tenantB, tenantBStopId, product]
    );
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

function eventPayload(key: string, values: Record<string, unknown>) {
  return {
    clientUuid: randomUUID(),
    eventTime: "2026-09-01T10:35:00+05:30",
    products: [{
      tripStopProductId: stops[key]!.productId,
      productId,
      ...values
    }]
  };
}

describe("Sprint 0C stop execution", () => {
  it("posts fixed delivery, payment allocation, and returns an idempotent retry", async () => {
    const payload = {
      ...eventPayload("fixed", { quantityMode: "FIXED_PLANNED", goodEmptyQty: 2, fullQtyDelivered: 2 }),
      payments: [{ amount: 76, paymentMethod: "CASH" }]
    };
    const first = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${stops.fixed!.stopId}/events`,
      payload
    });
    expect(first.statusCode).toBe(201);
    const accepted = first.json() as {
      duplicate: boolean;
      stopEventId: string;
      products: { priceApplied: string; priceSource: string }[];
      inventoryLedgerEntries: unknown[];
      moneyLedgerEntries: unknown[];
    };
    expect(accepted).toMatchObject({ duplicate: false });
    expect(accepted.products[0]).toMatchObject({ priceApplied: "38", priceSource: "CUSTOMER_PRICE" });
    expect(accepted.inventoryLedgerEntries).toHaveLength(2);
    expect(accepted.moneyLedgerEntries).toHaveLength(2);

    const retry = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${stops.fixed!.stopId}/events`,
      payload
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toMatchObject({ duplicate: true, stopEventId: accepted.stopEventId });

    const counts = await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] }, async (client) => ({
      events: Number((await client.query("SELECT COUNT(*) FROM stop_event WHERE client_uuid = $1", [payload.clientUuid])).rows[0].count),
      inventory: Number((await client.query("SELECT COUNT(*) FROM inventory_ledger_entry WHERE stop_event_id = $1", [accepted.stopEventId])).rows[0].count),
      money: Number((await client.query("SELECT COUNT(*) FROM money_ledger_entry WHERE stop_event_id = $1", [accepted.stopEventId])).rows[0].count),
      allocations: Number((await client.query(
        `SELECT COUNT(*) FROM payment_allocation pa
          JOIN money_ledger_entry ml ON ml.tenant_id = pa.tenant_id AND ml.money_ledger_id = pa.payment_money_ledger_id
         WHERE ml.stop_event_id = $1`,
        [accepted.stopEventId]
      )).rows[0].count)
    }), { runtimeRole });
    expect(counts).toEqual({ events: 1, inventory: 2, money: 2, allocations: 1 });
  });

  it("handles RETURN_MATCHED normal, credit, replacement-only, and due outcomes", async () => {
    const cases = [
      ["matched", { goodEmptyQty: 8, fullQtyDelivered: 8 }, { goodEmptyQtyAccepted: "8", containerCreditQty: "0", containerDueQty: "0" }],
      ["credit", { goodEmptyQty: 12, fullQtyDelivered: 8, excessEmptyResolution: "ACCEPT_AS_CREDIT" }, { goodEmptyQtyAccepted: "12", containerCreditQty: "4" }],
      ["replacement", { goodEmptyQty: 12, fullQtyDelivered: 8, excessEmptyResolution: "ACCEPT_ONLY_REPLACED" }, { goodEmptyQtyAccepted: "8", containerCreditQty: "0" }],
      ["due", { goodEmptyQty: 3, fullQtyDelivered: 5, authorizeContainerDue: true }, { containerDueQty: "2" }]
    ] as const;
    for (const [key, values, expected] of cases) {
      const response = await inject(staffToken, {
        method: "POST",
        url: `/api/v1/trip-stops/${stops[key]!.stopId}/events`,
        payload: eventPayload(key, values)
      });
      expect(response.statusCode).toBe(201);
      expect((response.json() as { products: unknown[] }).products[0]).toMatchObject(expected);
    }
  });

  it("requires explicit exchange exceptions", async () => {
    const response = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${stops.dueInvalid!.stopId}/events`,
      payload: eventPayload("dueInvalid", { goodEmptyQty: 3, fullQtyDelivered: 5 })
    });
    expect(response.statusCode).toBe(400);
    expect(errorCode(response)).toBe("CONTAINER_DUE_AUTHORIZATION_REQUIRED");
  });

  it("posts charged/no-charge damage and rejects physical receipt for rejected damage", async () => {
    const resolutions = [
      ["damageCharge", "CHARGE_DAMAGE", "300", 3],
      ["damageNoCharge", "ACCEPT_DAMAGE_WITHOUT_CHARGE", "0", 3],
      ["damageReject", "REJECT_DAMAGE", "0", 2]
    ] as const;
    for (const [key, resolution, charge, inventoryCount] of resolutions) {
      const response = await inject(staffToken, {
        method: "POST",
        url: `/api/v1/trip-stops/${stops[key]!.stopId}/events`,
        payload: eventPayload(key, {
          goodEmptyQty: 4,
          fullQtyDelivered: 4,
          damagedEmptyQty: 1,
          damageResolution: resolution
        })
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        products: { damageChargeAmount: string }[];
        inventoryLedgerEntries: unknown[];
      };
      expect(body.products[0]!.damageChargeAmount).toBe(charge);
      expect(body.inventoryLedgerEntries).toHaveLength(inventoryCount);
    }
  });

  it("records staff price override as pending without applying it", async () => {
    const response = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${stops.override!.stopId}/events`,
      payload: eventPayload("override", {
        goodEmptyQty: 1,
        fullQtyDelivered: 1,
        priceOverride: { requestedPrice: 30, reason: "Customer dispute" }
      })
    });
    expect(response.statusCode).toBe(201);
    expect((response.json() as { products: unknown[] }).products[0]).toMatchObject({
      priceApplied: "38",
      priceSource: "CUSTOMER_PRICE",
      priceOverride: { requestedPrice: "30", approvalStatus: "PENDING" }
    });
  });

  it("applies and audits an administrative transaction-time override", async () => {
    const response = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${stops.overrideAdmin!.stopId}/events`,
      payload: eventPayload("overrideAdmin", {
        goodEmptyQty: 1,
        fullQtyDelivered: 1,
        priceOverride: { requestedPrice: 30, reason: "Approved service recovery" }
      })
    });
    expect(response.statusCode).toBe(201);
    expect((response.json() as { products: unknown[] }).products[0]).toMatchObject({
      priceApplied: "30",
      priceSource: "STAFF_OVERRIDE",
      lineChargeAmount: "30",
      priceOverride: { standardPrice: "38", requestedPrice: "30", approvalStatus: "APPROVED" }
    });
  });

  it("allocates payments to oldest dues and leaves an excess payment unallocated", async () => {
    const partialPayment = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${stops.oldPayment!.stopId}/events`,
      payload: {
        ...eventPayload("oldPayment", { rejectedEmptyQty: 1 }),
        payments: [{ amount: 50, paymentMethod: "CASH" }]
      }
    });
    expect(partialPayment.statusCode).toBe(201);
    const partialPaymentId = (partialPayment.json() as {
      moneyLedgerEntries: { moneyLedgerId: string; transactionType: string }[];
    }).moneyLedgerEntries.find((entry) => entry.transactionType === "CUSTOMER_PAYMENT")!.moneyLedgerId;

    const advancePayment = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${stops.advancePayment!.stopId}/events`,
      payload: {
        ...eventPayload("advancePayment", { rejectedEmptyQty: 1 }),
        payments: [{ amount: 10000, paymentMethod: "CASH" }]
      }
    });
    expect(advancePayment.statusCode).toBe(201);
    const advancePaymentId = (advancePayment.json() as {
      moneyLedgerEntries: { moneyLedgerId: string; transactionType: string }[];
    }).moneyLedgerEntries.find((entry) => entry.transactionType === "CUSTOMER_PAYMENT")!.moneyLedgerId;

    const allocations = await withTenantTransaction(
      seedPool,
      { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] },
      async (client) => ({
        partial: Number((await client.query<{ allocated: string }>(
          "SELECT COALESCE(SUM(allocated_amount), 0) AS allocated FROM payment_allocation WHERE payment_money_ledger_id = $1",
          [partialPaymentId]
        )).rows[0]!.allocated),
        advance: Number((await client.query<{ allocated: string }>(
          "SELECT COALESCE(SUM(allocated_amount), 0) AS allocated FROM payment_allocation WHERE payment_money_ledger_id = $1",
          [advancePaymentId]
        )).rows[0]!.allocated)
      }),
      { runtimeRole }
    );
    expect(allocations.partial).toBe(50);
    expect(allocations.advance).toBeLessThan(10000);
  });

  it("rejects delivery beyond derived vehicle FULL stock", async () => {
    const response = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${stops.shortage!.stopId}/events`,
      payload: eventPayload("shortage", { goodEmptyQty: 500, fullQtyDelivered: 500 })
    });
    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe("INSUFFICIENT_VEHICLE_STOCK");
  });

  it("marks partial delivery and creates an exact follow-up", async () => {
    const event = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${stops.partial!.stopId}/events`,
      payload: eventPayload("partial", { goodEmptyQty: 6, fullQtyDelivered: 6 })
    });
    expect(event.statusCode).toBe(201);
    const followUp = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${stops.partial!.stopId}/follow-up`,
      payload: { productId, remainingQty: 4, resolutionType: "FOLLOW_UP" }
    });
    expect(followUp.statusCode).toBe(201);
    expect(followUp.json()).toMatchObject({ remainingQty: "4", resolutionType: "FOLLOW_UP", status: "OPEN" });
  });

  it("enforces tenant isolation and authentication on stop execution", async () => {
    const crossTenant = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${tenantBStopId}/events`,
      payload: { clientUuid: randomUUID(), eventTime: new Date().toISOString(), products: [] }
    });
    expect(crossTenant.statusCode).toBe(400);
    expect(errorCode(crossTenant)).toBe("VALIDATION_FAILED");

    const noContext = await server.inject({
      method: "POST",
      url: `/api/v1/trip-stops/${stops.matched!.stopId}/events`,
      payload: eventPayload("matched", { goodEmptyQty: 1, fullQtyDelivered: 1 })
    });
    expect(noContext.statusCode).toBe(401);
  });

  it("keeps inventory, money, and allocation history append-only", async () => {
    await expect(withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] },
      (client) => client.query(
        "UPDATE inventory_ledger_entry SET quantity = quantity + 1 WHERE tenant_id = $1 AND stop_event_id IS NOT NULL",
        [tenantA]
      ), { runtimeRole })).rejects.toThrow();
    await expect(withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] },
      (client) => client.query(
        "DELETE FROM money_ledger_entry WHERE tenant_id = $1 AND stop_event_id IS NOT NULL",
        [tenantA]
      ), { runtimeRole })).rejects.toThrow();
    await expect(withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] },
      (client) => client.query("UPDATE payment_allocation SET allocated_amount = 1 WHERE tenant_id = $1", [tenantA]),
      { runtimeRole })).rejects.toThrow();
  });

  it("cannot resolve another tenant stop through the application tenant context", async () => {
    const response = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/trip-stops/${tenantBStopId}/events`,
      payload: {
        clientUuid: randomUUID(),
        eventTime: "2026-09-01T10:35:00+05:30",
        products: [{ tripStopProductId: 999999, productId, goodEmptyQty: 1, fullQtyDelivered: 1 }]
      }
    });
    expect(response.statusCode).toBe(404);
    expect(errorCode(response)).toBe("TRIP_STOP_NOT_FOUND");
  });
});
