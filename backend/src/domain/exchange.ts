import { AppError } from "../http/errors.js";

export type QuantityMode = "FIXED_PLANNED" | "RETURN_MATCHED" | "AD_HOC";
export type ExcessEmptyResolution = "ACCEPT_AS_CREDIT" | "ACCEPT_ONLY_REPLACED";

export interface ExchangeInput {
  quantityMode: QuantityMode;
  exchangeRatio: number | null;
  observedGoodEmptyQty: number;
  acceptedGoodEmptyQty: number;
  damagedEmptyQty: number;
  rejectedEmptyQty: number;
  fullQtyDelivered: number;
  availableFullQty: number;
  excessEmptyResolution?: ExcessEmptyResolution;
  authorizeContainerDue?: boolean;
}

export interface ExchangeResult {
  suggestedFullQty: number;
  containerCreditQty: number;
  containerDueQty: number;
  exceptions: Array<{ type: "EXCESS_EMPTY" | "CONTAINER_DUE" | "STOCK_SHORTAGE"; quantity: number; resolution: string }>;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function calculateExchange(input: ExchangeInput): ExchangeResult {
  const quantities = [
    input.observedGoodEmptyQty,
    input.acceptedGoodEmptyQty,
    input.damagedEmptyQty,
    input.rejectedEmptyQty,
    input.fullQtyDelivered,
    input.availableFullQty
  ];
  if (quantities.some((quantity) => !Number.isFinite(quantity) || quantity < 0)) {
    throw new AppError(422, "INVALID_QUANTITY", "Exchange quantities must be finite and non-negative");
  }
  if (input.acceptedGoodEmptyQty > input.observedGoodEmptyQty) {
    throw new AppError(422, "ACCEPTED_EMPTY_EXCEEDS_OBSERVED", "Accepted eligible empties cannot exceed observed eligible empties");
  }
  if (input.fullQtyDelivered > input.availableFullQty) {
    throw new AppError(409, "INSUFFICIENT_VEHICLE_STOCK", "Full quantity delivered exceeds ledger-derived vehicle stock", {
      availableFullQty: input.availableFullQty
    });
  }

  if (input.quantityMode !== "RETURN_MATCHED") {
    return { suggestedFullQty: input.fullQtyDelivered, containerCreditQty: 0, containerDueQty: 0, exceptions: [] };
  }
  if (!input.exchangeRatio || input.exchangeRatio <= 0) {
    throw new AppError(422, "INVALID_EXCHANGE_RATIO", "RETURN_MATCHED products require a positive exchange ratio");
  }

  const suggestedFullQty = round(input.observedGoodEmptyQty / input.exchangeRatio);
  const equivalentEmptyQty = round(input.fullQtyDelivered * input.exchangeRatio);
  const credit = round(Math.max(input.acceptedGoodEmptyQty - equivalentEmptyQty, 0));
  const due = round(Math.max(equivalentEmptyQty - input.acceptedGoodEmptyQty, 0));
  const exceptions: ExchangeResult["exceptions"] = [];

  if (input.observedGoodEmptyQty > equivalentEmptyQty) {
    const excess = round(input.observedGoodEmptyQty - equivalentEmptyQty);
    if (!input.excessEmptyResolution) {
      throw new AppError(422, "EXCESS_EMPTY_RESOLUTION_REQUIRED", "An explicit excess-empty resolution is required");
    }
    if (input.excessEmptyResolution === "ACCEPT_AS_CREDIT") {
      if (input.acceptedGoodEmptyQty !== input.observedGoodEmptyQty || credit <= 0) {
        throw new AppError(422, "INVALID_ACCEPT_AS_CREDIT", "Accept-as-credit must accept all observed eligible empties");
      }
    } else if (input.acceptedGoodEmptyQty !== equivalentEmptyQty || credit !== 0) {
      throw new AppError(422, "INVALID_ACCEPT_ONLY_REPLACED", "Replacement-only must accept exactly the empties replaced");
    }
    exceptions.push({ type: "EXCESS_EMPTY", quantity: excess, resolution: input.excessEmptyResolution });
    if (input.fullQtyDelivered < suggestedFullQty) {
      exceptions.push({ type: "STOCK_SHORTAGE", quantity: round(suggestedFullQty - input.fullQtyDelivered), resolution: "PARTIAL_DELIVERY" });
    }
  }

  if (due > 0) {
    if (!input.authorizeContainerDue) {
      throw new AppError(422, "CONTAINER_DUE_AUTHORIZATION_REQUIRED", "Delivering more full containers than exchanged requires explicit staff authorization");
    }
    exceptions.push({ type: "CONTAINER_DUE", quantity: due, resolution: "DELIVER_WITH_CONTAINER_DUE" });
  }

  return { suggestedFullQty, containerCreditQty: credit, containerDueQty: due, exceptions };
}
