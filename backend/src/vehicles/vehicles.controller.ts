import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators.js";
import { ADMINISTRATIVE_ROLES, MASTER_DATA_ROLES } from "../auth/roles.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { ListQueryDto } from "../http/list-query.dto.js";
import { CreateVehicleDto } from "./dto/create-vehicle.dto.js";
import { VehiclesService } from "./vehicles.service.js";

@ApiTags("vehicles")
@ApiBearerAuth()
@Controller("vehicles")
export class VehiclesController {
  constructor(private readonly service: VehiclesService) {}

  @Get()
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  list(@CurrentAuth() context: AuthenticatedTenantContext, @Query() query: ListQueryDto) {
    return this.service.list(context, query);
  }

  @Post()
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiCreatedResponse()
  create(@CurrentAuth() context: AuthenticatedTenantContext, @Body() input: CreateVehicleDto) {
    return this.service.create(context, input);
  }

  @Get(":vehicleId")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  get(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("vehicleId", ParseIntPipe) vehicleId: number
  ) {
    return this.service.get(context, vehicleId);
  }
}
