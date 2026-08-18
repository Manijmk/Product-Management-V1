import type { AuthContext } from "../auth/types.js";
import { withTenantTransaction } from "../db/transaction.js";
import { AppError, notFound } from "../http/errors.js";
import type { ServiceDeps } from "./deps.js";

export class CatalogService {
  constructor(private readonly deps: ServiceDeps) {}

  private tx<T>(auth: AuthContext, work: Parameters<typeof withTenantTransaction<T>>[3]) {
    return withTenantTransaction(this.deps.pool, auth.tenantId, this.deps.config.DATABASE_RUNTIME_ROLE, work);
  }

  listProducts(auth: AuthContext) {
    return this.tx(auth, async (db) => (await db.query("SELECT * FROM product ORDER BY product_id")).rows);
  }

  createProduct(auth: AuthContext, input: { productCode: string; name: string; unitType: string; exchangeRatio?: number }) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `INSERT INTO product (tenant_id, product_code, name, unit_type, exchange_ratio, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [auth.tenantId, input.productCode, input.name, input.unitType, input.exchangeRatio ?? null, auth.userId]
      );
      return result.rows[0];
    });
  }

  addProductPrice(auth: AuthContext, productId: number, input: { price: number; effectiveFrom: string; effectiveTo?: string }) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `INSERT INTO product_price (tenant_id, product_id, price, effective_from, effective_to, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [auth.tenantId, productId, input.price, input.effectiveFrom, input.effectiveTo ?? null, auth.userId]
      );
      return result.rows[0];
    });
  }

  addDamageRate(auth: AuthContext, productId: number, input: { damageType: string; rate: number; effectiveFrom: string; effectiveTo?: string }) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `INSERT INTO product_damage_rate
           (tenant_id, product_id, damage_type, rate, effective_from, effective_to, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [auth.tenantId, productId, input.damageType, input.rate, input.effectiveFrom, input.effectiveTo ?? null, auth.userId]
      );
      return result.rows[0];
    });
  }

  listCustomers(auth: AuthContext) {
    return this.tx(auth, async (db) => (await db.query("SELECT * FROM party ORDER BY party_id")).rows);
  }

  createCustomer(auth: AuthContext, input: {
    name: string;
    mobile?: string;
    relationshipType: string;
    creationMode: "TEMPORARY" | "PERMANENT";
  }) {
    return this.tx(auth, async (db) => {
      const privileged = auth.roles.some((role) => role === "OWNER" || role === "ADMIN");
      const status = input.creationMode === "TEMPORARY" ? "TEMPORARY" : privileged ? "ACTIVE" : "PENDING_APPROVAL";
      const source = privileged ? "ADMIN" : "STAFF";
      const result = await db.query(
        `INSERT INTO party
          (tenant_id,name,mobile,relationship_type,customer_status,created_source,created_by_user_id,approved_by_user_id,approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          auth.tenantId,
          input.name,
          input.mobile ?? null,
          input.relationshipType,
          status,
          source,
          auth.userId,
          status === "ACTIVE" ? auth.userId : null,
          status === "ACTIVE" ? new Date() : null
        ]
      );
      return result.rows[0];
    });
  }

  approveCustomer(auth: AuthContext, partyId: number) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `UPDATE party SET customer_status='ACTIVE', approved_by_user_id=$2, approved_at=NOW()
          WHERE party_id=$1 AND customer_status='PENDING_APPROVAL' RETURNING *`,
        [partyId, auth.userId]
      );
      return result.rows[0] ?? notFound("customer");
    });
  }

  addCustomerProduct(auth: AuthContext, partyId: number, input: {
    productId: number;
    quantityMode: string;
    defaultQty?: number;
    forecastQty?: number;
    exchangePolicy?: string;
  }) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `INSERT INTO party_product
          (tenant_id,party_id,product_id,quantity_mode,default_qty,forecast_qty,exchange_policy,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [auth.tenantId, partyId, input.productId, input.quantityMode, input.defaultQty ?? null, input.forecastQty ?? null, input.exchangePolicy ?? null, auth.userId]
      );
      return result.rows[0];
    });
  }

  addCustomerPrice(auth: AuthContext, partyId: number, productId: number, input: { price: number; effectiveFrom: string; effectiveTo?: string }) {
    return this.tx(auth, async (db) => {
      const canApprove = auth.roles.some((role) => role === "OWNER" || role === "ADMIN");
      const result = await db.query(
        `INSERT INTO party_product_price
          (tenant_id,party_id,product_id,price,effective_from,effective_to,approval_status,created_by_user_id,approved_by_user_id,approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [auth.tenantId, partyId, productId, input.price, input.effectiveFrom, input.effectiveTo ?? null,
          canApprove ? "APPROVED" : "PENDING", auth.userId, canApprove ? auth.userId : null, canApprove ? new Date() : null]
      );
      return result.rows[0];
    });
  }

  listVehicles(auth: AuthContext) {
    return this.tx(auth, async (db) => (await db.query("SELECT * FROM vehicle ORDER BY vehicle_id")).rows);
  }

  createVehicle(auth: AuthContext, input: { registrationNo: string; vehicleType: string; capacity?: number; capacityUnit?: string; ownershipType?: string }) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `INSERT INTO vehicle (tenant_id,registration_no,vehicle_type,capacity,capacity_unit,ownership_type,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [auth.tenantId, input.registrationNo, input.vehicleType, input.capacity ?? null, input.capacityUnit ?? null, input.ownershipType ?? "OWNED", auth.userId]
      );
      return result.rows[0];
    });
  }

  listStaff(auth: AuthContext) {
    return this.tx(auth, async (db) => (await db.query("SELECT * FROM staff ORDER BY staff_id")).rows);
  }

  createStaff(auth: AuthContext, input: { userId?: number; employeeCode?: string; name: string; mobile?: string; staffType: string }) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `INSERT INTO staff (tenant_id,user_id,employee_code,name,mobile,staff_type,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [auth.tenantId, input.userId ?? null, input.employeeCode ?? null, input.name, input.mobile ?? null, input.staffType, auth.userId]
      );
      return result.rows[0];
    });
  }

  async getMe(auth: AuthContext) {
    return this.tx(auth, async (db) => {
      const row = (await db.query("SELECT user_id,login_identity,mobile,email,display_name,status FROM app_user WHERE user_id=$1", [auth.userId])).rows[0];
      if (!row) throw new AppError(404, "USER_NOT_FOUND", "Authenticated user was not found");
      return { ...row, roles: auth.roles, staffId: auth.staffId ?? null };
    });
  }
}
