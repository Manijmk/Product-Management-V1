import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { JwtService } from "@nestjs/jwt";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance, InjectOptions } from "fastify";
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import { applyMigrations } from "../../src/db/migrations.js";
import { createPool } from "../../src/db/pool.js";
import { withSystemTransaction, withTenantTransaction } from "../../src/db/transaction.js";
import { unwrapApiSuccess } from "../helpers/unwrap-api-success.js";

const { Pool } = pg;
const runtimeRole = "pms_app";
let container: StartedPostgreSqlContainer;
let seedPool: pg.Pool;
let appPool: pg.Pool;
let app: NestFastifyApplication;
let server: FastifyInstance;
let tenantId: number;
let ownerId: number;
let staffUserId: number;
let staffId: number;
let ownerToken: string;
let staffToken: string;

const configFor = (databaseUrl: string): AppConfig => ({
  NODE_ENV: "test",
  APP_NAME: "pms-sprint0-uat",
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

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  seedPool = new Pool({ connectionString: container.getConnectionUri(), max: 10 });
  await applyMigrations(seedPool, path.resolve(process.cwd(), "../database"));
  tenantId = await withSystemTransaction(seedPool, async (client) => (await client.query<{ tenant_id: number }>(
    `INSERT INTO pms.tenant (tenant_code, name, business_type)
     VALUES ('UAT_E2E', 'Sprint 0 UAT', 'ROUTE_DELIVERY') RETURNING tenant_id`
  )).rows[0]!.tenant_id);
  await withTenantTransaction(seedPool, { tenantId, userId: 1, roles: ["SEED"] }, async (client) => {
    for (const role of ["OWNER", "ADMIN", "ROUTE_STAFF"]) {
      await client.query(
        "INSERT INTO role (tenant_id, role_code, role_name) VALUES ($1, $2, $2)",
        [tenantId, role]
      );
    }
    const users = await client.query<{ user_id: number }>(
      `INSERT INTO app_user (tenant_id, login_identity, display_name)
       VALUES ($1, 'uat-e2e-owner', 'UAT Owner'), ($1, 'uat-e2e-staff', 'UAT Staff') RETURNING user_id`,
      [tenantId]
    );
    ownerId = users.rows[0]!.user_id;
    staffUserId = users.rows[1]!.user_id;
    await client.query(
      `INSERT INTO user_role (tenant_id, user_id, role_id, assigned_by_user_id)
       SELECT $1, $2, role_id, $4 FROM role WHERE tenant_id = $1 AND role_code = $3`,
      [tenantId, ownerId, "OWNER", ownerId]
    );
    await client.query(
      `INSERT INTO user_role (tenant_id, user_id, role_id, assigned_by_user_id)
       SELECT $1, $2, role_id, $4 FROM role WHERE tenant_id = $1 AND role_code = $3`,
      [tenantId, staffUserId, "ROUTE_STAFF", ownerId]
    );
    staffId = (await client.query<{ staff_id: number }>(
      `INSERT INTO staff (tenant_id, user_id, name, staff_type, created_by_user_id)
       VALUES ($1, $2, 'UAT Delivery Staff', 'DELIVERY_STAFF', $3) RETURNING staff_id`,
      [tenantId, staffUserId, ownerId]
    )).rows[0]!.staff_id;
  }, { runtimeRole });
  const config = configFor(container.getConnectionUri());
  appPool = createPool(config);
  app = await buildApp(config, appPool);
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
  await server.ready();
  const jwt = app.get(JwtService);
  ownerToken = await jwt.signAsync({ sub: String(ownerId), tenantId });
  staffToken = await jwt.signAsync({ sub: String(staffUserId), tenantId });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await seedPool?.end();
  await container?.stop();
});

describe("Sprint 0 operational UAT", () => {
  it("runs master data through trip execution, idempotent ledgers, and reconciliation close", async () => {
    const productResponse = await inject(ownerToken, {
      method: "POST", url: "/api/v1/products",
      payload: { productCode: "UAT_EX", name: "UAT Exchange", unitType: "EXCHANGE", exchangeRatio: 1 }
    });
    expect(productResponse.statusCode).toBe(201);
    const productId = Number((productResponse.json() as { productId: string }).productId);
    expect((await inject(ownerToken, {
      method: "POST", url: `/api/v1/products/${productId}/prices`,
      payload: { price: 50, effectiveFrom: "2026-01-01T00:00:00Z" }
    })).statusCode).toBe(201);

    const customerResponse = await inject(ownerToken, {
      method: "POST", url: "/api/v1/customers",
      payload: {
        partyCode: "UAT_SHOP", name: "UAT Return Shop",
        relationshipType: "SUBSCRIPTION_ROUTE", creationMode: "PERMANENT"
      }
    });
    const partyId = Number((customerResponse.json() as { partyId: string }).partyId);
    const configuration = await inject(ownerToken, {
      method: "POST", url: `/api/v1/customers/${partyId}/products`,
      payload: {
        productId, quantityMode: "RETURN_MATCHED", forecastQty: 10,
        exchangePolicy: "ALLOW_CONTAINER_DUE"
      }
    });
    const partyProductId = Number((configuration.json() as { partyProductId: string }).partyProductId);

    const vehicleResponse = await inject(ownerToken, {
      method: "POST", url: "/api/v1/vehicles",
      payload: { registrationNo: "UAT-E2E-01", vehicleType: "VAN", ownershipType: "OWNED" }
    });
    const vehicleId = Number((vehicleResponse.json() as { vehicleId: string }).vehicleId);
    const tripResponse = await inject(ownerToken, {
      method: "POST", url: "/api/v1/trips",
      payload: { tripNumber: "UAT-E2E-TRIP", tripDate: "2026-09-01", vehicleId, primaryStaffId: staffId }
    });
    const tripId = Number((tripResponse.json() as { tripId: string }).tripId);
    const stopResponse = await inject(ownerToken, {
      method: "POST", url: `/api/v1/trips/${tripId}/stops`,
      payload: {
        partyId, source: "ADMIN_ADDED", sortableOrder: 10,
        products: [{ productId, partyProductId, quantityMode: "RETURN_MATCHED", forecastQty: 10 }]
      }
    });
    const stop = (stopResponse.json() as {
      stops: { tripStopId: string; products: { tripStopProductId: string }[] }[];
    }).stops[0]!;

    await withTenantTransaction(seedPool, { tenantId, userId: ownerId, roles: ["OWNER"] }, async (client) => {
      const locationId = (await client.query<{ inventory_location_id: number }>(
        "SELECT inventory_location_id FROM inventory_location WHERE tenant_id = $1 AND vehicle_id = $2",
        [tenantId, vehicleId]
      )).rows[0]!.inventory_location_id;
      const fullStateId = (await client.query<{ inventory_state_id: number }>(
        "SELECT inventory_state_id FROM inventory_state WHERE code = 'FULL'"
      )).rows[0]!.inventory_state_id;
      await client.query(
        `INSERT INTO inventory_ledger_entry (
           tenant_id, product_id, to_location_id, to_state_id, quantity, event_type, trip_id, occurred_at, created_by_user_id
         ) VALUES ($1, $2, $3, $4, 10, 'TRIP_LOAD', $5, NOW(), $6)`,
        [tenantId, productId, locationId, fullStateId, tripId, ownerId]
      );
    }, { runtimeRole });

    expect((await inject(ownerToken, { method: "POST", url: `/api/v1/trips/${tripId}/dispatch` })).statusCode).toBe(200);
    expect((await inject(staffToken, { method: "POST", url: `/api/v1/trips/${tripId}/start` })).statusCode).toBe(200);
    const eventPayload = {
      clientUuid: randomUUID(), eventTime: "2026-09-01T09:00:00+05:30",
      products: [{
        tripStopProductId: Number(stop.products[0]!.tripStopProductId), productId,
        goodEmptyQty: 2, fullQtyDelivered: 2
      }],
      payments: [{ amount: 100, paymentMethod: "CASH" }]
    };
    const event = await inject(staffToken, {
      method: "POST", url: `/api/v1/trip-stops/${stop.tripStopId}/events`, payload: eventPayload
    });
    expect(event.statusCode).toBe(201);
    expect(event.json()).toMatchObject({ duplicate: false });
    const retry = await inject(staffToken, {
      method: "POST", url: `/api/v1/trip-stops/${stop.tripStopId}/events`, payload: eventPayload
    });
    expect(retry.json()).toMatchObject({ duplicate: true, stopEventId: (event.json() as { stopEventId: string }).stopEventId });

    expect((await inject(staffToken, { method: "POST", url: `/api/v1/trips/${tripId}/complete` })).statusCode).toBe(200);
    const reconciliationResponse = await inject(staffToken, {
      method: "POST", url: `/api/v1/trips/${tripId}/reconciliation`, payload: { notes: "UAT close" }
    });
    expect(reconciliationResponse.statusCode).toBe(201);
    const reconciliation = reconciliationResponse.json() as {
      reconciliationId: string;
      expectedStock: { inventoryLocationId: string; productId: string; inventoryStateId: string; expectedQty: string }[];
      expectedCash: { staffId: string; expectedCash: string }[];
    };
    for (const count of reconciliation.expectedStock) {
      const result = await inject(staffToken, {
        method: "PUT", url: `/api/v1/reconciliations/${reconciliation.reconciliationId}/stock`,
        payload: {
          inventoryLocationId: Number(count.inventoryLocationId), productId: Number(count.productId),
          inventoryStateId: Number(count.inventoryStateId), actualQty: Number(count.expectedQty)
        }
      });
      expect(result.statusCode).toBe(200);
    }
    for (const count of reconciliation.expectedCash) {
      const result = await inject(staffToken, {
        method: "PUT", url: `/api/v1/reconciliations/${reconciliation.reconciliationId}/cash`,
        payload: { staffId: Number(count.staffId), actualCash: Number(count.expectedCash) }
      });
      expect(result.statusCode).toBe(200);
    }
    expect((await inject(staffToken, {
      method: "POST", url: `/api/v1/reconciliations/${reconciliation.reconciliationId}/submit`
    })).statusCode).toBe(200);
    expect((await inject(ownerToken, {
      method: "POST", url: `/api/v1/reconciliations/${reconciliation.reconciliationId}/approve`
    })).statusCode).toBe(200);
    const closed = await inject(ownerToken, { method: "POST", url: `/api/v1/trips/${tripId}/reconcile` });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ status: "RECONCILED" });
  });
});
