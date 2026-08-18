import { loadConfig } from "../config/env.js";
import { createPool } from "./pool.js";
import { withSystemTransaction, withTenantTransaction } from "./transaction.js";

const config = loadConfig();
const pool = createPool(config);
try {
  const tenantId = await withSystemTransaction(pool, async (db) => {
    const result = await db.query<{ tenant_id: number }>(
      `INSERT INTO pms.tenant (tenant_code,name,business_type)
       VALUES ('DEMO','PMS Demo Operations','ROUTE_DELIVERY')
       ON CONFLICT (tenant_code) DO UPDATE SET name=EXCLUDED.name
       RETURNING tenant_id`
    );
    return result.rows[0]!.tenant_id;
  });
  await withTenantTransaction(pool, tenantId, config.DATABASE_RUNTIME_ROLE, async (db) => {
    const user = (await db.query<{ user_id: number }>(
      `INSERT INTO app_user (tenant_id,login_identity,email,display_name)
       VALUES ($1,'owner@demo','owner@demo.local','Demo Owner')
       ON CONFLICT (tenant_id,email) WHERE email IS NOT NULL
       DO UPDATE SET display_name=EXCLUDED.display_name RETURNING user_id`,
      [tenantId]
    )).rows[0]!;
    for (const [code, name] of [["OWNER", "Tenant Owner"], ["ADMIN", "Administrator"], ["ROUTE_STAFF", "Route Staff"]]) {
      await db.query(
        `INSERT INTO role (tenant_id,role_code,role_name) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id,role_code) DO UPDATE SET role_name=EXCLUDED.role_name`,
        [tenantId, code, name]
      );
    }
    await db.query(
      `INSERT INTO user_role (tenant_id,user_id,role_id)
       SELECT $1,$2,role_id FROM role WHERE role_code='OWNER'
       ON CONFLICT DO NOTHING`,
      [tenantId, user.user_id]
    );
  });
  process.stdout.write("Seeded tenant DEMO and development identity owner@demo\n");
} finally {
  await pool.end();
}
