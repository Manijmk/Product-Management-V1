import { describe, expect, it } from "@jest/globals";
import { customerCreationState, validatePartyProduct } from "../../src/customers/domain/customer-rules.js";
import { parseEffectivePeriod, validateProductConfiguration } from "../../src/products/domain/product-rules.js";

describe("master-data domain rules", () => {
  it("enforces product unit behavior", () => {
    expect(() => validateProductConfiguration("EXCHANGE")).toThrow("require an exchangeRatio");
    expect(() => validateProductConfiguration("CONSUMABLE", 1)).toThrow("must not carry");
    expect(() => validateProductConfiguration("EXCHANGE", 1)).not.toThrow();
  });

  it("enforces quantity-mode defaults without making RETURN_MATCHED planned quantity mandatory", () => {
    expect(() => validatePartyProduct("FIXED_PLANNED")).toThrow("requires defaultQty");
    expect(() => validatePartyProduct("RETURN_MATCHED", undefined, 8)).not.toThrow();
    expect(() => validatePartyProduct("AD_HOC")).not.toThrow();
  });

  it("derives customer approval state from authenticated roles", () => {
    expect(customerCreationState({ tenantId: 1, userId: 1, roles: ["ROUTE_STAFF"] }, "TEMPORARY"))
      .toEqual({ customerStatus: "TEMPORARY", createdSource: "STAFF" });
    expect(customerCreationState({ tenantId: 1, userId: 1, roles: ["ROUTE_STAFF"] }, "PERMANENT"))
      .toEqual({ customerStatus: "PENDING_APPROVAL", createdSource: "STAFF" });
    expect(customerCreationState({ tenantId: 1, userId: 1, roles: ["OWNER"] }, "PERMANENT"))
      .toEqual({ customerStatus: "ACTIVE", createdSource: "ADMIN" });
  });

  it("uses non-overlapping half-open effective periods", () => {
    expect(parseEffectivePeriod("2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z"))
      .toEqual({
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        effectiveTo: new Date("2026-06-01T00:00:00Z")
      });
    expect(() => parseEffectivePeriod("2026-06-01T00:00:00Z", "2026-01-01T00:00:00Z"))
      .toThrow("effectiveTo must be later");
  });
});
