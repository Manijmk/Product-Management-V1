import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import type { PinoLogger } from "nestjs-pino";
import { InjectPinoLogger } from "nestjs-pino";
import { ApiError } from "../http/api-error.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";
import { PUBLIC_ENDPOINT } from "./auth.decorators.js";
import type { AccessTokenClaims, AuthenticatedRequest } from "./auth.types.js";

function parsePositiveSafeInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly transactions: PrismaTenantTransactionService,
    @InjectPinoLogger(AuthenticationGuard.name) private readonly logger: PinoLogger
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ENDPOINT, [
      executionContext.getHandler(),
      executionContext.getClass()
    ]) === true) {
      return true;
    }

    const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "A bearer token is required");
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(header.slice(7));
    } catch {
      throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_ACCESS_TOKEN", "The access token is invalid or expired");
    }

    const tenantId = parsePositiveSafeInteger(claims.tenantId);
    const userId = parsePositiveSafeInteger(claims.sub);
    if (tenantId === undefined || userId === undefined) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_ACCESS_TOKEN", "The access token context is invalid");
    }

    const provisional: AuthenticatedTenantContext = { tenantId, userId, roles: [] };
    const identity = await this.transactions.run(provisional, async (transaction) => {
      const user = await transaction.appUser.findFirst({
        where: { tenantId: BigInt(tenantId), userId: BigInt(userId), status: "ACTIVE" },
        select: { userId: true }
      });
      if (user === null) return undefined;
      const assignments = await transaction.user_role.findMany({
        where: { tenant_id: BigInt(tenantId), user_id: BigInt(userId), role: { status: "ACTIVE" } },
        select: { role: { select: { role_code: true } } }
      });
      return assignments.map((assignment) => assignment.role.role_code);
    });

    if (identity === undefined) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, "AUTHENTICATED_USER_INACTIVE", "The authenticated user is not active");
    }

    request.auth = { tenantId, userId, roles: identity };
    this.logger.assign({ tenantId, userId, roles: identity });
    return true;
  }
}
