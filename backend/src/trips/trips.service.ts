import { HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ADMIN_ROLE, OWNER_ROLE } from "../auth/roles.js";
import { ApiError } from "../http/api-error.js";
import { type ListQueryDto, pageResponse } from "../http/list-query.dto.js";
import { tripAcceptsPlanningChanges, validatePlanningQuantity } from "../operations/planning-rules.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";
import type { AddTripStopDto } from "./dto/add-trip-stop.dto.js";
import type { CreateTripDto } from "./dto/create-trip.dto.js";
import type { ReorderTripStopDto } from "./dto/reorder-trip-stop.dto.js";
import type { AddTripStaffDto, TripStaffRole } from "./dto/trip-staff.dto.js";
import { TripsRepository } from "./trips.repository.js";

type TripSummary = Awaited<ReturnType<TripsRepository["list"]>>[number];
type TripDetail = NonNullable<Awaited<ReturnType<TripsRepository["find"]>>>;

function mapTrip(trip: TripSummary) {
  return {
    tripId: trip.tripId.toString(),
    tripNumber: trip.tripNumber,
    routeId: trip.routeId?.toString() ?? null,
    tripDate: trip.tripDate.toISOString().slice(0, 10),
    shiftCode: trip.shift_code,
    vehicleId: trip.vehicleId?.toString() ?? null,
    primaryStaffId: trip.primaryStaffId?.toString() ?? null,
    status: trip.status,
    plannedStartAt: trip.planned_start_at?.toISOString() ?? null,
    actualStartAt: trip.actual_start_at?.toISOString() ?? null,
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString()
  };
}

function mapDetail(trip: TripDetail) {
  return {
    ...mapTrip(trip),
    route: trip.route === null ? null : { routeCode: trip.route.route_code, routeName: trip.route.route_name },
    vehicle: trip.vehicle === null ? null : {
      registrationNo: trip.vehicle.registration_no,
      vehicleType: trip.vehicle.vehicle_type,
      status: trip.vehicle.status
    },
    primaryStaff: trip.staff === null ? null : { name: trip.staff.name, status: trip.staff.status },
    staff: trip.trip_staff.map((assignment) => ({
      tripStaffId: assignment.trip_staff_id.toString(),
      staffId: assignment.staff_id.toString(),
      staffName: assignment.staff.name,
      staffStatus: assignment.staff.status,
      tripRole: assignment.trip_role,
      joinedAt: assignment.joined_at?.toISOString() ?? null,
      leftAt: assignment.left_at?.toISOString() ?? null,
      isPrimary: assignment.is_primary
    })),
    stops: trip.trip_stop.map((stop) => ({
      tripStopId: stop.trip_stop_id.toString(),
      partyId: stop.party_id.toString(),
      partyName: stop.party.name,
      customerStatus: stop.party.customerStatus,
      routeStopTemplateId: stop.route_stop_template_id?.toString() ?? null,
      source: stop.source,
      sortableOrder: stop.sortable_order.toString(),
      status: stop.status,
      notes: stop.notes,
      addedAt: stop.added_at.toISOString(),
      products: stop.trip_stop_product.map((product) => ({
        tripStopProductId: product.trip_stop_product_id.toString(),
        productId: product.product_id.toString(),
        productCode: product.product.productCode,
        productName: product.product.name,
        partyProductId: product.party_product_id?.toString() ?? null,
        quantityMode: product.quantity_mode,
        plannedQty: product.planned_qty?.toString() ?? null,
        forecastQty: product.forecast_qty?.toString() ?? null,
        priceSnapshot: product.price_snapshot?.toString() ?? null,
        status: product.status,
        notes: product.notes
      }))
    }))
  };
}

function parseAssignment(input: AddTripStaffDto, isPrimary = false) {
  const joinedAt = input.joinedAt === undefined ? new Date() : new Date(input.joinedAt);
  const leftAt = input.leftAt === undefined ? undefined : new Date(input.leftAt);
  if (leftAt !== undefined && leftAt < joinedAt) {
    throw new ApiError(HttpStatus.BAD_REQUEST, "INVALID_TRIP_STAFF_PERIOD", "leftAt must not precede joinedAt");
  }
  return { staffId: input.staffId, tripRole: input.tripRole, joinedAt, leftAt, isPrimary };
}

@Injectable()
export class TripsService {
  constructor(
    private readonly transactions: PrismaTenantTransactionService,
    private readonly repository: TripsRepository
  ) {}

  list(context: AuthenticatedTenantContext, query: ListQueryDto) {
    return this.transactions.run(context, async (transaction) => pageResponse(
      (await this.repository.list(transaction, context.tenantId)).map(mapTrip), query
    ));
  }

  get(context: AuthenticatedTenantContext, tripId: number) {
    return this.transactions.run(context, async (transaction) => {
      const trip = await this.repository.find(transaction, context.tenantId, tripId);
      if (trip === null) throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_NOT_FOUND", "The trip was not found");
      return mapDetail(trip);
    });
  }

  create(context: AuthenticatedTenantContext, input: CreateTripDto) {
    const tripNumber = input.tripNumber ?? `TRIP-${input.tripDate}-${randomUUID().slice(0, 8).toUpperCase()}`;
    return this.transactions.run(context, async (transaction) => {
      const route = input.routeId == null
        ? null
        : await this.repository.findRouteCopySource(transaction, context.tenantId, input.routeId);
      if (input.routeId != null && route === null) {
        throw new ApiError(HttpStatus.NOT_FOUND, "ROUTE_NOT_FOUND", "The active route was not found");
      }
      if (input.vehicleId !== undefined) {
        const vehicle = await this.repository.findVehicle(transaction, context.tenantId, input.vehicleId);
        if (vehicle === null) throw new ApiError(HttpStatus.NOT_FOUND, "VEHICLE_NOT_FOUND", "The vehicle was not found");
        if (!["ACTIVE", "IN_SERVICE"].includes(vehicle.status)) {
          throw new ApiError(HttpStatus.CONFLICT, "VEHICLE_NOT_AVAILABLE", "The vehicle status does not allow trip assignment");
        }
      }
      const staffIds = new Set<number>([
        ...(input.primaryStaffId === undefined ? [] : [input.primaryStaffId]),
        ...(input.staff ?? []).map((assignment) => assignment.staffId)
      ]);
      for (const staffId of staffIds) {
        const staff = await this.repository.findStaff(transaction, context.tenantId, staffId);
        if (staff === null) throw new ApiError(HttpStatus.NOT_FOUND, "STAFF_NOT_FOUND", "A trip staff member was not found");
        if (staff.status !== "ACTIVE") {
          throw new ApiError(HttpStatus.CONFLICT, "STAFF_NOT_ACTIVE", "A trip staff member is not active");
        }
      }

      const created = await this.repository.createTrip(transaction, context.tenantId, context.userId, tripNumber, input);
      const assignmentTime = new Date();
      if (input.primaryStaffId !== undefined) {
        await this.repository.createTripStaff(transaction, context.tenantId, created.tripId, context.userId, {
          staffId: input.primaryStaffId,
          tripRole: "DELIVERY_STAFF",
          joinedAt: assignmentTime,
          isPrimary: true
        });
      }
      for (const staffInput of input.staff ?? []) {
        if (staffInput.staffId === input.primaryStaffId && staffInput.tripRole === "DELIVERY_STAFF") continue;
        await this.repository.createTripStaff(
          transaction,
          context.tenantId,
          created.tripId,
          context.userId,
          parseAssignment(staffInput)
        );
      }

      if (route !== null) {
        const orders = new Set<string>();
        for (const stop of route.route_stop_template) {
          const order = stop.default_sequence.toString();
          if (orders.has(order)) {
            throw new ApiError(HttpStatus.CONFLICT, "ROUTE_STOP_ORDER_CONFLICT", "The route contains duplicate active stop ordering");
          }
          orders.add(order);
          if (!["ACTIVE", "TEMPORARY"].includes(stop.party.customerStatus)) {
            throw new ApiError(HttpStatus.CONFLICT, "INVALID_ROUTE_CUSTOMER", "A route customer cannot be copied to the trip");
          }
          for (const product of stop.route_stop_product) {
            if (
              product.party_product.party_id !== stop.party_id ||
              product.party_product.active_status !== "ACTIVE" ||
              product.party_product.product.activeStatus !== "ACTIVE"
            ) {
              throw new ApiError(HttpStatus.CONFLICT, "INVALID_ROUTE_STOP_PRODUCT", "A route stop product is no longer active or customer-scoped");
            }
            validatePlanningQuantity(
              product.quantity_mode as "FIXED_PLANNED" | "RETURN_MATCHED" | "AD_HOC",
              product.planned_qty?.toNumber(),
              product.forecast_qty?.toNumber()
            );
          }
        }
        await this.repository.copyRouteStops(transaction, context.tenantId, created.tripId, route);
      }
      return mapDetail((await this.repository.find(transaction, context.tenantId, Number(created.tripId)))!);
    });
  }

  addStaff(context: AuthenticatedTenantContext, tripId: number, input: AddTripStaffDto) {
    const assignment = parseAssignment(input);
    return this.transactions.run(context, async (transaction) => {
      const [trip, staff] = await Promise.all([
        this.repository.find(transaction, context.tenantId, tripId),
        this.repository.findStaff(transaction, context.tenantId, input.staffId)
      ]);
      if (trip === null) throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_NOT_FOUND", "The trip was not found");
      if (!tripAcceptsPlanningChanges(trip.status)) {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_TRIP_STATUS", "The trip status does not allow staff assignment");
      }
      if (staff === null) throw new ApiError(HttpStatus.NOT_FOUND, "STAFF_NOT_FOUND", "The staff member was not found");
      if (staff.status !== "ACTIVE") throw new ApiError(HttpStatus.CONFLICT, "STAFF_NOT_ACTIVE", "The staff member is not active");
      await this.repository.createTripStaff(
        transaction,
        context.tenantId,
        BigInt(tripId),
        context.userId,
        assignment
      );
      return mapDetail((await this.repository.find(transaction, context.tenantId, tripId))!);
    });
  }

  addStop(context: AuthenticatedTenantContext, tripId: number, input: AddTripStopDto) {
    if (input.source === "ROUTE") {
      throw new ApiError(HttpStatus.BAD_REQUEST, "INVALID_STOP_SOURCE", "ROUTE is reserved for template copies");
    }
    const administrative = context.roles.includes(OWNER_ROLE) || context.roles.includes(ADMIN_ROLE);
    if (!administrative && input.source === "ADMIN_ADDED") {
      throw new ApiError(HttpStatus.FORBIDDEN, "INVALID_STOP_SOURCE", "Route Staff cannot add an ADMIN_ADDED stop");
    }
    for (const product of input.products) {
      validatePlanningQuantity(product.quantityMode, product.plannedQty, product.forecastQty);
    }
    return this.transactions.run(context, async (transaction) => {
      const trip = await this.repository.find(transaction, context.tenantId, tripId);
      if (trip === null) throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_NOT_FOUND", "The trip was not found");
      if (!tripAcceptsPlanningChanges(trip.status)) {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_TRIP_STATUS", "The trip status does not allow new stops");
      }
      const customer = await this.repository.findCustomer(transaction, context.tenantId, input.partyId);
      if (customer === null) throw new ApiError(HttpStatus.NOT_FOUND, "CUSTOMER_NOT_FOUND", "The customer was not found");
      if (!["ACTIVE", "TEMPORARY"].includes(customer.customerStatus)) {
        throw new ApiError(HttpStatus.CONFLICT, "CUSTOMER_NOT_ACTIVE", "Only active or temporary customers may be added");
      }
      for (const product of input.products) {
        if (await this.repository.findProduct(transaction, context.tenantId, product.productId) === null) {
          throw new ApiError(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "A stop product was not found");
        }
        if (
          product.partyProductId !== undefined &&
          await this.repository.findPartyProduct(
            transaction,
            context.tenantId,
            input.partyId,
            product.productId,
            product.partyProductId
          ) === null
        ) {
          throw new ApiError(HttpStatus.NOT_FOUND, "PARTY_PRODUCT_NOT_FOUND", "A stop product is not configured for this customer");
        }
      }
      await this.repository.lockTrip(transaction, context.tenantId, tripId);
      if (await this.repository.findOrder(transaction, context.tenantId, tripId, input.sortableOrder) !== null) {
        throw new ApiError(HttpStatus.CONFLICT, "TRIP_STOP_ORDER_CONFLICT", "The trip already has a stop at this order");
      }
      await this.repository.createLiveStop(transaction, context.tenantId, tripId, context.userId, input);
      return mapDetail((await this.repository.find(transaction, context.tenantId, tripId))!);
    });
  }

  reorderStop(context: AuthenticatedTenantContext, tripId: number, tripStopId: number, input: ReorderTripStopDto) {
    return this.transactions.run(context, async (transaction) => {
      const trip = await this.repository.find(transaction, context.tenantId, tripId);
      if (trip === null) throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_NOT_FOUND", "The trip was not found");
      if (!tripAcceptsPlanningChanges(trip.status)) {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_TRIP_STATUS", "The trip status does not allow stop reordering");
      }
      const stop = await this.repository.findStop(transaction, context.tenantId, tripId, tripStopId);
      if (stop === null) throw new ApiError(HttpStatus.NOT_FOUND, "STOP_NOT_FOUND", "The trip stop was not found");
      if (stop.status !== "PENDING") {
        throw new ApiError(HttpStatus.CONFLICT, "STOP_REORDER_NOT_ALLOWED", "Only pending stops may be reordered");
      }
      await this.repository.lockTrip(transaction, context.tenantId, tripId);
      if (await this.repository.findOrder(
        transaction,
        context.tenantId,
        tripId,
        input.sortableOrder,
        tripStopId
      ) !== null) {
        throw new ApiError(HttpStatus.CONFLICT, "TRIP_STOP_ORDER_CONFLICT", "The trip already has a stop at this order");
      }
      const reordered = await this.repository.reorderStop(
        transaction,
        context.tenantId,
        tripStopId,
        input.sortableOrder
      );
      return {
        tripStopId: reordered.trip_stop_id.toString(),
        sortableOrder: reordered.sortable_order.toString(),
        status: reordered.status
      };
    });
  }

  dispatch(context: AuthenticatedTenantContext, tripId: number) {
    return this.transactions.run(context, async (transaction) => {
      const trip = await this.repository.find(transaction, context.tenantId, tripId);
      if (trip === null) throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_NOT_FOUND", "The trip was not found");
      if (trip.status === "PLANNED") {
        await this.repository.updateStatus(transaction, context.tenantId, tripId, "LOADED");
      } else if (trip.status !== "LOADED") {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_TRIP_STATUS", "Only a planned or loaded trip may be dispatched");
      }
      return mapTrip(await this.repository.updateStatus(transaction, context.tenantId, tripId, "DISPATCHED"));
    });
  }

  start(context: AuthenticatedTenantContext, tripId: number) {
    return this.transactions.run(context, async (transaction) => {
      const trip = await this.repository.find(transaction, context.tenantId, tripId);
      if (trip === null) throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_NOT_FOUND", "The trip was not found");
      if (trip.status !== "DISPATCHED") {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_TRIP_STATUS", "Only a dispatched trip may be started");
      }
      return mapTrip(await this.repository.updateStatus(
        transaction,
        context.tenantId,
        tripId,
        "IN_PROGRESS",
        new Date()
      ));
    });
  }
}
