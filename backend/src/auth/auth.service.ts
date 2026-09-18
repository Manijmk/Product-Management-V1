import { HttpStatus, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { argon2id, hash, verify } from "argon2";
import { ApiError } from "../http/api-error.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";
import { AuthRepository } from "./auth.repository.js";
import type { LoginDto } from "./dto/login.dto.js";

const ACCESS_TOKEN_SECONDS = 1_800;
const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_MILLISECONDS = 15 * 60 * 1_000;
const ARGON2_OPTIONS = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const dummyPasswordHash = hash("pms-dummy-local-authentication-password", ARGON2_OPTIONS);

function invalidCredentials(): ApiError {
  return new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "The supplied credentials are invalid");
}

async function passwordMatches(hashValue: string, password: string): Promise<boolean> {
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly transactions: PrismaTenantTransactionService,
    private readonly repository: AuthRepository
  ) {}

  async login(input: LoginDto) {
    const identity = await this.repository.lookupLocalPasswordIdentity(input.tenantCode, input.loginIdentity);
    if (identity === null) {
      await passwordMatches(await dummyPasswordHash, input.password);
      throw invalidCredentials();
    }

    const tenantId = Number(identity.tenant_id);
    const userId = Number(identity.user_id);
    const context: AuthenticatedTenantContext = { tenantId, userId, roles: [] };
    const result = await this.transactions.run(context, async (transaction) => {
      await this.repository.lockCredential(transaction, tenantId, userId);
      const credential = await this.repository.findCredential(transaction, tenantId, userId);
      if (credential === null) return { authenticated: false as const };

      const matches = await passwordMatches(credential.password_hash, input.password);
      const now = new Date();
      if (credential.locked_until !== null && credential.locked_until > now) {
        return { authenticated: false as const };
      }
      if (!matches) {
        const failedAttemptCount = credential.failed_attempt_count + 1;
        const lockedUntil = failedAttemptCount >= LOCKOUT_ATTEMPTS
          ? new Date(now.getTime() + LOCKOUT_MILLISECONDS)
          : null;
        await this.repository.recordFailedAttempt(transaction, tenantId, userId, failedAttemptCount, lockedUntil);
        return { authenticated: false as const };
      }

      const userContext = await this.repository.findUserContext(transaction, tenantId, userId);
      if (userContext === null) return { authenticated: false as const };
      await this.repository.recordSuccessfulLogin(transaction, tenantId, userId);
      return { authenticated: true as const, userContext };
    });

    if (!result.authenticated) throw invalidCredentials();
    const roles = result.userContext.assignments.map(({ role }) => ({ code: role.role_code, name: role.role_name }));
    const accessToken = await this.jwt.signAsync({ sub: String(userId), tenantId });
    return {
      accessToken,
      tokenType: "Bearer" as const,
      expiresIn: ACCESS_TOKEN_SECONDS,
      user: {
        id: String(userId),
        displayName: result.userContext.user.displayName,
        tenantId: String(tenantId),
        roles,
        staff: result.userContext.staff === null ? null : {
          staffId: result.userContext.staff.staff_id.toString(),
          employeeCode: result.userContext.staff.employee_code,
          name: result.userContext.staff.name,
          staffType: result.userContext.staff.staff_type,
          status: result.userContext.staff.status
        }
      }
    };
  }

  me(context: AuthenticatedTenantContext) {
    return this.transactions.run(context, async (transaction) => {
      const userContext = await this.repository.findUserContext(transaction, context.tenantId, context.userId);
      if (userContext === null) {
        throw new ApiError(HttpStatus.UNAUTHORIZED, "AUTHENTICATED_USER_INACTIVE", "The authenticated user is not active");
      }
      return {
        id: String(context.userId),
        displayName: userContext.user.displayName,
        tenantId: String(context.tenantId),
        roles: userContext.assignments.map(({ role }) => ({ code: role.role_code, name: role.role_name })),
        staff: userContext.staff === null ? null : {
          staffId: userContext.staff.staff_id.toString(),
          employeeCode: userContext.staff.employee_code,
          name: userContext.staff.name,
          staffType: userContext.staff.staff_type,
          status: userContext.staff.status
        }
      };
    });
  }

  logout() {
    return { loggedOut: true };
  }
}
