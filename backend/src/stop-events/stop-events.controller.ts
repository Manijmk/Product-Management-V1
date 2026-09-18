import { Body, Controller, Param, ParseIntPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators.js";
import { MASTER_DATA_ROLES } from "../auth/roles.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { CreateFollowUpDto } from "./dto/create-follow-up.dto.js";
import { CreateStopEventDto } from "./dto/create-stop-event.dto.js";
import { StopEventsService } from "./stop-events.service.js";

@ApiTags("stop-events")
@ApiBearerAuth()
@Controller("trip-stops")
export class StopEventsController {
  constructor(private readonly service: StopEventsService) {}

  @Post(":tripStopId/events")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiCreatedResponse()
  create(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("tripStopId", ParseIntPipe) tripStopId: number,
    @Body() input: CreateStopEventDto
  ) {
    return this.service.create(context, tripStopId, input);
  }

  @Post(":tripStopId/follow-up")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiCreatedResponse()
  createFollowUp(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("tripStopId", ParseIntPipe) tripStopId: number,
    @Body() input: CreateFollowUpDto
  ) {
    return this.service.createFollowUp(context, tripStopId, input);
  }
}
