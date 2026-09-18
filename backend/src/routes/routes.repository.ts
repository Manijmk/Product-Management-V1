import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { TenantPrismaTransaction } from "../tenancy/prisma-tenant-transaction.service.js";
import type { CreateRouteDto } from "./dto/create-route.dto.js";
import type { CreateRouteStopDto } from "./dto/create-route-stop.dto.js";
import type { ReorderRouteStopDto } from "./dto/reorder-route-stop.dto.js";

const routeSummarySelection = {
  route_id: true,
  route_code: true,
  route_name: true,
  description: true,
  status: true,
  created_at: true,
  updated_at: true
} as const;

@Injectable()
export class RoutesRepository {
  list(transaction: TenantPrismaTransaction, tenantId: number) {
    return transaction.route.findMany({
      where: { tenant_id: BigInt(tenantId) },
      orderBy: { route_code: "asc" },
      select: routeSummarySelection
    });
  }

  find(transaction: TenantPrismaTransaction, tenantId: number, routeId: number) {
    return transaction.route.findFirst({
      where: { tenant_id: BigInt(tenantId), route_id: BigInt(routeId) },
      select: {
        ...routeSummarySelection,
        route_stop_template: {
          orderBy: [{ default_sequence: "asc" }, { route_stop_template_id: "asc" }],
          select: {
            route_stop_template_id: true,
            party_id: true,
            default_sequence: true,
            preferred_time_from: true,
            preferred_time_to: true,
            notes: true,
            active_status: true,
            party: { select: { name: true, customerStatus: true } },
            route_stop_product: {
              orderBy: { route_stop_product_id: "asc" },
              select: {
                route_stop_product_id: true,
                party_product_id: true,
                quantity_mode: true,
                planned_qty: true,
                forecast_qty: true,
                notes: true,
                active_status: true,
                party_product: {
                  select: {
                    product_id: true,
                    product: { select: { productCode: true, name: true } }
                  }
                }
              }
            }
          }
        }
      }
    });
  }

  create(transaction: TenantPrismaTransaction, tenantId: number, actorUserId: number, input: CreateRouteDto) {
    return transaction.route.create({
      data: {
        tenant_id: BigInt(tenantId),
        route_code: input.routeCode,
        route_name: input.routeName,
        description: input.description,
        created_by_user_id: BigInt(actorUserId)
      },
      select: routeSummarySelection
    });
  }

  findParty(transaction: TenantPrismaTransaction, tenantId: number, partyId: number) {
    return transaction.party.findFirst({
      where: { tenantId: BigInt(tenantId), partyId: BigInt(partyId) },
      select: { partyId: true, customerStatus: true }
    });
  }

  findPartyProduct(transaction: TenantPrismaTransaction, tenantId: number, partyId: number, partyProductId: number) {
    return transaction.party_product.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        party_id: BigInt(partyId),
        party_product_id: BigInt(partyProductId),
        active_status: "ACTIVE",
        product: { activeStatus: "ACTIVE" }
      },
      select: { party_product_id: true }
    });
  }

  async lockRoute(transaction: TenantPrismaTransaction, tenantId: number, routeId: number): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`route:${tenantId}:${routeId}`}, 0))`
    );
  }

  findSequence(transaction: TenantPrismaTransaction, tenantId: number, routeId: number, sequence: number) {
    return transaction.route_stop_template.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        route_id: BigInt(routeId),
        default_sequence: sequence,
        active_status: "ACTIVE"
      },
      select: { route_stop_template_id: true }
    });
  }

  findStop(transaction: TenantPrismaTransaction, tenantId: number, routeId: number, routeStopId: number) {
    return transaction.route_stop_template.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        route_id: BigInt(routeId),
        route_stop_template_id: BigInt(routeStopId)
      },
      select: { route_stop_template_id: true, active_status: true }
    });
  }

  findOtherSequence(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    routeId: number,
    routeStopId: number,
    sequence: number
  ) {
    return transaction.route_stop_template.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        route_id: BigInt(routeId),
        route_stop_template_id: { not: BigInt(routeStopId) },
        default_sequence: sequence,
        active_status: "ACTIVE"
      },
      select: { route_stop_template_id: true }
    });
  }

  reorderStop(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    routeStopId: number,
    input: ReorderRouteStopDto
  ) {
    return transaction.route_stop_template.update({
      where: {
        tenant_id_route_stop_template_id: {
          tenant_id: BigInt(tenantId),
          route_stop_template_id: BigInt(routeStopId)
        }
      },
      data: { default_sequence: input.sortableOrder }
    });
  }

  async createStop(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    routeId: number,
    actorUserId: number,
    input: CreateRouteStopDto
  ): Promise<void> {
    const stop = await transaction.route_stop_template.create({
      data: {
        tenant_id: BigInt(tenantId),
        route_id: BigInt(routeId),
        party_id: BigInt(input.partyId),
        default_sequence: input.defaultSequence,
        preferred_time_from: input.preferredTimeFrom === undefined ? undefined : new Date(`1970-01-01T${input.preferredTimeFrom}Z`),
        preferred_time_to: input.preferredTimeTo === undefined ? undefined : new Date(`1970-01-01T${input.preferredTimeTo}Z`),
        notes: input.notes,
        created_by_user_id: BigInt(actorUserId)
      },
      select: { route_stop_template_id: true }
    });
    await transaction.route_stop_product.createMany({
      data: input.products.map((product) => ({
        tenant_id: BigInt(tenantId),
        route_stop_template_id: stop.route_stop_template_id,
        party_product_id: BigInt(product.partyProductId),
        quantity_mode: product.quantityMode,
        planned_qty: product.plannedQty,
        forecast_qty: product.forecastQty,
        notes: product.notes,
        created_by_user_id: BigInt(actorUserId)
      }))
    });
  }
}
