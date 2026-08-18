import { DomainError } from "../../domain/domain-error.js";

export const PRODUCT_UNIT_TYPES = ["EXCHANGE", "CONSUMABLE", "DEPOSIT"] as const;
export type ProductUnitType = typeof PRODUCT_UNIT_TYPES[number];

export function validateProductConfiguration(unitType: ProductUnitType, exchangeRatio?: number): void {
  if (unitType === "EXCHANGE" && (exchangeRatio === undefined || exchangeRatio <= 0)) {
    throw new DomainError(
      "EXCHANGE_RATIO_REQUIRED",
      "EXCHANGE products require an exchangeRatio greater than zero"
    );
  }
  if (unitType !== "EXCHANGE" && exchangeRatio !== undefined) {
    throw new DomainError(
      "EXCHANGE_RATIO_NOT_ALLOWED",
      "CONSUMABLE and DEPOSIT products must not carry an exchangeRatio"
    );
  }
}

export function parseEffectivePeriod(effectiveFrom: string, effectiveTo?: string): {
  effectiveFrom: Date;
  effectiveTo?: Date;
} {
  const start = new Date(effectiveFrom);
  const end = effectiveTo === undefined ? undefined : new Date(effectiveTo);
  if (end !== undefined && end <= start) {
    throw new DomainError("INVALID_EFFECTIVE_PERIOD", "effectiveTo must be later than effectiveFrom");
  }
  return { effectiveFrom: start, effectiveTo: end };
}
