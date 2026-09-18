import { Module } from "@nestjs/common";
import { ExchangeCalculationService } from "./domain/exchange-calculation.service.js";
import { PostingService } from "./domain/posting.service.js";
import { StopEventsController } from "./stop-events.controller.js";
import { StopEventsRepository } from "./stop-events.repository.js";
import { StopEventsService } from "./stop-events.service.js";

@Module({
  controllers: [StopEventsController],
  providers: [StopEventsRepository, StopEventsService, ExchangeCalculationService, PostingService]
})
export class StopEventsModule {}
