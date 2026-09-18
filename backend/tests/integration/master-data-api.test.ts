import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { JwtService } from "@nestjs/jwt";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance, InjectOptions } from "fastify";
import path from "node:path";
import pg from "pg";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import { createPool } from "../../src/db/pool.js";
import { applyMigrations } from "../../src/db/migrations.js";
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
let tenantAOwnerId: number;
let tenantAAdminId: number;
let tenantAStaffId: number;
let tenantBOwnerId: number;
let ownerToken: string;
let adminToken: string;
let staffToken: string;
let tenantBOwnerToken: string;
let tenantBProductId: number;

const configFor = (databaseUrl: string): AppConfig => ({
  NODE_ENV: "test",
  APP_NAME: "pms-master-data-test",
  APP_PORT: 4000,
  DATABASE_URL: databaseUrl,
  DATABASE_POOL_MIN: 0,
  DATABASE_POOL_MAX: 10,
  DATABASE_RUNTIME_ROLE: runtimeRole,
  AUTH_JWT_SECRET: "test-secret-that-is-at-least-32-characters",
  AUTH_JWT_ISSUER: "pms-backend",
  AUTH_JWT_AUDIENCE: "pms-api",
  LOG_LEVEL: "silent",
  SWAGGER_ENABLED: true
});

async function seedIdentity(
  tenantId: number,
  prefix: string,
  roleCodes: readonly string[]
): Promise<number> {
  return withTenantTransaction(
    seedPool,
    { tenantId, userId: 1, roles: ["SEED"] },
    async (client) => {
      for (const roleCode of ["OWNER", "ADMIN", "ROUTE_STAFF"]) {
        await client.query(
          `INSERT INTO role (tenant_id, role_code, role_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, role_code) DO NOTHING`,
          [tenantId, roleCode, roleCode.replace("_", " ")]
        );
      }
      const user = (await client.query<{ user_id: number }>(
        `INSERT INTO app_user (tenant_id, login_identity, display_name)
         VALUES ($1, $2, $3)
         RETURNING user_id`,
        [tenantId, `${prefix}-login`, `${prefix} User`]
      )).rows[0]!;
      for (const roleCode of roleCodes) {
        await client.query(
          `INSERT INTO user_role (tenant_id, user_id, role_id)
           SELECT $1, $2, role_id
             FROM role
            WHERE tenant_id = $1 AND role_code = $3`,
          [tenantId, user.user_id, roleCode]
        );
      }
      return user.user_id;
    },
    { runtimeRole }
  );
}

async function inject(token: string | undefined, options: InjectOptions) {
  return unwrapApiSuccess(await server.inject({
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
    }
  }));
}

function errorCode(response: { json(): unknown }): string | undefined {
  const body = response.json() as { error?: { code?: string } };
  return body.error?.code;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  seedPool = new Pool({ connectionString: container.getConnectionUri(), max: 10 });
  await applyMigrations(seedPool, migrationDirectory);

  [tenantA, tenantB] = await withSystemTransaction(seedPool, async (client) => {
    const result = await client.query<{ tenant_id: number }>(
      `INSERT INTO pms.tenant (tenant_code, name, business_type)
       VALUES ('API_A', 'API Tenant A', 'ROUTE_DELIVERY'),
              ('API_B', 'API Tenant B', 'ROUTE_DELIVERY')
       RETURNING tenant_id`
    );
    return [result.rows[0]!.tenant_id, result.rows[1]!.tenant_id];
  });

  tenantAOwnerId = await seedIdentity(tenantA, "a-owner", ["OWNER"]);
  tenantAAdminId = await seedIdentity(tenantA, "a-admin", ["ADMIN"]);
  tenantAStaffId = await seedIdentity(tenantA, "a-staff", ["ROUTE_STAFF"]);
  tenantBOwnerId = await seedIdentity(tenantB, "b-owner", ["OWNER"]);

  tenantBProductId = await withTenantTransaction(
    seedPool,
    { tenantId: tenantB, userId: tenantBOwnerId, roles: ["OWNER"] },
    async (client) => (await client.query<{ product_id: number }>(
      `INSERT INTO product
         (tenant_id, product_code, name, unit_type, exchange_ratio, created_by_user_id)
       VALUES ($1, 'B_ONLY', 'Tenant B Product', 'EXCHANGE', 1, $2)
       RETURNING product_id`,
      [tenantB, tenantBOwnerId]
    )).rows[0]!.product_id,
    { runtimeRole }
  );

  const config = configFor(container.getConnectionUri());
  appPool = createPool(config);
  app = await buildApp(config, appPool);
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
  await server.ready();
  const jwt = app.get(JwtService);
  ownerToken = await jwt.signAsync({ sub: String(tenantAOwnerId), tenantId: tenantA });
  adminToken = await jwt.signAsync({ sub: String(tenantAAdminId), tenantId: tenantA });
  staffToken = await jwt.signAsync({ sub: String(tenantAStaffId), tenantId: tenantA });
  tenantBOwnerToken = await jwt.signAsync({ sub: String(tenantBOwnerId), tenantId: tenantB });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await seedPool?.end();
  await container?.stop();
});

describe("product master-data APIs", () => {
  it("keeps Tenant B products invisible to Tenant A and blocks body tenant authority", async () => {
    const list = await inject(ownerToken, { method: "GET", url: "/api/v1/products" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ items: [], page: { count: 0, total: 0, hasMore: false } });

    const crossRead = await inject(ownerToken, {
      method: "GET",
      url: `/api/v1/products/${tenantBProductId}`
    });
    expect(crossRead.statusCode).toBe(404);
    expect(errorCode(crossRead)).toBe("PRODUCT_NOT_FOUND");

    const crossWrite = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/products",
      payload: {
        tenantId: tenantB,
        productCode: "ILLEGAL",
        name: "Illegal Cross Tenant Product",
        unitType: "EXCHANGE",
        exchangeRatio: 1
      }
    });
    expect(crossWrite.statusCode).toBe(400);
    expect(errorCode(crossWrite)).toBe("VALIDATION_FAILED");

    const tenantBList = await inject(tenantBOwnerToken, { method: "GET", url: "/api/v1/products" });
    expect((tenantBList.json() as { items: { productCode: string }[] }).items.map((item) => item.productCode))
      .toEqual(["B_ONLY"]);
  });

  it("enforces EXCHANGE and non-EXCHANGE ratio rules", async () => {
    const missingRatio = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/products",
      payload: { productCode: "NO_RATIO", name: "No ratio", unitType: "EXCHANGE" }
    });
    expect(missingRatio.statusCode).toBe(400);
    expect(errorCode(missingRatio)).toBe("EXCHANGE_RATIO_REQUIRED");

    const forbiddenRatio = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/products",
      payload: { productCode: "BAD_RATIO", name: "Bad ratio", unitType: "CONSUMABLE", exchangeRatio: 1 }
    });
    expect(forbiddenRatio.statusCode).toBe(400);
    expect(errorCode(forbiddenRatio)).toBe("EXCHANGE_RATIO_NOT_ALLOWED");
  });

  it("appends sequential product prices and time-versioned damage rates", async () => {
    const created = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/products",
      payload: { productCode: "CAN20", name: "20L Container", unitType: "EXCHANGE", exchangeRatio: 1 }
    });
    expect(created.statusCode).toBe(201);
    const productId = (created.json() as { productId: string }).productId;

    for (const payload of [
      { price: 40, effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: "2026-06-01T00:00:00Z" },
      { price: 45, effectiveFrom: "2026-06-01T00:00:00Z" }
    ]) {
      const response = await inject(ownerToken, {
        method: "POST",
        url: `/api/v1/products/${productId}/prices`,
        payload
      });
      expect(response.statusCode).toBe(201);
    }

    for (const payload of [
      { damageType: "BROKEN", rate: 300, effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: "2026-06-01T00:00:00Z" },
      { damageType: "BROKEN", rate: 350, effectiveFrom: "2026-06-01T00:00:00Z" }
    ]) {
      const response = await inject(ownerToken, {
        method: "POST",
        url: `/api/v1/products/${productId}/damage-rates`,
        payload
      });
      expect(response.statusCode).toBe(201);
    }

    const detail = await inject(ownerToken, { method: "GET", url: `/api/v1/products/${productId}` });
    const body = detail.json() as {
      prices: { price: string }[];
      damageRates: { damageType: string; rate: string }[];
    };
    expect(body.prices.map((price) => price.price)).toEqual(["40", "45"]);
    expect(body.damageRates.map((rate) => [rate.damageType, rate.rate])).toEqual([
      ["BROKEN", "300"],
      ["BROKEN", "350"]
    ]);
  });
});

describe("user, role, and staff APIs", () => {
  it("uses existing tenant role rows and permits staff without an AppUser login", async () => {
    const roles = await inject(ownerToken, { method: "GET", url: "/api/v1/roles" });
    expect(roles.statusCode).toBe(200);
    const roleItems = (roles.json() as { items: { roleId: string; roleCode: string }[] }).items;
    expect(roleItems.map((role) => role.roleCode))
      .toEqual(["ADMIN", "OWNER", "ROUTE_STAFF"]);

    const user = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/users",
      payload: { loginIdentity: "new-route-user", displayName: "New Route User" }
    });
    expect(user.statusCode).toBe(201);
    const userId = (user.json() as { userId: string }).userId;
    const routeRole = roleItems
      .find((role) => role.roleCode === "ROUTE_STAFF")!;

    const assignment = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/users/${userId}/roles`,
      payload: { roleId: Number(routeRole.roleId) }
    });
    expect(assignment.statusCode).toBe(201);
    expect(assignment.json()).toMatchObject({ userId, role: { roleCode: "ROUTE_STAFF" } });

    const staff = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/staff",
      payload: { name: "No Login Staff", staffType: "DELIVERY_HELPER" }
    });
    expect(staff.statusCode).toBe(201);
    expect(staff.json()).toMatchObject({ userId: null, name: "No Login Staff" });

    const staffDetail = await inject(ownerToken, {
      method: "GET",
      url: `/api/v1/staff/${(staff.json() as { staffId: string }).staffId}`
    });
    expect(staffDetail.statusCode).toBe(200);
    expect(staffDetail.json()).toMatchObject({ userId: null, name: "No Login Staff", user: null });

    const linkedStaff = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/staff",
      payload: { userId: Number(userId), name: "Linked Route Staff", staffType: "DELIVERY_STAFF" }
    });
    const linkedDetail = await inject(ownerToken, {
      method: "GET",
      url: `/api/v1/staff/${(linkedStaff.json() as { staffId: string }).staffId}`
    });
    expect(linkedDetail.json()).toMatchObject({
      user: { userId, roles: [expect.objectContaining({ roleCode: "ROUTE_STAFF" })] }
    });
  });
});

describe("customer master-data APIs", () => {
  let pendingCustomerId: string;
  let configuredCustomerId: string;
  let productId: string;

  it("applies staff temporary and permanent approval states", async () => {
    const temporary = await inject(staffToken, {
      method: "POST",
      url: "/api/v1/customers",
      payload: {
        name: "Temporary Shop",
        relationshipType: "AD_HOC",
        creationMode: "TEMPORARY"
      }
    });
    expect(temporary.statusCode).toBe(201);
    expect(temporary.json()).toMatchObject({ customerStatus: "TEMPORARY", createdSource: "STAFF" });

    const permanent = await inject(staffToken, {
      method: "POST",
      url: "/api/v1/customers",
      payload: {
        name: "Pending Shop",
        relationshipType: "SUBSCRIPTION_ROUTE",
        creationMode: "PERMANENT"
      }
    });
    expect(permanent.statusCode).toBe(201);
    expect(permanent.json()).toMatchObject({ customerStatus: "PENDING_APPROVAL", createdSource: "STAFF" });
    pendingCustomerId = (permanent.json() as { partyId: string }).partyId;
  });

  it("lets owner/admin approve pending customers but not Route Staff", async () => {
    const ownAttempt = await inject(staffToken, {
      method: "POST",
      url: `/api/v1/customers/${pendingCustomerId}/approve`
    });
    expect(ownAttempt.statusCode).toBe(403);
    expect(errorCode(ownAttempt)).toBe("ROLE_NOT_AUTHORIZED");

    const approval = await inject(adminToken, {
      method: "POST",
      url: `/api/v1/customers/${pendingCustomerId}/approve`
    });
    expect(approval.statusCode).toBe(200);
    expect(approval.json()).toMatchObject({ customerStatus: "ACTIVE" });
  });

  it("enforces PartyProduct quantity-mode rules", async () => {
    const product = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/products",
      payload: { productCode: "PP_CAN", name: "Party Product Can", unitType: "EXCHANGE", exchangeRatio: 1 }
    });
    productId = (product.json() as { productId: string }).productId;

    const customer = await inject(ownerToken, {
      method: "POST",
      url: "/api/v1/customers",
      payload: { name: "Configured Shop", relationshipType: "SUBSCRIPTION_ROUTE", creationMode: "PERMANENT" }
    });
    expect(customer.json()).toMatchObject({ customerStatus: "ACTIVE", createdSource: "ADMIN" });
    configuredCustomerId = (customer.json() as { partyId: string }).partyId;

    const fixedWithoutDefault = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/customers/${configuredCustomerId}/products`,
      payload: { productId: Number(productId), quantityMode: "FIXED_PLANNED" }
    });
    expect(fixedWithoutDefault.statusCode).toBe(400);
    expect(errorCode(fixedWithoutDefault)).toBe("FIXED_PLANNED_DEFAULT_QTY_REQUIRED");

    const returnMatched = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/customers/${configuredCustomerId}/products`,
      payload: { productId: Number(productId), quantityMode: "RETURN_MATCHED", forecastQty: 8 }
    });
    expect(returnMatched.statusCode).toBe(201);
    expect(returnMatched.json()).toMatchObject({
      quantityMode: "RETURN_MATCHED",
      defaultQty: null,
      forecastQty: "8"
    });
  });

  it("scopes customer-specific price history to tenant, customer, and product", async () => {
    const price = await inject(ownerToken, {
      method: "POST",
      url: `/api/v1/customers/${configuredCustomerId}/products/${productId}/prices`,
      payload: { price: 38, effectiveFrom: "2026-01-01T00:00:00Z" }
    });
    expect(price.statusCode).toBe(201);
    expect(price.json()).toMatchObject({
      productId,
      price: "38",
      approvalStatus: "APPROVED",
      approvedByUserId: String(tenantAOwnerId)
    });

    const detail = await inject(ownerToken, {
      method: "GET",
      url: `/api/v1/customers/${configuredCustomerId}`
    });
    expect((detail.json() as { prices: { productId: string; price: string }[] }).prices)
      .toEqual([expect.objectContaining({ productId, price: "38" })]);

    const tenantBCrossRead = await inject(tenantBOwnerToken, {
      method: "GET",
      url: `/api/v1/customers/${configuredCustomerId}`
    });
    expect(tenantBCrossRead.statusCode).toBe(404);
    expect(errorCode(tenantBCrossRead)).toBe("CUSTOMER_NOT_FOUND");
  });
});

describe("Sprint 0E list contract and performance sanity", () => {
  it("bounds pagination, applies filters, and returns a 250-row tenant list within the sanity budget", async () => {
    await withTenantTransaction(seedPool, { tenantId: tenantA, userId: tenantAOwnerId, roles: ["OWNER"] }, async (client) => {
      await client.query(
        `INSERT INTO product (tenant_id, product_code, name, unit_type, created_by_user_id)
         SELECT $1, 'PERF-' || value, 'Performance Product ' || value, 'CONSUMABLE', $2
         FROM generate_series(1, 250) value`,
        [tenantA, tenantAOwnerId]
      );
    }, { runtimeRole });
    const startedAt = performance.now();
    const response = await inject(ownerToken, {
      method: "GET",
      url: "/api/v1/products?limit=100&offset=100&q=Performance&status=ACTIVE"
    });
    const elapsedMs = performance.now() - startedAt;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      page: { limit: 100, offset: 100, count: 100, total: 250, hasMore: true }
    });
    expect((response.json() as { items: unknown[] }).items).toHaveLength(100);
    expect(elapsedMs).toBeLessThan(2_000);

    const invalidLimit = await inject(ownerToken, { method: "GET", url: "/api/v1/products?limit=101" });
    expect(invalidLimit.statusCode).toBe(400);
    expect(errorCode(invalidLimit)).toBe("VALIDATION_FAILED");
  });
});

describe("protected request context", () => {
  it("rejects requests with no authenticated server context", async () => {
    const response = await inject(undefined, { method: "GET", url: "/api/v1/products" });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe("AUTHENTICATION_REQUIRED");
  });

  it("rejects a validly signed Tenant A identity paired with Tenant B context", async () => {
    const jwt = app.get(JwtService);
    const mismatchedToken = await jwt.signAsync({ sub: String(tenantAOwnerId), tenantId: tenantB });
    const response = await inject(mismatchedToken, { method: "GET", url: "/api/v1/products" });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe("AUTHENTICATED_USER_INACTIVE");
  });
});
