import { loadConfig } from "../config/env.js";
import { createPool } from "./pool.js";
import { withSystemTransaction, withTenantTransaction } from "./transaction.js";
import { argon2id, hash } from "argon2";

const config = loadConfig();
const pool = createPool({ ...config, DATABASE_URL: config.DATABASE_MIGRATION_URL ?? config.DATABASE_URL });
const uatPasswordHash = config.UAT_SEED_PASSWORD === undefined
  ? undefined
  : await hash(config.UAT_SEED_PASSWORD, { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

try {
  const tenantId = await withSystemTransaction(pool, async (client) => {
    const result = await client.query<{ tenant_id: number }>(
      `INSERT INTO pms.tenant (tenant_code, name, business_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING tenant_id`,
      ["UAT_DEMO", "PMS Sprint 0 UAT", "ROUTE_DELIVERY"]
    );
    return result.rows[0]!.tenant_id;
  });

  const summary = await withTenantTransaction(pool, { tenantId, userId: 1, roles: ["SEED"] }, async (client) => {
    for (const roleCode of ["OWNER", "ADMIN", "ROUTE_STAFF"]) {
      await client.query(
        `INSERT INTO role (tenant_id, role_code, role_name)
         VALUES ($1, $2, $3) ON CONFLICT (tenant_id, role_code) DO NOTHING`,
        [tenantId, roleCode, roleCode.replace("_", " ")]
      );
    }
    let owner = await client.query<{ user_id: number }>(
      "SELECT user_id FROM app_user WHERE tenant_id = $1 AND login_identity = $2",
      [tenantId, "uat-owner"]
    );
    if (owner.rowCount === 0) {
      owner = await client.query<{ user_id: number }>(
        `INSERT INTO app_user (tenant_id, login_identity, display_name)
         VALUES ($1, $2, $3) RETURNING user_id`,
        [tenantId, "uat-owner", "UAT Owner"]
      );
    }
    const ownerId = owner.rows[0]!.user_id;
    if (uatPasswordHash !== undefined) {
      await client.query(
        `INSERT INTO app_user_password_credential (tenant_id, user_id, password_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             password_changed_at = NOW(),
             failed_attempt_count = 0,
             locked_until = NULL`,
        [tenantId, ownerId, uatPasswordHash]
      );
    }
    await client.query(
      `INSERT INTO user_role (tenant_id, user_id, role_id, assigned_by_user_id)
       SELECT $1, $2, role_id, $2 FROM role WHERE tenant_id = $1 AND role_code = 'OWNER'
       ON CONFLICT DO NOTHING`,
      [tenantId, ownerId]
    );
    const staff = await client.query<{ staff_id: number }>(
      `INSERT INTO staff (tenant_id, user_id, employee_code, name, staff_type, created_by_user_id)
       VALUES ($1, $2, 'UAT-DRIVER', 'UAT Delivery Staff', 'DELIVERY_STAFF', $2)
       ON CONFLICT (tenant_id, employee_code) WHERE employee_code IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name RETURNING staff_id`,
      [tenantId, ownerId]
    );
    const product = await client.query<{ product_id: number }>(
      `INSERT INTO product (tenant_id, product_code, name, unit_type, exchange_ratio, created_by_user_id)
       VALUES ($1, 'UAT-EXCHANGE', 'UAT Exchange Product', 'EXCHANGE', 1, $2)
       ON CONFLICT (tenant_id, product_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING product_id`,
      [tenantId, ownerId]
    );
    const productId = product.rows[0]!.product_id;
    await client.query(
      `INSERT INTO product_price (tenant_id, product_id, price, effective_from, created_by_user_id)
       SELECT $1, $2, 50, '2025-01-01T00:00:00Z', $3
       WHERE NOT EXISTS (
         SELECT 1 FROM product_price WHERE tenant_id = $1 AND product_id = $2 AND effective_to IS NULL
       )`,
      [tenantId, productId, ownerId]
    );
    await client.query(
      `INSERT INTO product_damage_rate (tenant_id, product_id, damage_type, rate, effective_from, created_by_user_id)
       SELECT $1, $2, 'DAMAGED', 100, '2025-01-01T00:00:00Z', $3
       WHERE NOT EXISTS (
         SELECT 1 FROM product_damage_rate
         WHERE tenant_id = $1 AND product_id = $2 AND damage_type = 'DAMAGED' AND effective_to IS NULL
       )`,
      [tenantId, productId, ownerId]
    );
    const customer = await client.query<{ party_id: number }>(
      `INSERT INTO party (
         tenant_id, party_code, name, relationship_type, customer_status, created_source,
         created_by_user_id, approved_by_user_id, approved_at
       ) VALUES ($1, 'UAT-CUSTOMER', 'UAT Return Matched Shop', 'SUBSCRIPTION_ROUTE', 'ACTIVE', 'ADMIN', $2, $2, NOW())
       ON CONFLICT (tenant_id, party_code) WHERE party_code IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name RETURNING party_id`,
      [tenantId, ownerId]
    );
    const partyId = customer.rows[0]!.party_id;
    const partyProduct = await client.query<{ party_product_id: number }>(
      `INSERT INTO party_product (
         tenant_id, party_id, product_id, quantity_mode, forecast_qty, exchange_policy, created_by_user_id
       ) VALUES ($1, $2, $3, 'RETURN_MATCHED', 10, 'ALLOW_CONTAINER_DUE', $4)
       ON CONFLICT (tenant_id, party_id, product_id) DO UPDATE SET forecast_qty = EXCLUDED.forecast_qty
       RETURNING party_product_id`,
      [tenantId, partyId, productId, ownerId]
    );
    const route = await client.query<{ route_id: number }>(
      `INSERT INTO route (tenant_id, route_code, route_name, created_by_user_id)
       VALUES ($1, 'UAT-ROUTE', 'UAT Route', $2)
       ON CONFLICT (tenant_id, route_code) DO UPDATE SET route_name = EXCLUDED.route_name
       RETURNING route_id`,
      [tenantId, ownerId]
    );
    const routeId = route.rows[0]!.route_id;
    const stop = await client.query<{ route_stop_template_id: number }>(
      `INSERT INTO route_stop_template (tenant_id, route_id, party_id, default_sequence, created_by_user_id)
       VALUES ($1, $2, $3, 10, $4)
       ON CONFLICT (tenant_id, route_id, party_id) DO UPDATE SET default_sequence = EXCLUDED.default_sequence
       RETURNING route_stop_template_id`,
      [tenantId, routeId, partyId, ownerId]
    );
    await client.query(
      `INSERT INTO route_stop_product (
         tenant_id, route_stop_template_id, party_product_id, quantity_mode, forecast_qty, created_by_user_id
       ) VALUES ($1, $2, $3, 'RETURN_MATCHED', 10, $4)
       ON CONFLICT (tenant_id, route_stop_template_id, party_product_id) DO NOTHING`,
      [tenantId, stop.rows[0]!.route_stop_template_id, partyProduct.rows[0]!.party_product_id, ownerId]
    );
    const vehicle = await client.query<{ vehicle_id: number }>(
      `INSERT INTO vehicle (tenant_id, registration_no, vehicle_type, ownership_type, created_by_user_id)
       VALUES ($1, 'UAT-VEHICLE-01', 'DELIVERY_VAN', 'OWNED', $2)
       ON CONFLICT (tenant_id, registration_no) DO UPDATE SET vehicle_type = EXCLUDED.vehicle_type
       RETURNING vehicle_id`,
      [tenantId, ownerId]
    );
    await client.query(
      `INSERT INTO inventory_location (tenant_id, location_code, name, location_type, vehicle_id, created_by_user_id)
       VALUES ($1, $2, 'UAT Vehicle Stock', 'VEHICLE', $3, $4)
       ON CONFLICT (tenant_id, location_code) DO NOTHING`,
      [tenantId, `VEHICLE:${vehicle.rows[0]!.vehicle_id}`, vehicle.rows[0]!.vehicle_id, ownerId]
    );
    return {
      tenantId,
      ownerUserId: ownerId,
      staffId: staff.rows[0]!.staff_id,
      productId,
      partyId,
      routeId,
      localPasswordProvisioned: uatPasswordHash !== undefined
    };
  }, { runtimeRole: config.DATABASE_RUNTIME_ROLE });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} finally {
  await pool.end();
}
