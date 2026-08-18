import { Injectable } from "@nestjs/common";
import type { TenantPrismaTransaction } from "../tenancy/prisma-tenant-transaction.service.js";

@Injectable()
export class UsersRepository {
  list(transaction: TenantPrismaTransaction, tenantId: number) {
    return transaction.appUser.findMany({
      where: { tenantId: BigInt(tenantId) },
      orderBy: { userId: "asc" },
      select: {
        userId: true,
        loginIdentity: true,
        mobile: true,
        email: true,
        displayName: true,
        status: true,
        createdAt: true
      }
    });
  }

  findById(transaction: TenantPrismaTransaction, tenantId: number, userId: number) {
    return transaction.appUser.findFirst({
      where: { tenantId: BigInt(tenantId), userId: BigInt(userId) },
      select: { userId: true }
    });
  }

  create(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    actorUserId: number,
    input: { loginIdentity?: string; mobile?: string; email?: string; displayName?: string }
  ) {
    return transaction.appUser.create({
      data: {
        tenantId: BigInt(tenantId),
        createdByUserId: BigInt(actorUserId),
        loginIdentity: input.loginIdentity,
        mobile: input.mobile,
        email: input.email,
        displayName: input.displayName
      },
      select: {
        userId: true,
        loginIdentity: true,
        mobile: true,
        email: true,
        displayName: true,
        status: true,
        createdAt: true
      }
    });
  }

  listRoles(transaction: TenantPrismaTransaction, tenantId: number) {
    return transaction.role.findMany({
      where: { tenant_id: BigInt(tenantId) },
      orderBy: { role_code: "asc" },
      select: { role_id: true, role_code: true, role_name: true, status: true }
    });
  }

  findActiveRole(transaction: TenantPrismaTransaction, tenantId: number, roleId: number) {
    return transaction.role.findFirst({
      where: { tenant_id: BigInt(tenantId), role_id: BigInt(roleId), status: "ACTIVE" },
      select: { role_id: true, role_code: true, role_name: true }
    });
  }

  async assignRole(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    userId: number,
    roleId: number,
    actorUserId: number
  ): Promise<void> {
    await transaction.user_role.upsert({
      where: {
        tenant_id_user_id_role_id: {
          tenant_id: BigInt(tenantId),
          user_id: BigInt(userId),
          role_id: BigInt(roleId)
        }
      },
      create: {
        tenant_id: BigInt(tenantId),
        user_id: BigInt(userId),
        role_id: BigInt(roleId),
        assigned_by_user_id: BigInt(actorUserId)
      },
      update: {}
    });
  }

  listAssignments(transaction: TenantPrismaTransaction, tenantId: number) {
    return transaction.user_role.findMany({
      where: { tenant_id: BigInt(tenantId), role: { status: "ACTIVE" } },
      select: { user_id: true, role: { select: { role_id: true, role_code: true, role_name: true } } }
    });
  }
}
