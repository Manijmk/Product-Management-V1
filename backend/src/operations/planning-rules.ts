import { DomainError } from "../domain/domain-error.js";

export const QUANTITY_MODES = ["FIXED_PLANNED", "RETURN_MATCHED", "AD_HOC"] as const;
export type QuantityMode = typeof QUANTITY_MODES[number];

export const ACTIVE_TRIP_STATUSES = ["PLANNED", "LOADED", "DISPATCHED", "IN_PROGRESS"] as const;
export const TRIP_STOP_SOURCES = [
  "ROUTE",
  "ADMIN_ADDED",
  "STAFF_ADDED",
  "CUSTOMER_ORDER",
  "AD_HOC_NEW_CUSTOMER",
  "RESCHEDULED"
] as const;
export type TripStopSource = typeof TRIP_STOP_SOURCES[number];

export function validatePlanningQuantity(
  quantityMode: QuantityMode,
  plannedQty?: number,
  forecastQty?: number
): void {
  if (quantityMode === "FIXED_PLANNED" && (plannedQty === undefined || plannedQty <= 0)) {
    throw new DomainError(
      "FIXED_PLANNED_PLANNED_QTY_REQUIRED",
      "FIXED_PLANNED requires plannedQty greater than zero"
    );
  }
  if (plannedQty !== undefined && plannedQty <= 0) {
    throw new DomainError("INVALID_PLANNED_QTY", "plannedQty must be greater than zero when provided");
  }
  if (forecastQty !== undefined && forecastQty <= 0) {
    throw new DomainError("INVALID_FORECAST_QTY", "forecastQty must be greater than zero when provided");
  }
}

export function tripAcceptsPlanningChanges(status: string): boolean {
  return ACTIVE_TRIP_STATUSES.includes(status as typeof ACTIVE_TRIP_STATUSES[number]);
}
