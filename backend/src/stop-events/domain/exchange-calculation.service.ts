import { Injectable } from "@nestjs/common";
import { DomainError } from "../../domain/domain-error.js";
import type { ExcessEmptyResolution } from "../dto/create-stop-event.dto.js";

const qty = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;

export interface ExchangeCalculationInput {
  readonly exchangeRatio: number;
  readonly observedGoodEmptyQty: number;
  readonly fullQtyDelivered: number;
  readonly excessEmptyResolution?: ExcessEmptyResolution;
  readonly authorizeContainerDue?: boolean;
}

export interface ExchangeCalculationResult {
  readonly suggestedFullQty: number;
  readonly acceptedGoodEmptyQty: number;
  readonly containerCreditQty: number;
  readonly containerDueQty: number;
  readonly excessEmptyQty: number;
}

@Injectable()
export class ExchangeCalculationService {
  calculate(input: ExchangeCalculationInput): ExchangeCalculationResult {
    if (!Number.isFinite(input.exchangeRatio) || input.exchangeRatio <= 0) {
      throw new DomainError("INVALID_EXCHANGE_RATIO", "An exchange product must have a positive exchange ratio");
    }
    const requiredEmpties = qty(input.fullQtyDelivered * input.exchangeRatio);
    const suggestedFullQty = qty(input.observedGoodEmptyQty / input.exchangeRatio);
    const excessEmptyQty = qty(Math.max(input.observedGoodEmptyQty - requiredEmpties, 0));
    const containerDueQty = qty(Math.max(requiredEmpties - input.observedGoodEmptyQty, 0));

    if (excessEmptyQty > 0 && input.excessEmptyResolution === undefined) {
      throw new DomainError(
        "EXCESS_EMPTY_RESOLUTION_REQUIRED",
        "Excess eligible empties require an explicit resolution"
      );
    }
    if (containerDueQty > 0 && input.authorizeContainerDue !== true) {
      throw new DomainError(
        "CONTAINER_DUE_AUTHORIZATION_REQUIRED",
        "Delivering more full containers than eligible returns requires container-due authorization"
      );
    }

    return {
      suggestedFullQty,
      acceptedGoodEmptyQty: input.excessEmptyResolution === "ACCEPT_ONLY_REPLACED"
        ? requiredEmpties
        : input.observedGoodEmptyQty,
      containerCreditQty: input.excessEmptyResolution === "ACCEPT_AS_CREDIT" ? excessEmptyQty : 0,
      containerDueQty,
      excessEmptyQty
    };
  }
}
