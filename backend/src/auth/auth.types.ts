import type { FastifyRequest } from "fastify";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";

export interface AccessTokenClaims {
  readonly sub: string;
  readonly tenantId: number;
}

export interface AuthenticatedRequest extends FastifyRequest {
  auth: AuthenticatedTenantContext;
}
