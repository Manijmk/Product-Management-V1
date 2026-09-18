import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../http/api-error.js";
import { type ListQueryDto, pageResponse } from "../http/list-query.dto.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";
import { UsersRepository } from "../users/users.repository.js";
import type { CreateStaffDto } from "./dto/create-staff.dto.js";
import { StaffRepository } from "./staff.repository.js";

function mapStaff(staff: {
  staff_id: bigint;
  user_id: bigint | null;
  employee_code: string | null;
  name: string;
  mobile: string | null;
  staff_type: string;
  status: string;
  joined_on: Date | null;
  created_at: Date;
}) {
  return {
    staffId: staff.staff_id.toString(),
    userId: staff.user_id?.toString() ?? null,
    employeeCode: staff.employee_code,
    name: staff.name,
    mobile: staff.mobile,
    staffType: staff.staff_type,
    status: staff.status,
    joinedOn: staff.joined_on?.toISOString().slice(0, 10) ?? null,
    createdAt: staff.created_at.toISOString()
  };
}

@Injectable()
export class StaffService {
  constructor(
    private readonly transactions: PrismaTenantTransactionService,
    private readonly repository: StaffRepository,
    private readonly users: UsersRepository
  ) {}

  list(context: AuthenticatedTenantContext, query: ListQueryDto) {
    return this.transactions.run(context, async (transaction) => pageResponse(
      (await this.repository.list(transaction, context.tenantId)).map(mapStaff), query
    ));
  }

  get(context: AuthenticatedTenantContext, staffId: number) {
    return this.transactions.run(context, async (transaction) => {
      const staff = await this.repository.find(transaction, context.tenantId, staffId);
      if (staff === null) throw new ApiError(HttpStatus.NOT_FOUND, "STAFF_NOT_FOUND", "The staff member was not found");
      const user = staff.app_user_staff_tenant_id_user_idToapp_user;
      return {
        ...mapStaff(staff),
        updatedAt: staff.updated_at.toISOString(),
        user: user === null ? null : {
          userId: user.userId.toString(),
          loginIdentity: user.loginIdentity,
          email: user.email,
          mobile: user.mobile,
          displayName: user.displayName,
          status: user.status,
          roles: user.user_role_user_role_tenant_id_user_idToapp_user.map(({ role }) => ({
            roleId: role.role_id.toString(),
            roleCode: role.role_code,
            roleName: role.role_name
          }))
        }
      };
    });
  }

  create(context: AuthenticatedTenantContext, input: CreateStaffDto) {
    return this.transactions.run(context, async (transaction) => {
      if (input.userId !== undefined) {
        const user = await this.users.findById(transaction, context.tenantId, input.userId);
        if (user === null) throw new ApiError(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "The linked user was not found");
      }
      return mapStaff(await this.repository.create(transaction, context.tenantId, context.userId, input));
    });
  }
}
