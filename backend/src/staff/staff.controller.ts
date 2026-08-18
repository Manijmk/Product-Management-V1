import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators.js";
import { ADMINISTRATIVE_ROLES } from "../auth/roles.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { CreateStaffDto } from "./dto/create-staff.dto.js";
import { StaffService } from "./staff.service.js";

@ApiTags("staff")
@ApiBearerAuth()
@RequireRoles(...ADMINISTRATIVE_ROLES)
@Controller("staff")
export class StaffController {
  constructor(private readonly service: StaffService) {}

  @Get()
  @ApiOkResponse()
  list(@CurrentAuth() context: AuthenticatedTenantContext) {
    return this.service.list(context);
  }

  @Post()
  @ApiCreatedResponse()
  create(@CurrentAuth() context: AuthenticatedTenantContext, @Body() input: CreateStaffDto) {
    return this.service.create(context, input);
  }
}
