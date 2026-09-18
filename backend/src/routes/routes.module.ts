import { Module } from "@nestjs/common";
import { RoutesController } from "./routes.controller.js";
import { RoutesRepository } from "./routes.repository.js";
import { RoutesService } from "./routes.service.js";

@Module({ controllers: [RoutesController], providers: [RoutesRepository, RoutesService] })
export class RoutesModule {}
