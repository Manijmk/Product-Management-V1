import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../http/api-error.js";
import { type ListQueryDto, pageResponse } from "../http/list-query.dto.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";
import type { CreateVehicleDto } from "./dto/create-vehicle.dto.js";
import { VehiclesRepository } from "./vehicles.repository.js";

type VehicleRecord = Awaited<ReturnType<VehiclesRepository["list"]>>[number];

function mapVehicle(vehicle: VehicleRecord) {
  return {
    vehicleId: vehicle.vehicle_id.toString(),
    registrationNo: vehicle.registration_no,
    vehicleType: vehicle.vehicle_type,
    capacity: vehicle.capacity?.toString() ?? null,
    capacityUnit: vehicle.capacity_unit,
    ownershipType: vehicle.ownership_type,
    status: vehicle.status,
    notes: vehicle.notes,
    createdAt: vehicle.created_at.toISOString(),
    updatedAt: vehicle.updated_at.toISOString()
  };
}

@Injectable()
export class VehiclesService {
  constructor(
    private readonly transactions: PrismaTenantTransactionService,
    private readonly repository: VehiclesRepository
  ) {}

  list(context: AuthenticatedTenantContext, query: ListQueryDto) {
    return this.transactions.run(context, async (transaction) => pageResponse(
      (await this.repository.list(transaction, context.tenantId)).map(mapVehicle), query
    ));
  }

  get(context: AuthenticatedTenantContext, vehicleId: number) {
    return this.transactions.run(context, async (transaction) => {
      const vehicle = await this.repository.find(transaction, context.tenantId, vehicleId);
      if (vehicle === null) throw new ApiError(HttpStatus.NOT_FOUND, "VEHICLE_NOT_FOUND", "The vehicle was not found");
      return mapVehicle(vehicle);
    });
  }

  create(context: AuthenticatedTenantContext, input: CreateVehicleDto) {
    return this.transactions.run(context, async (transaction) => {
      const vehicle = await this.repository.create(transaction, context.tenantId, context.userId, input);
      await this.repository.createInventoryLocation(transaction, context.tenantId, context.userId, vehicle);
      return mapVehicle(vehicle);
    });
  }
}
