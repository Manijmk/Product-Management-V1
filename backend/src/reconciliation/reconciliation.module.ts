import { Module } from "@nestjs/common";
import { ReconciliationController } from "./reconciliation.controller.js";
import { ReconciliationRepository } from "./reconciliation.repository.js";
import { ReconciliationService } from "./reconciliation.service.js";

@Module({
  controllers: [ReconciliationController],
  providers: [ReconciliationRepository, ReconciliationService]
})
export class ReconciliationModule {}
