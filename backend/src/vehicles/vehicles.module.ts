import { Module } from "@nestjs/common";
import { VehiclesController } from "./vehicles.controller.js";
import { VehiclesRepository } from "./vehicles.repository.js";
import { VehiclesService } from "./vehicles.service.js";

@Module({ controllers: [VehiclesController], providers: [VehiclesRepository, VehiclesService] })
export class VehiclesModule {}
