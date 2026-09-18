import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../http/api-error.js";
import { type ListQueryDto, pageResponse } from "../http/list-query.dto.js";
import { validatePlanningQuantity } from "../operations/planning-rules.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";
import type { CreateRouteDto } from "./dto/create-route.dto.js";
import type { CreateRouteStopDto } from "./dto/create-route-stop.dto.js";
import type { ReorderRouteStopDto } from "./dto/reorder-route-stop.dto.js";
import { RoutesRepository } from "./routes.repository.js";

type RouteSummary = Awaited<ReturnType<RoutesRepository["list"]>>[number];
type RouteDetail = NonNullable<Awaited<ReturnType<RoutesRepository["find"]>>>;

function mapRoute(route: RouteSummary) {
  return {
    routeId: route.route_id.toString(),
    routeCode: route.route_code,
    routeName: route.route_name,
    description: route.description,
    status: route.status,
    createdAt: route.created_at.toISOString(),
    updatedAt: route.updated_at.toISOString()
  };
}

function mapDetail(route: RouteDetail) {
  return {
    ...mapRoute(route),
    stops: route.route_stop_template.map((stop) => ({
      routeStopId: stop.route_stop_template_id.toString(),
      partyId: stop.party_id.toString(),
      partyName: stop.party.name,
      customerStatus: stop.party.customerStatus,
      sortableOrder: stop.default_sequence.toString(),
      preferredTimeFrom: stop.preferred_time_from?.toISOString().slice(11, 19) ?? null,
      preferredTimeTo: stop.preferred_time_to?.toISOString().slice(11, 19) ?? null,
      notes: stop.notes,
      activeStatus: stop.active_status,
      products: stop.route_stop_product.map((product) => ({
        routeStopProductId: product.route_stop_product_id.toString(),
        partyProductId: product.party_product_id.toString(),
        productId: product.party_product.product_id.toString(),
        productCode: product.party_product.product.productCode,
        productName: product.party_product.product.name,
        quantityMode: product.quantity_mode,
        plannedQty: product.planned_qty?.toString() ?? null,
        forecastQty: product.forecast_qty?.toString() ?? null,
        notes: product.notes,
        activeStatus: product.active_status
      }))
    }))
  };
}

@Injectable()
export class RoutesService {
  constructor(
    private readonly transactions: PrismaTenantTransactionService,
    private readonly repository: RoutesRepository
  ) {}

  list(context: AuthenticatedTenantContext, query: ListQueryDto) {
    return this.transactions.run(context, async (transaction) => pageResponse(
      (await this.repository.list(transaction, context.tenantId)).map(mapRoute), query
    ));
  }

  get(context: AuthenticatedTenantContext, routeId: number) {
    return this.transactions.run(context, async (transaction) => {
      const route = await this.repository.find(transaction, context.tenantId, routeId);
      if (route === null) throw new ApiError(HttpStatus.NOT_FOUND, "ROUTE_NOT_FOUND", "The route was not found");
      return mapDetail(route);
    });
  }

  create(context: AuthenticatedTenantContext, input: CreateRouteDto) {
    return this.transactions.run(context, async (transaction) => mapRoute(
      await this.repository.create(transaction, context.tenantId, context.userId, input)
    ));
  }

  addStop(context: AuthenticatedTenantContext, routeId: number, input: CreateRouteStopDto) {
    for (const product of input.products) {
      validatePlanningQuantity(product.quantityMode, product.plannedQty, product.forecastQty);
    }
    return this.transactions.run(context, async (transaction) => {
      const route = await this.repository.find(transaction, context.tenantId, routeId);
      if (route === null || route.status !== "ACTIVE") {
        throw new ApiError(HttpStatus.NOT_FOUND, "ROUTE_NOT_FOUND", "The active route was not found");
      }
      const party = await this.repository.findParty(transaction, context.tenantId, input.partyId);
      if (party === null) throw new ApiError(HttpStatus.NOT_FOUND, "CUSTOMER_NOT_FOUND", "The customer was not found");
      await this.repository.lockRoute(transaction, context.tenantId, routeId);
      if (await this.repository.findSequence(transaction, context.tenantId, routeId, input.defaultSequence) !== null) {
        throw new ApiError(HttpStatus.CONFLICT, "ROUTE_STOP_ORDER_CONFLICT", "The route already has an active stop at this sequence");
      }
      for (const product of input.products) {
        if (await this.repository.findPartyProduct(
          transaction,
          context.tenantId,
          input.partyId,
          product.partyProductId
        ) === null) {
          throw new ApiError(HttpStatus.NOT_FOUND, "PARTY_PRODUCT_NOT_FOUND", "A route stop product is not configured for this customer");
        }
      }
      await this.repository.createStop(transaction, context.tenantId, routeId, context.userId, input);
      return mapDetail((await this.repository.find(transaction, context.tenantId, routeId))!);
    });
  }

  reorderStop(
    context: AuthenticatedTenantContext,
    routeId: number,
    routeStopId: number,
    input: ReorderRouteStopDto
  ) {
    return this.transactions.run(context, async (transaction) => {
      const route = await this.repository.find(transaction, context.tenantId, routeId);
      if (route === null) throw new ApiError(HttpStatus.NOT_FOUND, "ROUTE_NOT_FOUND", "The route was not found");
      if (route.status !== "ACTIVE") {
        throw new ApiError(HttpStatus.CONFLICT, "ROUTE_STOP_REORDER_NOT_ALLOWED", "Only active routes may be reordered");
      }
      await this.repository.lockRoute(transaction, context.tenantId, routeId);
      const stop = await this.repository.findStop(transaction, context.tenantId, routeId, routeStopId);
      if (stop === null) throw new ApiError(HttpStatus.NOT_FOUND, "ROUTE_STOP_NOT_FOUND", "The route stop was not found");
      if (stop.active_status !== "ACTIVE") {
        throw new ApiError(HttpStatus.CONFLICT, "ROUTE_STOP_REORDER_NOT_ALLOWED", "Only active route stops may be reordered");
      }
      if (await this.repository.findOtherSequence(
        transaction,
        context.tenantId,
        routeId,
        routeStopId,
        input.sortableOrder
      ) !== null) {
        throw new ApiError(HttpStatus.CONFLICT, "ROUTE_STOP_ORDER_CONFLICT", "The route already has an active stop at this order");
      }
      await this.repository.reorderStop(transaction, context.tenantId, routeStopId, input);
      return mapDetail((await this.repository.find(transaction, context.tenantId, routeId))!);
    });
  }
}
