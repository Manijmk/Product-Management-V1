import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AppConfig } from "../config/env.js";
import { PrismaService } from "../infrastructure/prisma.service.js";
import { APP_CONFIG } from "../infrastructure/tokens.js";
import type { TenantPrismaTransaction } from "../tenancy/prisma-tenant-transaction.service.js";

export interface LocalPasswordIdentity {
  tenant_id: bigint;
  user_id: bigint;
  display_name: string | null;
  password_hash: string;
  failed_attempt_count: number;
  locked_until: Date | null;
}

@Injectable()
export class AuthRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  lookupLocalPasswordIdentity(tenantCode: string, loginIdentity: string): Promise<LocalPasswordIdentity | null> {
    return this.prisma.$transaction(async (transaction) => {
      if (this.config.DATABASE_RUNTIME_ROLE !== undefined) {
        await transaction.$executeRawUnsafe(`SET LOCAL ROLE "${this.config.DATABASE_RUNTIME_ROLE}"`);
      }
      const rows = await transaction.$queryRaw<LocalPasswordIdentity[]>(
        Prisma.sql`SELECT * FROM pms.lookup_local_password_identity(${tenantCode}, ${loginIdentity})`
      );
      return rows[0] ?? null;
    });
  }

  async lockCredential(transaction: TenantPrismaTransaction, tenantId: number, userId: number): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`local-auth:${tenantId}:${userId}`}, 0))`
    );
  }

  findCredential(transaction: TenantPrismaTransaction, tenantId: number, userId: number) {
    return transaction.app_user_password_credential.findUnique({
      where: { tenant_id_user_id: { tenant_id: BigInt(tenantId), user_id: BigInt(userId) } },
      select: { password_hash: true, failed_attempt_count: true, locked_until: true }
    });
  }

  recordFailedAttempt(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    userId: number,
    failedAttemptCount: number,
    lockedUntil: Date | null
  ) {
    return transaction.app_user_password_credential.update({
      where: { tenant_id_user_id: { tenant_id: BigInt(tenantId), user_id: BigInt(userId) } },
      data: { failed_attempt_count: failedAttemptCount, locked_until: lockedUntil }
    });
  }

  async recordSuccessfulLogin(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    userId: number
  ): Promise<void> {
    await transaction.app_user_password_credential.update({
      where: { tenant_id_user_id: { tenant_id: BigInt(tenantId), user_id: BigInt(userId) } },
      data: { failed_attempt_count: 0, locked_until: null }
    });
    await transaction.appUser.update({
      where: { tenantId_userId: { tenantId: BigInt(tenantId), userId: BigInt(userId) } },
      data: { lastLoginAt: new Date() }
    });
  }

  async findUserContext(transaction: TenantPrismaTransaction, tenantId: number, userId: number) {
    const user = await transaction.appUser.findFirst({
      where: { tenantId: BigInt(tenantId), userId: BigInt(userId), status: "ACTIVE" },
      select: { userId: true, tenantId: true, displayName: true }
    });
    if (user === null) return null;
    const [assignments, staff] = await Promise.all([
      transaction.user_role.findMany({
        where: { tenant_id: BigInt(tenantId), user_id: BigInt(userId), role: { status: "ACTIVE" } },
        orderBy: { role: { role_code: "asc" } },
        select: { role: { select: { role_code: true, role_name: true } } }
      }),
      transaction.staff.findFirst({
        where: { tenant_id: BigInt(tenantId), user_id: BigInt(userId), status: "ACTIVE" },
        orderBy: { staff_id: "asc" },
        select: { staff_id: true, employee_code: true, name: true, staff_type: true, status: true }
      })
    ]);
    return { user, assignments, staff };
  }
}
