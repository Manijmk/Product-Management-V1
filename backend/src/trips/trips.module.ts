import { Module } from "@nestjs/common";
import { TripsController } from "./trips.controller.js";
import { TripsRepository } from "./trips.repository.js";
import { TripsService } from "./trips.service.js";

@Module({ controllers: [TripsController], providers: [TripsRepository, TripsService] })
export class TripsModule {}
