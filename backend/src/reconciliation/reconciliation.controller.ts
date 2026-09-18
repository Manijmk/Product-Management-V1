import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators.js";
import { ADMINISTRATIVE_ROLES, MASTER_DATA_ROLES, ROUTE_STAFF_ROLE } from "../auth/roles.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { CreateCashHandoverDto, DisputeCashHandoverDto } from "./dto/cash-handover.dto.js";
import {
  CreateReconciliationDto,
  ResolveExceptionDto,
  SubmitCashCountDto,
  SubmitStockCountDto
} from "./dto/reconciliation.dto.js";
import { ReconciliationService } from "./reconciliation.service.js";

@ApiTags("trip-close")
@ApiBearerAuth()
@Controller()
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Post("trips/:tripId/complete")
  @HttpCode(200)
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  completeTrip(@CurrentAuth() context: AuthenticatedTenantContext, @Param("tripId", ParseIntPipe) tripId: number) {
    return this.service.completeTrip(context, tripId);
  }

  @Post("trips/:tripId/reconciliation")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiCreatedResponse()
  createReconciliation(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("tripId", ParseIntPipe) tripId: number,
    @Body() input: CreateReconciliationDto
  ) {
    return this.service.createReconciliation(context, tripId, input);
  }

  @Get("reconciliations/:reconciliationId")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  getReconciliation(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("reconciliationId", ParseIntPipe) reconciliationId: number
  ) {
    return this.service.getReconciliation(context, reconciliationId);
  }

  @Put("reconciliations/:reconciliationId/stock")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  submitStock(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("reconciliationId", ParseIntPipe) reconciliationId: number,
    @Body() input: SubmitStockCountDto
  ) {
    return this.service.submitStock(context, reconciliationId, input);
  }

  @Put("reconciliations/:reconciliationId/cash")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  submitCash(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("reconciliationId", ParseIntPipe) reconciliationId: number,
    @Body() input: SubmitCashCountDto
  ) {
    return this.service.submitCash(context, reconciliationId, input);
  }

  @Post("reconciliations/:reconciliationId/submit")
  @HttpCode(200)
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  submitReconciliation(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("reconciliationId", ParseIntPipe) reconciliationId: number
  ) {
    return this.service.submitReconciliation(context, reconciliationId);
  }

  @Post("reconciliations/:reconciliationId/approve")
  @HttpCode(200)
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiOkResponse()
  approveReconciliation(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("reconciliationId", ParseIntPipe) reconciliationId: number
  ) {
    return this.service.approveReconciliation(context, reconciliationId);
  }

  @Post("trips/:tripId/reconcile")
  @HttpCode(200)
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiOkResponse()
  reconcileTrip(@CurrentAuth() context: AuthenticatedTenantContext, @Param("tripId", ParseIntPipe) tripId: number) {
    return this.service.reconcileTrip(context, tripId);
  }

  @Post("trips/:tripId/cash-handovers")
  @RequireRoles(ROUTE_STAFF_ROLE)
  @ApiCreatedResponse()
  createHandover(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("tripId", ParseIntPipe) tripId: number,
    @Body() input: CreateCashHandoverDto
  ) {
    return this.service.createCashHandover(context, tripId, input);
  }

  @Post("cash-handovers/:cashHandoverId/confirm")
  @HttpCode(200)
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiOkResponse()
  confirmHandover(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("cashHandoverId", ParseIntPipe) cashHandoverId: number
  ) {
    return this.service.confirmCashHandover(context, cashHandoverId);
  }

  @Post("cash-handovers/:cashHandoverId/dispute")
  @HttpCode(200)
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiOkResponse()
  disputeHandover(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("cashHandoverId", ParseIntPipe) cashHandoverId: number,
    @Body() input: DisputeCashHandoverDto
  ) {
    return this.service.disputeCashHandover(context, cashHandoverId, input.reason);
  }

  @Post("post-reconciliation-adjustments/:adjustmentId/approve")
  @HttpCode(200)
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiOkResponse()
  approveAdjustment(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("adjustmentId", ParseIntPipe) adjustmentId: number
  ) {
    return this.service.approvePostReconciliationAdjustment(context, adjustmentId);
  }

  @Post("reconciliation-exceptions/:exceptionId/resolve")
  @HttpCode(200)
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiOkResponse()
  resolveException(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("exceptionId", ParseIntPipe) exceptionId: number,
    @Body() input: ResolveExceptionDto
  ) {
    return this.service.resolveException(context, exceptionId, input.resolutionNotes);
  }
}
