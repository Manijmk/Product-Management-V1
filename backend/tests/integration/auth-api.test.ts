import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { JwtService } from "@nestjs/jwt";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { argon2id, hash } from "argon2";
import type { FastifyInstance } from "fastify";
import path from "node:path";
import pg from "pg";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import { createPool } from "../../src/db/pool.js";
import { applyMigrations } from "../../src/db/migrations.js";
import { withSystemTransaction, withTenantTransaction } from "../../src/db/transaction.js";

const { Pool } = pg;
const runtimeRole = "pms_app";
const migrationDirectory = path.resolve(process.cwd(), "../database");
const validPassword = "correct horse battery staple";

let container: StartedPostgreSqlContainer;
let seedPool: pg.Pool;
let appPool: pg.Pool;
let app: NestFastifyApplication;
let server: FastifyInstance;
let jwt: JwtService;
let tenantA: number;
let tenantB: number;
let ownerUserId: number;
let staffUserId: number;
let staffId: number;
let ownerToken: string;

function login(payload: Record<string, unknown>) {
  return server.inject({ method: "POST", url: "/api/v1/auth/login", payload });
}

function errorCode(response: { json(): unknown }): string | undefined {
  return (response.json() as { error?: { code?: string } }).error?.code;
}

async function seedUser(
  tenantId: number,
  loginIdentity: string,
  displayName: string,
  roleCode: string,
  withStaff: boolean
): Promise<{ userId: number; staffId: number | null }> {
  const passwordHash = await hash(validPassword, { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  return withTenantTransaction(seedPool, { tenantId, userId: 1, roles: ["SEED"] }, async (client) => {
    await client.query(
      `INSERT INTO role (tenant_id, role_code, role_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, role_code) DO NOTHING`,
      [tenantId, roleCode, roleCode === "OWNER" ? "Owner" : "Route Staff"]
    );
    const user = (await client.query<{ user_id: number }>(
      `INSERT INTO app_user (tenant_id, login_identity, display_name)
       VALUES ($1, $2, $3) RETURNING user_id`,
      [tenantId, loginIdentity, displayName]
    )).rows[0]!;
    await client.query(
      `INSERT INTO user_role (tenant_id, user_id, role_id)
       SELECT $1, $2, role_id FROM role WHERE tenant_id = $1 AND role_code = $3`,
      [tenantId, user.user_id, roleCode]
    );
    await client.query(
      `INSERT INTO app_user_password_credential (tenant_id, user_id, password_hash)
       VALUES ($1, $2, $3)`,
      [tenantId, user.user_id, passwordHash]
    );
    if (!withStaff) return { userId: user.user_id, staffId: null };
    const staff = (await client.query<{ staff_id: number }>(
      `INSERT INTO staff (tenant_id, user_id, employee_code, name, staff_type)
       VALUES ($1, $2, 'RS-001', $3, 'DELIVERY_STAFF') RETURNING staff_id`,
      [tenantId, user.user_id, displayName]
    )).rows[0]!;
    return { userId: user.user_id, staffId: staff.staff_id };
  }, { runtimeRole });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  seedPool = new Pool({ connectionString: container.getConnectionUri(), max: 10 });
  await applyMigrations(seedPool, migrationDirectory);
  [tenantA, tenantB] = await withSystemTransaction(seedPool, async (client) => {
    const result = await client.query<{ tenant_id: number }>(
      `INSERT INTO pms.tenant (tenant_code, name, business_type)
       VALUES ('AUTH_A', 'Auth Tenant A', 'ROUTE_DELIVERY'), ('AUTH_B', 'Auth Tenant B', 'ROUTE_DELIVERY')
       RETURNING tenant_id`
    );
    return [result.rows[0]!.tenant_id, result.rows[1]!.tenant_id];
  });
  const owner = await seedUser(tenantA, "shared-login", "Owner A", "OWNER", false);
  const staff = await seedUser(tenantA, "route-staff", "Route Staff A", "ROUTE_STAFF", true);
  await seedUser(tenantB, "shared-login", "Owner B", "OWNER", false);
  ownerUserId = owner.userId;
  staffUserId = staff.userId;
  staffId = staff.staffId!;

  const config: AppConfig = {
    NODE_ENV: "test", APP_NAME: "pms-auth-test", APP_PORT: 4000,
    DATABASE_URL: container.getConnectionUri(), DATABASE_POOL_MIN: 0, DATABASE_POOL_MAX: 10,
    DATABASE_RUNTIME_ROLE: runtimeRole,
    AUTH_JWT_SECRET: "test-secret-that-is-at-least-32-characters",
    AUTH_JWT_ISSUER: "pms-backend", AUTH_JWT_AUDIENCE: "pms-api",
    LOG_LEVEL: "silent", SWAGGER_ENABLED: true
  };
  appPool = createPool(config);
  app = await buildApp(config, appPool);
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
  await server.ready();
  jwt = app.get(JwtService);
  ownerToken = await jwt.signAsync({ sub: String(ownerUserId), tenantId: tenantA });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await seedPool?.end();
  await container?.stop();
});

describe("local password authentication", () => {
  it("1. authenticates a valid tenant-scoped password", async () => {
    const response = await login({ tenantCode: "AUTH_A", loginIdentity: "shared-login", password: validPassword });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { tokenType: "Bearer", expiresIn: 1800, user: { id: String(ownerUserId), tenantId: String(tenantA) } } });
  });

  it("2. rejects an invalid password generically", async () => {
    const response = await login({ tenantCode: "AUTH_A", loginIdentity: "shared-login", password: "incorrect-password" });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe("INVALID_CREDENTIALS");
  });

  it("3. rejects an unknown identity with the same generic error", async () => {
    const response = await login({ tenantCode: "AUTH_A", loginIdentity: "unknown", password: "incorrect-password" });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe("INVALID_CREDENTIALS");
  });

  it("4. does not disclose whether a tenant and identity combination exists", async () => {
    const response = await login({ tenantCode: "UNKNOWN", loginIdentity: "shared-login", password: validPassword });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual(expect.objectContaining({ error: expect.objectContaining({ code: "INVALID_CREDENTIALS" }) }));
  });

  it("5. stores only an Argon2id hash", async () => {
    const result = await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerUserId, roles: [] }, (client) =>
      client.query<{ password_hash: string }>("SELECT password_hash FROM app_user_password_credential WHERE user_id = $1", [ownerUserId]),
      { runtimeRole });
    expect(result.rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
    expect(result.rows[0]!.password_hash).not.toContain(validPassword);
  });

  it("6. cannot authenticate with loginIdentity alone", async () => {
    const response = await login({ loginIdentity: "shared-login", password: validPassword });
    expect(response.statusCode).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_FAILED");
  });

  it("7. rejects /auth/me without a token", async () => {
    const response = await server.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe("AUTHENTICATION_REQUIRED");
  });

  it("8. rejects /auth/me with an invalid token", async () => {
    const response = await server.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: "Bearer invalid" } });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe("INVALID_ACCESS_TOKEN");
  });

  it("9. returns authoritative tenant and effective roles", async () => {
    const response = await server.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${ownerToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { id: String(ownerUserId), tenantId: String(tenantA), roles: [{ code: "OWNER", name: "Owner" }] } });
  });

  it("10. supports an AppUser without Staff", async () => {
    const response = await server.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${ownerToken}` } });
    expect(response.json()).toMatchObject({ data: { staff: null } });
  });

  it("11. returns the linked Staff summary", async () => {
    const response = await login({ tenantCode: "AUTH_A", loginIdentity: "route-staff", password: validPassword });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { user: { id: String(staffUserId), staff: { staffId: String(staffId), employeeCode: "RS-001" } } } });
  });

  it("12. keeps normal runtime credential reads tenant-isolated", async () => {
    const result = await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerUserId, roles: [] }, (client) =>
      client.query<{ tenant_id: number }>("SELECT tenant_id FROM app_user_password_credential ORDER BY user_id"),
      { runtimeRole });
    expect(result.rows.length).toBe(2);
    expect(result.rows.every((row) => row.tenant_id === tenantA)).toBe(true);
  });

  it("13. locks an account for 15 minutes after five failed attempts", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login({ tenantCode: "AUTH_A", loginIdentity: "route-staff", password: "incorrect-password" });
      expect(errorCode(response)).toBe("INVALID_CREDENTIALS");
    }
    const state = await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerUserId, roles: [] }, (client) =>
      client.query<{ failed_attempt_count: number; locked_until: Date }>(
        "SELECT failed_attempt_count, locked_until FROM app_user_password_credential WHERE user_id = $1", [staffUserId]
      ), { runtimeRole });
    expect(state.rows[0]!.failed_attempt_count).toBe(5);
    expect(new Date(state.rows[0]!.locked_until).getTime()).toBeGreaterThan(Date.now());
    expect((await login({ tenantCode: "AUTH_A", loginIdentity: "route-staff", password: validPassword })).statusCode).toBe(401);
  });

  it("14. resets failed state after successful authentication", async () => {
    await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerUserId, roles: [] }, (client) =>
      client.query("UPDATE app_user_password_credential SET locked_until = NOW() - INTERVAL '1 second' WHERE user_id = $1", [staffUserId]),
      { runtimeRole });
    expect((await login({ tenantCode: "AUTH_A", loginIdentity: "route-staff", password: validPassword })).statusCode).toBe(200);
    const state = await withTenantTransaction(seedPool, { tenantId: tenantA, userId: ownerUserId, roles: [] }, (client) =>
      client.query<{ failed_attempt_count: number; locked_until: Date | null }>(
        "SELECT failed_attempt_count, locked_until FROM app_user_password_credential WHERE user_id = $1", [staffUserId]
      ), { runtimeRole });
    expect(state.rows[0]).toMatchObject({ failed_attempt_count: 0, locked_until: null });
  });

  it("15. enforces JWT expiry", async () => {
    const expired = await jwt.signAsync({ sub: String(ownerUserId), tenantId: tenantA }, { expiresIn: -1 });
    const response = await server.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${expired}` } });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe("INVALID_ACCESS_TOKEN");
  });

  it("16. never returns password or password-hash fields", async () => {
    const response = await login({ tenantCode: "AUTH_A", loginIdentity: "shared-login", password: validPassword });
    const serialized = JSON.stringify(response.json());
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("password_hash");
    expect(serialized).not.toContain("passwordHash");
  });
});
