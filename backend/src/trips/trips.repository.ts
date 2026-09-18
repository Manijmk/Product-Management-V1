import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { TenantPrismaTransaction } from "../tenancy/prisma-tenant-transaction.service.js";
import type { AddTripStopDto } from "./dto/add-trip-stop.dto.js";
import type { CreateTripDto } from "./dto/create-trip.dto.js";
import type { AddTripStaffDto, TripStaffRole } from "./dto/trip-staff.dto.js";

const tripSummarySelection = {
  tripId: true,
  tripNumber: true,
  routeId: true,
  tripDate: true,
  shift_code: true,
  vehicleId: true,
  primaryStaffId: true,
  status: true,
  planned_start_at: true,
  actual_start_at: true,
  createdAt: true,
  updatedAt: true
} as const;

@Injectable()
export class TripsRepository {
  list(transaction: TenantPrismaTransaction, tenantId: number) {
    return transaction.trip.findMany({
      where: { tenantId: BigInt(tenantId) },
      orderBy: [{ tripDate: "desc" }, { tripId: "desc" }],
      select: tripSummarySelection
    });
  }

  find(transaction: TenantPrismaTransaction, tenantId: number, tripId: number) {
    return transaction.trip.findFirst({
      where: { tenantId: BigInt(tenantId), tripId: BigInt(tripId) },
      select: {
        ...tripSummarySelection,
        route: { select: { route_code: true, route_name: true } },
        vehicle: { select: { registration_no: true, vehicle_type: true, status: true } },
        staff: { select: { name: true, status: true } },
        trip_staff: {
          orderBy: [{ joined_at: "asc" }, { trip_staff_id: "asc" }],
          select: {
            trip_staff_id: true,
            staff_id: true,
            trip_role: true,
            joined_at: true,
            left_at: true,
            is_primary: true,
            staff: { select: { name: true, status: true } }
          }
        },
        trip_stop: {
          orderBy: [{ sortable_order: "asc" }, { trip_stop_id: "asc" }],
          select: {
            trip_stop_id: true,
            party_id: true,
            route_stop_template_id: true,
            source: true,
            sortable_order: true,
            status: true,
            notes: true,
            added_at: true,
            party: { select: { name: true, customerStatus: true } },
            trip_stop_product: {
              orderBy: { trip_stop_product_id: "asc" },
              select: {
                trip_stop_product_id: true,
                product_id: true,
                party_product_id: true,
                quantity_mode: true,
                planned_qty: true,
                forecast_qty: true,
                price_snapshot: true,
                status: true,
                notes: true,
                product: { select: { productCode: true, name: true } }
              }
            }
          }
        }
      }
    });
  }

  findRouteCopySource(transaction: TenantPrismaTransaction, tenantId: number, routeId: number) {
    return transaction.route.findFirst({
      where: { tenant_id: BigInt(tenantId), route_id: BigInt(routeId), status: "ACTIVE" },
      select: {
        route_id: true,
        route_stop_template: {
          where: { active_status: "ACTIVE" },
          orderBy: [{ default_sequence: "asc" }, { route_stop_template_id: "asc" }],
          select: {
            route_stop_template_id: true,
            party_id: true,
            default_sequence: true,
            notes: true,
            party: { select: { customerStatus: true } },
            route_stop_product: {
              where: { active_status: "ACTIVE" },
              orderBy: { route_stop_product_id: "asc" },
              select: {
                party_product_id: true,
                quantity_mode: true,
                planned_qty: true,
                forecast_qty: true,
                notes: true,
                party_product: {
                  select: {
                    party_id: true,
                    product_id: true,
                    active_status: true,
                    product: { select: { activeStatus: true } }
                  }
                }
              }
            }
          }
        }
      }
    });
  }

  findVehicle(transaction: TenantPrismaTransaction, tenantId: number, vehicleId: number) {
    return transaction.vehicle.findFirst({
      where: { tenant_id: BigInt(tenantId), vehicle_id: BigInt(vehicleId) },
      select: { vehicle_id: true, status: true }
    });
  }

  findStaff(transaction: TenantPrismaTransaction, tenantId: number, staffId: number) {
    return transaction.staff.findFirst({
      where: { tenant_id: BigInt(tenantId), staff_id: BigInt(staffId) },
      select: { staff_id: true, status: true }
    });
  }

  findCustomer(transaction: TenantPrismaTransaction, tenantId: number, partyId: number) {
    return transaction.party.findFirst({
      where: { tenantId: BigInt(tenantId), partyId: BigInt(partyId) },
      select: { partyId: true, customerStatus: true }
    });
  }

  findProduct(transaction: TenantPrismaTransaction, tenantId: number, productId: number) {
    return transaction.product.findFirst({
      where: { tenantId: BigInt(tenantId), productId: BigInt(productId), activeStatus: "ACTIVE" },
      select: { productId: true }
    });
  }

  findPartyProduct(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    partyId: number,
    productId: number,
    partyProductId: number
  ) {
    return transaction.party_product.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        party_id: BigInt(partyId),
        product_id: BigInt(productId),
        party_product_id: BigInt(partyProductId),
        active_status: "ACTIVE"
      },
      select: { party_product_id: true }
    });
  }

  createTrip(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    actorUserId: number,
    tripNumber: string,
    input: CreateTripDto
  ) {
    return transaction.trip.create({
      data: {
        tenantId: BigInt(tenantId),
        tripNumber,
        routeId: input.routeId == null ? undefined : BigInt(input.routeId),
        tripDate: new Date(`${input.tripDate}T00:00:00.000Z`),
        shift_code: input.shiftCode,
        vehicleId: input.vehicleId === undefined ? undefined : BigInt(input.vehicleId),
        primaryStaffId: input.primaryStaffId === undefined ? undefined : BigInt(input.primaryStaffId),
        planned_start_at: input.plannedStartAt === undefined ? undefined : new Date(input.plannedStartAt),
        created_by_user_id: BigInt(actorUserId)
      },
      select: { tripId: true }
    });
  }

  createTripStaff(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripId: bigint,
    actorUserId: number,
    assignment: { staffId: number; tripRole: TripStaffRole; joinedAt: Date; leftAt?: Date; isPrimary: boolean }
  ) {
    return transaction.trip_staff.create({
      data: {
        tenant_id: BigInt(tenantId),
        trip_id: tripId,
        staff_id: BigInt(assignment.staffId),
        trip_role: assignment.tripRole,
        joined_at: assignment.joinedAt,
        left_at: assignment.leftAt,
        is_primary: assignment.isPrimary,
        assigned_by_user_id: BigInt(actorUserId)
      },
      select: { trip_staff_id: true }
    });
  }

  async copyRouteStops(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripId: bigint,
    source: NonNullable<Awaited<ReturnType<TripsRepository["findRouteCopySource"]>>>
  ): Promise<void> {
    for (const template of source.route_stop_template) {
      const stop = await transaction.trip_stop.create({
        data: {
          tenant_id: BigInt(tenantId),
          trip_id: tripId,
          party_id: template.party_id,
          route_stop_template_id: template.route_stop_template_id,
          source: "ROUTE",
          sortable_order: template.default_sequence,
          notes: template.notes
        },
        select: { trip_stop_id: true }
      });
      if (template.route_stop_product.length > 0) {
        await transaction.trip_stop_product.createMany({
          data: template.route_stop_product.map((product) => ({
            tenant_id: BigInt(tenantId),
            trip_stop_id: stop.trip_stop_id,
            product_id: product.party_product.product_id,
            party_product_id: product.party_product_id,
            quantity_mode: product.quantity_mode,
            planned_qty: product.planned_qty,
            forecast_qty: product.forecast_qty,
            notes: product.notes
          }))
        });
      }
    }
  }

  async lockTrip(transaction: TenantPrismaTransaction, tenantId: number, tripId: number): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`trip:${tenantId}:${tripId}`}, 0))`
    );
  }

  findOrder(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripId: number,
    sortableOrder: number,
    excludeTripStopId?: number
  ) {
    return transaction.trip_stop.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        trip_id: BigInt(tripId),
        sortable_order: sortableOrder,
        ...(excludeTripStopId === undefined ? {} : { trip_stop_id: { not: BigInt(excludeTripStopId) } })
      },
      select: { trip_stop_id: true }
    });
  }

  async createLiveStop(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripId: number,
    actorUserId: number,
    input: AddTripStopDto
  ): Promise<bigint> {
    const stop = await transaction.trip_stop.create({
      data: {
        tenant_id: BigInt(tenantId),
        trip_id: BigInt(tripId),
        party_id: BigInt(input.partyId),
        source: input.source,
        sortable_order: input.sortableOrder,
        added_by_user_id: BigInt(actorUserId),
        notes: input.notes
      },
      select: { trip_stop_id: true }
    });
    await transaction.trip_stop_product.createMany({
      data: input.products.map((product) => ({
        tenant_id: BigInt(tenantId),
        trip_stop_id: stop.trip_stop_id,
        product_id: BigInt(product.productId),
        party_product_id: product.partyProductId === undefined ? undefined : BigInt(product.partyProductId),
        quantity_mode: product.quantityMode,
        planned_qty: product.plannedQty,
        forecast_qty: product.forecastQty,
        notes: product.notes
      }))
    });
    return stop.trip_stop_id;
  }

  findStop(transaction: TenantPrismaTransaction, tenantId: number, tripId: number, tripStopId: number) {
    return transaction.trip_stop.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        trip_id: BigInt(tripId),
        trip_stop_id: BigInt(tripStopId)
      },
      select: { trip_stop_id: true, status: true, sortable_order: true }
    });
  }

  reorderStop(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripStopId: number,
    sortableOrder: number
  ) {
    return transaction.trip_stop.update({
      where: {
        tenant_id_trip_stop_id: {
          tenant_id: BigInt(tenantId),
          trip_stop_id: BigInt(tripStopId)
        }
      },
      data: { sortable_order: sortableOrder },
      select: { trip_stop_id: true, sortable_order: true, status: true }
    });
  }

  updateStatus(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripId: number,
    status: "LOADED" | "DISPATCHED" | "IN_PROGRESS",
    actualStartAt?: Date
  ) {
    return transaction.trip.update({
      where: {
        tenantId_tripId: { tenantId: BigInt(tenantId), tripId: BigInt(tripId) }
      },
      data: { status, actual_start_at: actualStartAt },
      select: tripSummarySelection
    });
  }
}
