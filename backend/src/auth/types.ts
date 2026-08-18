export const roleCodes = ["OWNER", "ADMIN", "ROUTE_STAFF"] as const;
export type RoleCode = (typeof roleCodes)[number];

export interface AuthContext {
  tenantId: number;
  userId: number;
  staffId?: number;
  roles: RoleCode[];
}

export interface TokenClaims {
  sub: string;
  tenantId: number;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenClaims;
    user: TokenClaims;
  }
}
