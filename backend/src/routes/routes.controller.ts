import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators.js";
import { ADMINISTRATIVE_ROLES, MASTER_DATA_ROLES } from "../auth/roles.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { ListQueryDto } from "../http/list-query.dto.js";
import { CreateRouteDto } from "./dto/create-route.dto.js";
import { CreateRouteStopDto } from "./dto/create-route-stop.dto.js";
import { RoutesService } from "./routes.service.js";
import { ReorderRouteStopDto } from "./dto/reorder-route-stop.dto.js";

@ApiTags("routes")
@ApiBearerAuth()
@Controller("routes")
export class RoutesController {
  constructor(private readonly service: RoutesService) {}

  @Get()
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  list(@CurrentAuth() context: AuthenticatedTenantContext, @Query() query: ListQueryDto) {
    return this.service.list(context, query);
  }

  @Post()
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiCreatedResponse()
  create(@CurrentAuth() context: AuthenticatedTenantContext, @Body() input: CreateRouteDto) {
    return this.service.create(context, input);
  }

  @Get(":routeId")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  get(@CurrentAuth() context: AuthenticatedTenantContext, @Param("routeId", ParseIntPipe) routeId: number) {
    return this.service.get(context, routeId);
  }

  @Post(":routeId/stops")
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiCreatedResponse()
  addStop(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("routeId", ParseIntPipe) routeId: number,
    @Body() input: CreateRouteStopDto
  ) {
    return this.service.addStop(context, routeId, input);
  }

  @Patch(":routeId/stops/:routeStopId/order")
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiOkResponse()
  reorderStop(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("routeId", ParseIntPipe) routeId: number,
    @Param("routeStopId", ParseIntPipe) routeStopId: number,
    @Body() input: ReorderRouteStopDto
  ) {
    return this.service.reorderStop(context, routeId, routeStopId, input);
  }
}
