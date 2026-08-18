import { DomainError } from "../../domain/domain-error.js";
import type { AuthenticatedTenantContext } from "../../tenancy/authenticated-tenant-context.js";
import { ADMIN_ROLE, OWNER_ROLE } from "../../auth/roles.js";

export const RELATIONSHIP_TYPES = ["SUBSCRIPTION_ROUTE", "AD_HOC", "WALK_IN"] as const;
export type RelationshipType = typeof RELATIONSHIP_TYPES[number];
export const CUSTOMER_CREATION_MODES = ["TEMPORARY", "PERMANENT"] as const;
export type CustomerCreationMode = typeof CUSTOMER_CREATION_MODES[number];
export const QUANTITY_MODES = ["FIXED_PLANNED", "RETURN_MATCHED", "AD_HOC"] as const;
export type QuantityMode = typeof QUANTITY_MODES[number];
export const EXCHANGE_POLICIES = ["STRICT", "ALLOW_CONTAINER_DUE", "STAFF_OVERRIDE"] as const;
export type ExchangePolicy = typeof EXCHANGE_POLICIES[number];

export function customerCreationState(
  context: AuthenticatedTenantContext,
  mode: CustomerCreationMode
): { customerStatus: "TEMPORARY" | "PENDING_APPROVAL" | "ACTIVE"; createdSource: "ADMIN" | "STAFF" } {
  const administrative = context.roles.includes(OWNER_ROLE) || context.roles.includes(ADMIN_ROLE);
  if (mode === "TEMPORARY") {
    return { customerStatus: "TEMPORARY", createdSource: administrative ? "ADMIN" : "STAFF" };
  }
  return administrative
    ? { customerStatus: "ACTIVE", createdSource: "ADMIN" }
    : { customerStatus: "PENDING_APPROVAL", createdSource: "STAFF" };
}

export function validatePartyProduct(quantityMode: QuantityMode, defaultQty?: number, forecastQty?: number): void {
  if (quantityMode === "FIXED_PLANNED" && (defaultQty === undefined || defaultQty <= 0)) {
    throw new DomainError(
      "FIXED_PLANNED_DEFAULT_QTY_REQUIRED",
      "FIXED_PLANNED configuration requires defaultQty greater than zero"
    );
  }
  if (defaultQty !== undefined && defaultQty <= 0) {
    throw new DomainError("INVALID_DEFAULT_QTY", "defaultQty must be greater than zero when provided");
  }
  if (forecastQty !== undefined && forecastQty <= 0) {
    throw new DomainError("INVALID_FORECAST_QTY", "forecastQty must be greater than zero when provided");
  }
}
