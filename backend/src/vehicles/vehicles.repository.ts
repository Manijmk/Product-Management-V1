import { Injectable } from "@nestjs/common";
import type { TenantPrismaTransaction } from "../tenancy/prisma-tenant-transaction.service.js";
import type { CreateVehicleDto } from "./dto/create-vehicle.dto.js";

const vehicleSelection = {
  vehicle_id: true,
  registration_no: true,
  vehicle_type: true,
  capacity: true,
  capacity_unit: true,
  ownership_type: true,
  status: true,
  notes: true,
  created_at: true,
  updated_at: true
} as const;

@Injectable()
export class VehiclesRepository {
  list(transaction: TenantPrismaTransaction, tenantId: number) {
    return transaction.vehicle.findMany({
      where: { tenant_id: BigInt(tenantId) },
      orderBy: { registration_no: "asc" },
      select: vehicleSelection
    });
  }

  find(transaction: TenantPrismaTransaction, tenantId: number, vehicleId: number) {
    return transaction.vehicle.findFirst({
      where: { tenant_id: BigInt(tenantId), vehicle_id: BigInt(vehicleId) },
      select: vehicleSelection
    });
  }

  create(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    actorUserId: number,
    input: CreateVehicleDto
  ) {
    return transaction.vehicle.create({
      data: {
        tenant_id: BigInt(tenantId),
        registration_no: input.registrationNo,
        vehicle_type: input.vehicleType,
        capacity: input.capacity,
        capacity_unit: input.capacityUnit,
        ownership_type: input.ownershipType,
        status: input.status,
        notes: input.notes,
        created_by_user_id: BigInt(actorUserId)
      },
      select: vehicleSelection
    });
  }

  createInventoryLocation(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    actorUserId: number,
    vehicle: { vehicle_id: bigint; registration_no: string }
  ) {
    return transaction.inventory_location.create({
      data: {
        tenant_id: BigInt(tenantId),
        location_code: `VEHICLE:${vehicle.vehicle_id}`,
        name: vehicle.registration_no,
        location_type: "VEHICLE",
        vehicle_id: vehicle.vehicle_id,
        created_by_user_id: BigInt(actorUserId)
      },
      select: { inventory_location_id: true }
    });
  }
}
