import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators.js";
import { ADMINISTRATIVE_ROLES } from "../auth/roles.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { ListQueryDto } from "../http/list-query.dto.js";
import { AssignRoleDto } from "./dto/assign-role.dto.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { UsersService } from "./users.service.js";

@ApiTags("users")
@ApiBearerAuth()
@RequireRoles(...ADMINISTRATIVE_ROLES)
@Controller()
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get("users")
  @ApiOkResponse()
  list(@CurrentAuth() context: AuthenticatedTenantContext, @Query() query: ListQueryDto) {
    return this.service.list(context, query);
  }

  @Post("users")
  @ApiCreatedResponse()
  create(@CurrentAuth() context: AuthenticatedTenantContext, @Body() input: CreateUserDto) {
    return this.service.create(context, input);
  }

  @Get("roles")
  @ApiOkResponse()
  roles(@CurrentAuth() context: AuthenticatedTenantContext, @Query() query: ListQueryDto) {
    return this.service.listRoles(context, query);
  }

  @Post("users/:userId/roles")
  @ApiCreatedResponse()
  assignRole(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("userId", ParseIntPipe) userId: number,
    @Body() input: AssignRoleDto
  ) {
    return this.service.assignRole(context, userId, input);
  }
}
