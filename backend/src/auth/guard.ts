import type { FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { AppError } from "../http/errors.js";
import { withTenantTransaction } from "../db/transaction.js";
import type { AuthContext, RoleCode } from "./types.js";

export function createAuthenticate(pool: Pool, runtimeRole: string | undefined) {
  return async function authenticate(request: FastifyRequest): Promise<void> {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(401, "AUTHENTICATION_REQUIRED", "A valid access token is required");
    }
    const tenantId = Number(request.user.tenantId);
    const userId = Number(request.user.sub);
    const context = await withTenantTransaction(pool, tenantId, runtimeRole, async (db) => {
      const result = await db.query<{
        user_id: number;
        staff_id: number | null;
        roles: string[];
      }>(
        `SELECT u.user_id, s.staff_id,
                COALESCE(array_agg(r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS roles
           FROM app_user u
           LEFT JOIN staff s ON s.tenant_id=u.tenant_id AND s.user_id=u.user_id AND s.status='ACTIVE'
           LEFT JOIN user_role ur ON ur.tenant_id=u.tenant_id AND ur.user_id=u.user_id
           LEFT JOIN role r ON r.tenant_id=ur.tenant_id AND r.role_id=ur.role_id AND r.status='ACTIVE'
          WHERE u.user_id=$1 AND u.status='ACTIVE'
          GROUP BY u.user_id, s.staff_id`,
        [userId]
      );
      return result.rows[0];
    });
    if (!context) throw new AppError(401, "AUTHENTICATED_USER_NOT_FOUND", "Authenticated user is inactive or missing");
    request.auth = {
      tenantId,
      userId: context.user_id,
      ...(context.staff_id ? { staffId: context.staff_id } : {}),
      roles: context.roles.filter((role): role is RoleCode => ["OWNER", "ADMIN", "ROUTE_STAFF"].includes(role))
    };
  };
}

export function requireRoles(...allowed: RoleCode[]) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!request.auth.roles.some((role) => allowed.includes(role))) {
      throw new AppError(403, "FORBIDDEN", "The authenticated user does not have permission for this operation");
    }
  };
}
