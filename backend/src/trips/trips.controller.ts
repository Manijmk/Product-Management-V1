import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators.js";
import { ADMINISTRATIVE_ROLES, MASTER_DATA_ROLES } from "../auth/roles.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { ListQueryDto } from "../http/list-query.dto.js";
import { AddTripStopDto } from "./dto/add-trip-stop.dto.js";
import { CreateTripDto } from "./dto/create-trip.dto.js";
import { ReorderTripStopDto } from "./dto/reorder-trip-stop.dto.js";
import { AddTripStaffDto } from "./dto/trip-staff.dto.js";
import { TripsService } from "./trips.service.js";

@ApiTags("trips")
@ApiBearerAuth()
@Controller("trips")
export class TripsController {
  constructor(private readonly service: TripsService) {}

  @Post()
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiCreatedResponse()
  create(@CurrentAuth() context: AuthenticatedTenantContext, @Body() input: CreateTripDto) {
    return this.service.create(context, input);
  }

  @Get()
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  list(@CurrentAuth() context: AuthenticatedTenantContext, @Query() query: ListQueryDto) {
    return this.service.list(context, query);
  }

  @Get(":tripId")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  get(@CurrentAuth() context: AuthenticatedTenantContext, @Param("tripId", ParseIntPipe) tripId: number) {
    return this.service.get(context, tripId);
  }

  @Post(":tripId/staff")
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiCreatedResponse()
  addStaff(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("tripId", ParseIntPipe) tripId: number,
    @Body() input: AddTripStaffDto
  ) {
    return this.service.addStaff(context, tripId, input);
  }

  @Post(":tripId/stops")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiCreatedResponse()
  addStop(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("tripId", ParseIntPipe) tripId: number,
    @Body() input: AddTripStopDto
  ) {
    return this.service.addStop(context, tripId, input);
  }

  @Patch(":tripId/stops/:tripStopId/order")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  reorderStop(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("tripId", ParseIntPipe) tripId: number,
    @Param("tripStopId", ParseIntPipe) tripStopId: number,
    @Body() input: ReorderTripStopDto
  ) {
    return this.service.reorderStop(context, tripId, tripStopId, input);
  }

  @Post(":tripId/dispatch")
  @HttpCode(200)
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiOkResponse()
  dispatch(@CurrentAuth() context: AuthenticatedTenantContext, @Param("tripId", ParseIntPipe) tripId: number) {
    return this.service.dispatch(context, tripId);
  }

  @Post(":tripId/start")
  @HttpCode(200)
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  start(@CurrentAuth() context: AuthenticatedTenantContext, @Param("tripId", ParseIntPipe) tripId: number) {
    return this.service.start(context, tripId);
  }
}
