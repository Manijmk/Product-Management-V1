import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators.js";
import { ADMINISTRATIVE_ROLES } from "../auth/roles.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { ListQueryDto } from "../http/list-query.dto.js";
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
  list(@CurrentAuth() context: AuthenticatedTenantContext, @Query() query: ListQueryDto) {
    return this.service.list(context, query);
  }

  @Get(":staffId")
  @ApiOkResponse()
  get(@CurrentAuth() context: AuthenticatedTenantContext, @Param("staffId", ParseIntPipe) staffId: number) {
    return this.service.get(context, staffId);
  }

  @Post()
  @ApiCreatedResponse()
  create(@CurrentAuth() context: AuthenticatedTenantContext, @Body() input: CreateStaffDto) {
    return this.service.create(context, input);
  }
}
