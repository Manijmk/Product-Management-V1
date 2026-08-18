import { Injectable } from "@nestjs/common";
import type { TenantPrismaTransaction } from "../tenancy/prisma-tenant-transaction.service.js";

@Injectable()
export class StaffRepository {
  list(transaction: TenantPrismaTransaction, tenantId: number) {
    return transaction.staff.findMany({
      where: { tenant_id: BigInt(tenantId) },
      orderBy: { staff_id: "asc" },
      select: {
        staff_id: true,
        user_id: true,
        employee_code: true,
        name: true,
        mobile: true,
        staff_type: true,
        status: true,
        joined_on: true,
        created_at: true
      }
    });
  }

  create(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    actorUserId: number,
    input: {
      userId?: number;
      employeeCode?: string;
      name: string;
      mobile?: string;
      staffType: string;
      joinedOn?: string;
    }
  ) {
    return transaction.staff.create({
      data: {
        tenant_id: BigInt(tenantId),
        user_id: input.userId === undefined ? undefined : BigInt(input.userId),
        employee_code: input.employeeCode,
        name: input.name,
        mobile: input.mobile,
        staff_type: input.staffType,
        joined_on: input.joinedOn === undefined ? undefined : new Date(`${input.joinedOn}T00:00:00.000Z`),
        created_by_user_id: BigInt(actorUserId)
      },
      select: {
        staff_id: true,
        user_id: true,
        employee_code: true,
        name: true,
        mobile: true,
        staff_type: true,
        status: true,
        joined_on: true,
        created_at: true
      }
    });
  }
}
