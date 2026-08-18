import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import path from "node:path";
import pg from "pg";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import { createPool } from "../../src/db/pool.js";
import { applyMigrations, FOUNDATION_MIGRATIONS } from "../../src/db/migrations.js";
import { withSystemTransaction, withTenantTransaction } from "../../src/db/transaction.js";
import type { AuthenticatedTenantContext } from "../../src/tenancy/authenticated-tenant-context.js";

const { Pool } = pg;
const migrationDirectory = path.resolve(process.cwd(), "../database");
const runtimeRole = "pms_app";

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let firstMigrationRun: string[];
let tenantA: number;
let tenantB: number;
let tenantAUserId: number;
let tenantAStaffId: number;

function context(tenantId: number): AuthenticatedTenantContext {
  return { tenantId, userId: 1, roles: ["TEST"] };
}

async function seedTenantData(
  tenantId: number,
  code: string
): Promise<{ userId: number; staffId: number }> {
  return withTenantTransaction(pool, context(tenantId), async (client) => {
    const user = (await client.query<{ user_id: number }>(
      `INSERT INTO app_user (tenant_id, login_identity, display_name)
       VALUES ($1, $2, $3)
       RETURNING user_id`,
      [tenantId, `${code}-user`, `${code} User`]
    )).rows[0]!;
    const staff = (await client.query<{ staff_id: number }>(
      `INSERT INTO staff (tenant_id, user_id, name, staff_type)
       VALUES ($1, $2, $3, 'DELIVERY_STAFF')
       RETURNING staff_id`,
      [tenantId, user.user_id, `${code} Staff`]
    )).rows[0]!;
    await client.query(
      `INSERT INTO product (tenant_id, product_code, name, unit_type, exchange_ratio)
       VALUES ($1, $2, $3, 'EXCHANGE', 1)`,
      [tenantId, `${code}_PRODUCT`, `${code} Product`]
    );
    const trip = (await client.query<{ trip_id: number }>(
      `INSERT INTO trip (tenant_id, trip_number, trip_date)
       VALUES ($1, $2, CURRENT_DATE)
       RETURNING trip_id`,
      [tenantId, `${code}-VIEW-TRIP`]
    )).rows[0]!;
    await client.query(
      `INSERT INTO trip_reconciliation
         (tenant_id, trip_id, reconciliation_number)
       VALUES ($1, $2, $3)`,
      [tenantId, trip.trip_id, `${code}-VIEW-RECON`]
    );
    return { userId: user.user_id, staffId: staff.staff_id };
  }, { runtimeRole });
}

async function createTrip(tenantId: number, suffix: string): Promise<number> {
  return withTenantTransaction(pool, context(tenantId), async (client) => {
    const result = await client.query<{ trip_id: number }>(
      `INSERT INTO trip (tenant_id, trip_number, trip_date)
       VALUES ($1, $2, CURRENT_DATE)
       RETURNING trip_id`,
      [tenantId, `A-${suffix}`]
    );
    return result.rows[0]!.trip_id;
  }, { runtimeRole });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri(), max: 10 });
  firstMigrationRun = await applyMigrations(pool, migrationDirectory);

  [tenantA, tenantB] = await withSystemTransaction(pool, async (client) => {
    const rows = await client.query<{ tenant_id: number }>(
      `INSERT INTO pms.tenant (tenant_code, name, business_type)
       VALUES ('TENANT_A', 'Tenant A', 'ROUTE_DELIVERY'),
              ('TENANT_B', 'Tenant B', 'ROUTE_DELIVERY')
       RETURNING tenant_id`
    );
    return [rows.rows[0]!.tenant_id, rows.rows[1]!.tenant_id];
  });

  const tenantAIdentity = await seedTenantData(tenantA, "A");
  await seedTenantData(tenantB, "B");
  tenantAUserId = tenantAIdentity.userId;
  tenantAStaffId = tenantAIdentity.staffId;
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("authoritative database bootstrap", () => {
  it("applies exactly migrations 001 through 006 and is idempotent", async () => {
    expect(firstMigrationRun).toEqual([...FOUNDATION_MIGRATIONS]);

    const recorded = await pool.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM public.pms_schema_migration ORDER BY filename"
    );
    expect(recorded.rows.map((row) => row.filename)).toEqual([...FOUNDATION_MIGRATIONS]);
    expect(recorded.rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
    await expect(applyMigrations(pool, migrationDirectory)).resolves.toEqual([]);
  });

  it("keeps RLS enabled and forced on every tenant-owned base table", async () => {
    const result = await pool.query<{
      table_name: string;
      row_security: boolean;
      force_row_security: boolean;
    }>(
      `SELECT c.relname AS table_name,
              c.relrowsecurity AS row_security,
              c.relforcerowsecurity AS force_row_security
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN information_schema.columns col
           ON col.table_schema = n.nspname
          AND col.table_name = c.relname
          AND col.column_name = 'tenant_id'
        WHERE n.nspname = 'pms'
          AND c.relkind = 'r'
          AND c.relname <> 'tenant'
        ORDER BY c.relname`
    );

    expect(result.rows.length).toBeGreaterThan(20);
    expect(result.rows.every((row) => row.row_security && row.force_row_security)).toBe(true);
  });

  it("boots NestJS on Fastify with health and OpenAPI only", async () => {
    const config: AppConfig = {
      NODE_ENV: "test",
      APP_NAME: "pms-backend-test",
      APP_PORT: 4000,
      DATABASE_URL: container.getConnectionUri(),
      DATABASE_POOL_MIN: 0,
      DATABASE_POOL_MAX: 5,
      DATABASE_RUNTIME_ROLE: runtimeRole,
      AUTH_JWT_SECRET: "test-secret-that-is-at-least-32-characters",
      AUTH_JWT_ISSUER: "pms-backend",
      AUTH_JWT_AUDIENCE: "pms-api",
      LOG_LEVEL: "silent",
      SWAGGER_ENABLED: true
    };
    const appPool = createPool(config);
    let app: NestFastifyApplication | undefined;
    try {
      app = await buildApp(config, appPool);
      const server = app.getHttpAdapter().getInstance() as FastifyInstance;
      await server.ready();

      const health = await server.inject({ method: "GET", url: "/api/v1/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: "ok", database: "reachable" });

      const openApi = await server.inject({ method: "GET", url: "/api/docs-json" });
      expect(openApi.statusCode).toBe(200);
      expect(openApi.json().paths).toEqual(expect.objectContaining({
        "/api/v1/health": expect.any(Object),
        "/api/v1/products": expect.any(Object),
        "/api/v1/customers": expect.any(Object)
      }));
    } finally {
      await app?.close();
      await appPool.end();
    }
  });
});

describe("runtime role and PostgreSQL RLS", () => {
  it("is NOLOGIN, non-superuser, non-BYPASSRLS, and owns no tenant table", async () => {
    const role = (await pool.query<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
    }>(
      `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb,
              rolcreaterole, rolreplication
         FROM pg_roles
        WHERE rolname = $1`,
      [runtimeRole]
    )).rows[0]!;
    expect(role).toEqual({
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false
    });

    const ownership = await pool.query(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'pms'
          AND c.relkind IN ('r', 'p')
          AND r.rolname = $1
          AND EXISTS (
              SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = c.oid
                 AND a.attname = 'tenant_id'
                 AND NOT a.attisdropped
          )`,
      [runtimeRole]
    );
    expect(ownership.rowCount).toBe(0);

    const memberships = await pool.query(
      `SELECT parent_role.rolname
         FROM pg_auth_members membership
         JOIN pg_roles member_role ON member_role.oid = membership.member
         JOIN pg_roles parent_role ON parent_role.oid = membership.roleid
        WHERE member_role.rolname = $1`,
      [runtimeRole]
    );
    expect(memberships.rowCount).toBe(0);
  });

  it("has append-only ledger privileges and no tenant-registry access", async () => {
    const privileges = (await pool.query<{
      tenant_select: boolean;
      product_delete: boolean;
      ledger_insert: boolean;
      ledger_update: boolean;
      ledger_delete: boolean;
    }>(
      `SELECT
         has_table_privilege($1, 'pms.tenant', 'SELECT') AS tenant_select,
         has_table_privilege($1, 'pms.product', 'DELETE') AS product_delete,
         has_table_privilege($1, 'pms.inventory_ledger_entry', 'INSERT') AS ledger_insert,
         has_table_privilege($1, 'pms.inventory_ledger_entry', 'UPDATE') AS ledger_update,
         has_table_privilege($1, 'pms.inventory_ledger_entry', 'DELETE') AS ledger_delete`,
      [runtimeRole]
    )).rows[0]!;
    expect(privileges).toEqual({
      tenant_select: false,
      product_delete: false,
      ledger_insert: true,
      ledger_update: false,
      ledger_delete: false
    });
  });

  it("sets transaction-local tenant context from authenticated server context", async () => {
    const setting = await withTenantTransaction(
      pool,
      context(tenantA),
      async (client) => {
        const result = await client.query<{ tenant_id: string; current_role: string }>(
          "SELECT current_setting('app.tenant_id') AS tenant_id, current_user AS current_role"
        );
        return result.rows[0]!;
      },
      { runtimeRole }
    );

    expect(setting).toEqual({ tenant_id: String(tenantA), current_role: runtimeRole });
  });

  it("filters cross-tenant reads and rejects Tenant A writes for Tenant B", async () => {
    const tenantARows = await withTenantTransaction(
      pool,
      context(tenantA),
      async (client) => (await client.query<{ product_code: string }>(
        "SELECT product_code FROM product ORDER BY product_code"
      )).rows,
      { runtimeRole }
    );
    expect(tenantARows.map((row) => row.product_code)).toEqual(["A_PRODUCT"]);

    await expect(withTenantTransaction(
      pool,
      context(tenantA),
      (client) => client.query(
        `INSERT INTO product (tenant_id, product_code, name, unit_type, exchange_ratio)
         VALUES ($1, 'CROSS_TENANT', 'Cross Tenant Product', 'EXCHANGE', 1)`,
        [tenantB]
      ),
      { runtimeRole }
    )).rejects.toMatchObject({ code: "42501" });
  });

  it("marks every tenant-sensitive derived view security_invoker and isolates view rows", async () => {
    const viewSecurity = await pool.query<{ view_name: string; reloptions: string[] | null }>(
      `SELECT c.relname AS view_name, c.reloptions
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'pms'
          AND c.relname = ANY($1::text[])
        ORDER BY c.relname`,
      [[
        "stock_on_hand_view",
        "customer_container_balance_view",
        "customer_balance_view",
        "staff_cash_in_hand_view",
        "trip_reconciliation_summary_view"
      ]]
    );
    expect(viewSecurity.rows).toHaveLength(5);
    expect(viewSecurity.rows.every((row) =>
      row.reloptions?.includes("security_invoker=true") === true
    )).toBe(true);

    const tenantAViews = await withTenantTransaction(
      pool,
      context(tenantA),
      async (client) => (await client.query<{ tenant_id: number; reconciliation_number: string }>(
        "SELECT tenant_id, reconciliation_number FROM trip_reconciliation_summary_view"
      )).rows,
      { runtimeRole }
    );
    expect(tenantAViews).toEqual([{
      tenant_id: tenantA,
      reconciliation_number: "A-VIEW-RECON"
    }]);
  });

  it("returns no tenant base-table or derived-view rows without app.tenant_id", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${runtimeRole}`);
      const products = await client.query("SELECT product_code FROM pms.product");
      const reconciliations = await client.query(
        "SELECT reconciliation_number FROM pms.trip_reconciliation_summary_view"
      );
      expect(products.rowCount).toBe(0);
      expect(reconciliations.rowCount).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});

describe("reconciliation submitter constraint", () => {
  it("allows OPEN reconciliation without a submitter", async () => {
    const tripId = await createTrip(tenantA, "OPEN-NO-SUBMITTER");
    const result = await withTenantTransaction(pool, context(tenantA), (client) => client.query(
      `INSERT INTO trip_reconciliation
         (tenant_id, trip_id, reconciliation_number)
       VALUES ($1, $2, 'A-OPEN-NO-SUBMITTER')
       RETURNING status, submitted_by_staff_id, submitted_by_user_id`,
      [tenantA, tripId]
    ), { runtimeRole });
    expect(result.rows[0]).toMatchObject({
      status: "OPEN",
      submitted_by_staff_id: null,
      submitted_by_user_id: null
    });
  });

  it("rejects SUBMITTED reconciliation without a submitter", async () => {
    const tripId = await createTrip(tenantA, "SUBMITTED-NO-SUBMITTER");
    await expect(withTenantTransaction(pool, context(tenantA), (client) => client.query(
      `INSERT INTO trip_reconciliation
         (tenant_id, trip_id, reconciliation_number, status, submitted_at)
       VALUES ($1, $2, 'A-SUBMITTED-NO-SUBMITTER', 'SUBMITTED', NOW())`,
      [tenantA, tripId]
    ), { runtimeRole })).rejects.toMatchObject({
      code: "23514",
      constraint: "ck_trip_recon_submit_actor"
    });
  });

  it("allows SUBMITTED reconciliation with a staff or user submitter", async () => {
    const staffTripId = await createTrip(tenantA, "SUBMITTED-BY-STAFF");
    const userTripId = await createTrip(tenantA, "SUBMITTED-BY-USER");

    await expect(withTenantTransaction(pool, context(tenantA), (client) => client.query(
      `INSERT INTO trip_reconciliation
         (tenant_id, trip_id, reconciliation_number, status, submitted_at, submitted_by_staff_id)
       VALUES ($1, $2, 'A-SUBMITTED-BY-STAFF', 'SUBMITTED', NOW(), $3)`,
      [tenantA, staffTripId, tenantAStaffId]
    ), { runtimeRole })).resolves.toBeDefined();

    await expect(withTenantTransaction(pool, context(tenantA), (client) => client.query(
      `INSERT INTO trip_reconciliation
         (tenant_id, trip_id, reconciliation_number, status, submitted_at, submitted_by_user_id)
       VALUES ($1, $2, 'A-SUBMITTED-BY-USER', 'SUBMITTED', NOW(), $3)`,
      [tenantA, userTripId, tenantAUserId]
    ), { runtimeRole })).resolves.toBeDefined();
  });
});
