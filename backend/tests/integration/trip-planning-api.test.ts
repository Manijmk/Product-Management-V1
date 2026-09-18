import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { JwtService } from "@nestjs/jwt";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance, InjectOptions } from "fastify";
import path from "node:path";
import pg from "pg";
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
let ownerToken: string;
let staffToken: string;
let primaryStaffId: number;
let helperStaffId: number;
let relieverStaffId: number;
let customer1Id: number;
let customer2Id: number;
let temporaryCustomerId: number;
let product1Id: number;
let product2Id: number;
let partyProduct1Id: number;
let partyProduct2Id: number;
let partyProduct3Id: number;
let temporaryPartyProductId: number;
let tenantBRouteId: number;
let tenantBVehicleId: number;
let tenantBTripId: number;
let routeId: string;
let vehicleId: string;
let copiedTripId: string;

const configFor = (databaseUrl: string): AppConfig => ({
  NODE_ENV: "test",
  APP_NAME: "pms-trip-planning-test",
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

function code(response: { json(): unknown }): string | undefined {
  return (response.json() as { error?: { code?: string } }).error?.code;
}

async function seedTenantIdentity(tenantId: number, prefix: string, roleCode: string): Promise<number> {
  return withTenantTransaction(seedPool, { tenantId, userId: 1, roles: ["SEED"] }, async (client) => {
    for (const role of ["OWNER", "ADMIN", "ROUTE_STAFF"]) {
      await client.query(
        `INSERT INTO role (tenant_id, role_code, role_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, role_code) DO NOTHING`,
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
       VALUES ('PLAN_A', 'Planning A', 'ROUTE_DELIVERY'), ('PLAN_B', 'Planning B', 'ROUTE_DELIVERY')
       RETURNING tenant_id`
    );
    return [rows.rows[0]!.tenant_id, rows.rows[1]!.tenant_id];
  });
  ownerId = await seedTenantIdentity(tenantA, "plan-owner", "OWNER");
  routeUserId = await seedTenantIdentity(tenantA, "plan-staff", "ROUTE_STAFF");
  const tenantBOwnerId = await seedTenantIdentity(tenantB, "plan-b-owner", "OWNER");

  await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] }, async (client) => {
    const staff = await client.query<{ staff_id: number }>(
      `INSERT INTO staff (tenant_id, user_id, name, staff_type, created_by_user_id)
       VALUES ($1, $2, 'Primary', 'DELIVERY_STAFF', $3),
              ($1, NULL, 'Helper', 'HELPER', $3),
              ($1, NULL, 'Reliever', 'RELIEVER', $3)
       RETURNING staff_id`,
      [tenantA, routeUserId, ownerId]
    );
    primaryStaffId = staff.rows[0]!.staff_id;
    helperStaffId = staff.rows[1]!.staff_id;
    relieverStaffId = staff.rows[2]!.staff_id;

    const products = await client.query<{ product_id: number }>(
      `INSERT INTO product (tenant_id, product_code, name, unit_type, exchange_ratio, created_by_user_id)
       VALUES ($1, 'PLAN_EX', 'Exchange Product', 'EXCHANGE', 1, $2),
              ($1, 'PLAN_CO', 'Consumable Product', 'CONSUMABLE', NULL, $2)
       RETURNING product_id`,
      [tenantA, ownerId]
    );
    product1Id = products.rows[0]!.product_id;
    product2Id = products.rows[1]!.product_id;

    const parties = await client.query<{ party_id: number }>(
      `INSERT INTO party
         (tenant_id, name, relationship_type, customer_status, created_source,
          created_by_user_id, approved_by_user_id, approved_at)
       VALUES ($1, 'Customer One', 'SUBSCRIPTION_ROUTE', 'ACTIVE', 'ADMIN', $2, $2, NOW()),
              ($1, 'Customer Two', 'SUBSCRIPTION_ROUTE', 'ACTIVE', 'ADMIN', $2, $2, NOW()),
              ($1, 'Temporary Customer', 'AD_HOC', 'TEMPORARY', 'STAFF', $3, NULL, NULL)
       RETURNING party_id`,
      [tenantA, ownerId, routeUserId]
    );
    customer1Id = parties.rows[0]!.party_id;
    customer2Id = parties.rows[1]!.party_id;
    temporaryCustomerId = parties.rows[2]!.party_id;

    const configurations = await client.query<{ party_product_id: number }>(
      `INSERT INTO party_product
         (tenant_id, party_id, product_id, quantity_mode, default_qty, forecast_qty, created_by_user_id)
       VALUES ($1, $2, $3, 'RETURN_MATCHED', NULL, 8, $7),
              ($1, $2, $4, 'FIXED_PLANNED', 2, NULL, $7),
              ($1, $5, $3, 'FIXED_PLANNED', 3, NULL, $7),
              ($1, $6, $3, 'AD_HOC', NULL, NULL, $7)
       RETURNING party_product_id`,
      [tenantA, customer1Id, product1Id, product2Id, customer2Id, temporaryCustomerId, ownerId]
    );
    partyProduct1Id = configurations.rows[0]!.party_product_id;
    partyProduct2Id = configurations.rows[1]!.party_product_id;
    partyProduct3Id = configurations.rows[2]!.party_product_id;
    temporaryPartyProductId = configurations.rows[3]!.party_product_id;
  }, { runtimeRole });

  await withTenantTransaction(seedPool, { tenantId: tenantB, userId: tenantBOwnerId, roles: ["OWNER"] }, async (client) => {
    tenantBRouteId = (await client.query<{ route_id: number }>(
      `INSERT INTO route (tenant_id, route_code, route_name, created_by_user_id)
       VALUES ($1, 'B_ROUTE', 'B Route', $2) RETURNING route_id`,
      [tenantB, tenantBOwnerId]
    )).rows[0]!.route_id;
    tenantBVehicleId = (await client.query<{ vehicle_id: number }>(
      `INSERT INTO vehicle (tenant_id, registration_no, vehicle_type, created_by_user_id)
       VALUES ($1, 'TN-B-001', 'VAN', $2) RETURNING vehicle_id`,
      [tenantB, tenantBOwnerId]
    )).rows[0]!.vehicle_id;
    tenantBTripId = (await client.query<{ trip_id: number }>(
      `INSERT INTO trip (tenant_id, trip_number, trip_date, route_id, vehicle_id, created_by_user_id)
       VALUES ($1, 'B-TRIP', CURRENT_DATE, $2, $3, $4) RETURNING trip_id`,
      [tenantB, tenantBRouteId, tenantBVehicleId, tenantBOwnerId]
    )).rows[0]!.trip_id;
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

describe("Sprint 0B planning APIs", () => {
  it("isolates Tenant B routes, vehicles, and trips", async () => {
    for (const [resource, id, expectedCode] of [
      ["routes", tenantBRouteId, "ROUTE_NOT_FOUND"],
      ["vehicles", tenantBVehicleId, "VEHICLE_NOT_FOUND"],
      ["trips", tenantBTripId, "TRIP_NOT_FOUND"]
    ] as const) {
      const response = await inject(ownerToken, { method: "GET", url: `/api/v1/${resource}/${id}` });
      expect(response.statusCode).toBe(404);
      expect(code(response)).toBe(expectedCode);
    }
  });

  it("creates a tenant vehicle and validates vehicle status", async () => {
    const invalid = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/vehicles",
      payload: { registrationNo: "TN-A-BAD", vehicleType: "VAN", status: "UNKNOWN" }
    });
    expect(invalid.statusCode).toBe(400);
    expect(code(invalid)).toBe("VALIDATION_FAILED");

    const created = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/vehicles",
      payload: { registrationNo: "TN-A-001", vehicleType: "VAN", capacity: 100, capacityUnit: "UNIT" }
    });
    expect(created.statusCode).toBe(201);
    vehicleId = (created.json() as { vehicleId: string }).vehicleId;
  });

  it("creates a route with multiple customers and products per stop", async () => {
    const route = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/routes",
      payload: { routeCode: "R-A", routeName: "Route A" }
    });
    routeId = (route.json() as { routeId: string }).routeId;

    const first = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/routes/${routeId}/stops`,
      payload: {
        partyId: customer1Id,
        defaultSequence: 10,
        products: [
          { partyProductId: partyProduct1Id, quantityMode: "RETURN_MATCHED", forecastQty: 8 },
          { partyProductId: partyProduct2Id, quantityMode: "FIXED_PLANNED", plannedQty: 2 }
        ]
      }
    });
    expect(first.statusCode).toBe(201);

    const second = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/routes/${routeId}/stops`,
      payload: {
        partyId: customer2Id,
        defaultSequence: 20,
        products: [{ partyProductId: partyProduct3Id, quantityMode: "FIXED_PLANNED", plannedQty: 3 }]
      }
    });
    expect(second.statusCode).toBe(201);
    const detail = second.json() as { stops: { products: unknown[] }[] };
    expect(detail.stops).toHaveLength(2);
    expect(detail.stops[0]!.products).toHaveLength(2);
  });

  it("reorders an active route stop sparsely and enforces route/tenant scope", async () => {
    const detail = await inject(ownerToken, { method: "GET", url: `/api/v1/routes/${routeId}` });
    const routeStopId = (detail.json() as { stops: { routeStopId: string }[] }).stops[0]!.routeStopId;
    const reordered = await inject(ownerToken, {
      method: "PATCH",
      url: `/api/v1/routes/${routeId}/stops/${routeStopId}/order`,
      payload: { sortableOrder: 15 }
    });
    expect(reordered.statusCode).toBe(200);
    expect((reordered.json() as { stops: { routeStopId: string; sortableOrder: string }[] }).stops)
      .toEqual(expect.arrayContaining([expect.objectContaining({ routeStopId, sortableOrder: "15" })]));

    const conflict = await inject(ownerToken, {
      method: "PATCH",
      url: `/api/v1/routes/${routeId}/stops/${routeStopId}/order`,
      payload: { sortableOrder: 20 }
    });
    expect(conflict.statusCode).toBe(409);
    expect(code(conflict)).toBe("ROUTE_STOP_ORDER_CONFLICT");

    const crossTenantRoute = await inject(ownerToken, {
      method: "PATCH",
      url: `/api/v1/routes/${tenantBRouteId}/stops/${routeStopId}/order`,
      payload: { sortableOrder: 30 }
    });
    expect(crossTenantRoute.statusCode).toBe(404);
    expect(code(crossTenantRoute)).toBe("ROUTE_NOT_FOUND");
  });

  it("atomically copies active route stops/products with quantity snapshots", async () => {
    const response = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/trips",
      payload: {
        tripNumber: "COPIED-TRIP",
        routeId: Number(routeId),
        tripDate: "2026-09-01",
        vehicleId: Number(vehicleId),
        primaryStaffId,
        staff: [{ staffId: helperStaffId, tripRole: "HELPER" }]
      }
    });
    expect(response.statusCode).toBe(201);
    const trip = response.json() as {
      tripId: string;
      staff: unknown[];
      stops: { sortableOrder: string; products: { quantityMode: string; plannedQty: string | null; forecastQty: string | null }[] }[];
    };
    copiedTripId = trip.tripId;
    expect(trip.staff).toHaveLength(2);
    expect(trip.stops).toHaveLength(2);
    expect(trip.stops[0]!.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityMode: "RETURN_MATCHED", plannedQty: null, forecastQty: "8" }),
      expect.objectContaining({ quantityMode: "FIXED_PLANNED", plannedQty: "2" })
    ]));
  });

  it("does not rewrite an existing Trip when the Route later changes", async () => {
    const updatedRoute = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/routes/${routeId}/stops`,
      payload: {
        partyId: temporaryCustomerId,
        defaultSequence: 30,
        products: [{ partyProductId: temporaryPartyProductId, quantityMode: "AD_HOC" }]
      }
    });
    expect((updatedRoute.json() as { stops: unknown[] }).stops).toHaveLength(3);

    const trip = await inject(ownerToken, { method: "GET", url: `/api/v1/trips/${copiedTripId}` });
    expect((trip.json() as { stops: unknown[] }).stops).toHaveLength(2);
  });

  it("creates a completely ad-hoc Trip and rejects FIXED_PLANNED without plannedQty", async () => {
    const created = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/trips",
      payload: { tripNumber: "ADHOC-TRIP", routeId: null, tripDate: "2026-09-01" }
    });
    expect(created.statusCode).toBe(201);
    const tripId = (created.json() as { tripId: string }).tripId;
    expect(created.json()).toMatchObject({ routeId: null, stops: [] });

    const invalidStop = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/trips/${tripId}/stops`,
      payload: {
        partyId: customer1Id,
        source: "ADMIN_ADDED",
        sortableOrder: 10,
        products: [{ productId: product2Id, partyProductId: partyProduct2Id, quantityMode: "FIXED_PLANNED" }]
      }
    });
    expect(invalidStop.statusCode).toBe(400);
    expect(code(invalidStop)).toBe("FIXED_PLANNED_PLANNED_QTY_REQUIRED");
  });

  it("keeps multiple staff and reliever participation history", async () => {
    for (const payload of [
      { staffId: relieverStaffId, tripRole: "RELIEVER", joinedAt: "2026-09-01T09:00:00Z", leftAt: "2026-09-01T10:00:00Z" },
      { staffId: relieverStaffId, tripRole: "RELIEVER", joinedAt: "2026-09-01T11:00:00Z" }
    ]) {
      const response = await inject(ownerToken, {
        method: "POST",
        url: `/api/v1/trips/${copiedTripId}/staff`,
        payload
      });
      expect(response.statusCode).toBe(201);
    }
    const detail = await inject(ownerToken, { method: "GET", url: `/api/v1/trips/${copiedTripId}` });
    const staff = (detail.json() as { staff: { staffId: string; tripRole: string }[] }).staff;
    expect(staff).toHaveLength(4);
    expect(staff.filter((assignment) => assignment.tripRole === "RELIEVER")).toHaveLength(2);
  });

  it("allows Route Staff to add and sparsely reorder a pending stop while IN_PROGRESS", async () => {
    expect((await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/trips/${copiedTripId}/dispatch`
    })).json()).toMatchObject({ status: "DISPATCHED" });
    expect((await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trips/${copiedTripId}/start`
    })).json()).toMatchObject({ status: "IN_PROGRESS" });

    const added = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trips/${copiedTripId}/stops`,
      payload: {
        partyId: temporaryCustomerId,
        source: "STAFF_ADDED",
        sortableOrder: 25,
        products: [{
          productId: product1Id,
          partyProductId: temporaryPartyProductId,
          quantityMode: "AD_HOC"
        }]
      }
    });
    expect(added.statusCode).toBe(201);
    const addedStop = (added.json() as { stops: { partyId: string; tripStopId: string }[] }).stops
      .find((stop) => stop.partyId === String(temporaryCustomerId))!;

    const reordered = await inject(staffToken, {
      method: "PATCH",
      url: `/api/v1/trips/${copiedTripId}/stops/${addedStop.tripStopId}/order`,
      payload: { sortableOrder: 27 }
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json()).toMatchObject({ sortableOrder: "27", status: "PENDING" });

    await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] }, (client) =>
      client.query(
        "UPDATE trip_stop SET status = 'IN_SERVICE' WHERE tenant_id = $1 AND trip_stop_id = $2",
        [tenantA, Number(addedStop.tripStopId)]
      ), { runtimeRole });
    const blocked = await inject(staffToken, {
      method: "PATCH",
      url: `/api/v1/trips/${copiedTripId}/stops/${addedStop.tripStopId}/order`,
      payload: { sortableOrder: 28 }
    });
    expect(blocked.statusCode).toBe(409);
    expect(code(blocked)).toBe("STOP_REORDER_NOT_ALLOWED");
  });

  it("rejects live stop addition after COMPLETED", async () => {
    const created = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/trips",
      payload: { tripNumber: "CLOSED-TRIP", tripDate: "2026-09-01" }
    });
    const tripId = Number((created.json() as { tripId: string }).tripId);
    await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] }, async (client) => {
      await client.query("UPDATE trip SET status = 'LOADED' WHERE tenant_id = $1 AND trip_id = $2", [tenantA, tripId]);
      await client.query("UPDATE trip SET status = 'DISPATCHED' WHERE tenant_id = $1 AND trip_id = $2", [tenantA, tripId]);
      await client.query("UPDATE trip SET status = 'IN_PROGRESS', actual_start_at = NOW() WHERE tenant_id = $1 AND trip_id = $2", [tenantA, tripId]);
      await client.query("UPDATE trip SET status = 'COMPLETED', completed_at = NOW() WHERE tenant_id = $1 AND trip_id = $2", [tenantA, tripId]);
    }, { runtimeRole });
    const response = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/trips/${tripId}/stops`,
      payload: {
        partyId: temporaryCustomerId,
        source: "STAFF_ADDED",
        sortableOrder: 10,
        products: [{ productId: product1Id, quantityMode: "AD_HOC" }]
      }
    });
    expect(response.statusCode).toBe(409);
    expect(code(response)).toBe("INVALID_TRIP_STATUS");
  });

  it("rolls back the complete Route-to-Trip transaction when a copied product is invalid", async () => {
    const route = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/routes",
      payload: { routeCode: "BAD-COPY", routeName: "Bad Copy Route" }
    });
    const badRouteId = (route.json() as { routeId: string }).routeId;
    expect((await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/routes/${badRouteId}/stops`,
      payload: {
        partyId: customer2Id,
        defaultSequence: 10,
        products: [{ partyProductId: partyProduct3Id, quantityMode: "FIXED_PLANNED", plannedQty: 3 }]
      }
    })).statusCode).toBe(201);

    await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] }, (client) =>
      client.query(
        "UPDATE party_product SET active_status = 'INACTIVE' WHERE tenant_id = $1 AND party_product_id = $2",
        [tenantA, partyProduct3Id]
      ), { runtimeRole });

    const failed = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/trips",
      payload: { tripNumber: "ROLLBACK-TRIP", routeId: Number(badRouteId), tripDate: "2026-09-01" }
    });
    expect(failed.statusCode).toBe(409);
    expect(code(failed)).toBe("INVALID_ROUTE_STOP_PRODUCT");

    const count = await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerId, roles: ["OWNER"] }, async (client) =>
      Number((await client.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM trip WHERE tenant_id = $1 AND trip_number = 'ROLLBACK-TRIP'",
        [tenantA]
      )).rows[0]!.count), { runtimeRole });
    expect(count).toBe(0);
  });
});
