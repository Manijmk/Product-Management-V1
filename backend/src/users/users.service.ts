import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../http/api-error.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";
import type { AssignRoleDto } from "./dto/assign-role.dto.js";
import type { CreateUserDto } from "./dto/create-user.dto.js";
import { UsersRepository } from "./users.repository.js";

function mapUser(user: {
  userId: bigint;
  loginIdentity: string | null;
  mobile: string | null;
  email: string | null;
  displayName: string | null;
  status: string;
  createdAt: Date;
}, roles: readonly { role_id: bigint; role_code: string; role_name: string }[] = []) {
  return {
    userId: user.userId.toString(),
    loginIdentity: user.loginIdentity,
    mobile: user.mobile,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    roles: roles.map((role) => ({
      roleId: role.role_id.toString(),
      roleCode: role.role_code,
      roleName: role.role_name
    })),
    createdAt: user.createdAt.toISOString()
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly transactions: PrismaTenantTransactionService,
    private readonly repository: UsersRepository
  ) {}

  list(context: AuthenticatedTenantContext) {
    return this.transactions.run(context, async (transaction) => {
      const [users, assignments] = await Promise.all([
        this.repository.list(transaction, context.tenantId),
        this.repository.listAssignments(transaction, context.tenantId)
      ]);
      return users.map((user) => mapUser(
        user,
        assignments.filter((assignment) => assignment.user_id === user.userId).map((assignment) => assignment.role)
      ));
    });
  }

  create(context: AuthenticatedTenantContext, input: CreateUserDto) {
    if (input.loginIdentity === undefined && input.mobile === undefined && input.email === undefined) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "USER_IDENTITY_REQUIRED", "At least one login identity, mobile, or email is required");
    }
    return this.transactions.run(context, async (transaction) => mapUser(
      await this.repository.create(transaction, context.tenantId, context.userId, input)
    ));
  }

  listRoles(context: AuthenticatedTenantContext) {
    return this.transactions.run(context, async (transaction) => (
      await this.repository.listRoles(transaction, context.tenantId)
    ).map((role) => ({
      roleId: role.role_id.toString(),
      roleCode: role.role_code,
      roleName: role.role_name,
      status: role.status
    })));
  }

  assignRole(context: AuthenticatedTenantContext, userId: number, input: AssignRoleDto) {
    return this.transactions.run(context, async (transaction) => {
      const [user, role] = await Promise.all([
        this.repository.findById(transaction, context.tenantId, userId),
        this.repository.findActiveRole(transaction, context.tenantId, input.roleId)
      ]);
      if (user === null) throw new ApiError(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "The user was not found");
      if (role === null) throw new ApiError(HttpStatus.NOT_FOUND, "ROLE_NOT_FOUND", "The role was not found");
      await this.repository.assignRole(transaction, context.tenantId, userId, input.roleId, context.userId);
      return {
        userId: String(userId),
        role: { roleId: role.role_id.toString(), roleCode: role.role_code, roleName: role.role_name }
      };
    });
  }
}
