import { describe, expect, it } from "@jest/globals";
import { ExchangeCalculationService } from "../../src/stop-events/domain/exchange-calculation.service.js";

describe("ExchangeCalculationService", () => {
  const service = new ExchangeCalculationService();

  it("calculates a normal return-matched exchange", () => {
    expect(service.calculate({ exchangeRatio: 1, observedGoodEmptyQty: 8, fullQtyDelivered: 8 })).toEqual({
      suggestedFullQty: 8,
      acceptedGoodEmptyQty: 8,
      containerCreditQty: 0,
      containerDueQty: 0,
      excessEmptyQty: 0
    });
  });

  it("records excess empties as credit or leaves them with the customer", () => {
    expect(service.calculate({
      exchangeRatio: 1,
      observedGoodEmptyQty: 12,
      fullQtyDelivered: 8,
      excessEmptyResolution: "ACCEPT_AS_CREDIT"
    })).toMatchObject({ acceptedGoodEmptyQty: 12, containerCreditQty: 4 });
    expect(service.calculate({
      exchangeRatio: 1,
      observedGoodEmptyQty: 12,
      fullQtyDelivered: 8,
      excessEmptyResolution: "ACCEPT_ONLY_REPLACED"
    })).toMatchObject({ acceptedGoodEmptyQty: 8, containerCreditQty: 0, excessEmptyQty: 4 });
  });

  it("requires explicit authorization for container due", () => {
    expect(() => service.calculate({
      exchangeRatio: 1,
      observedGoodEmptyQty: 3,
      fullQtyDelivered: 5
    })).toThrow("container-due authorization");
    expect(service.calculate({
      exchangeRatio: 1,
      observedGoodEmptyQty: 3,
      fullQtyDelivered: 5,
      authorizeContainerDue: true
    })).toMatchObject({ containerDueQty: 2 });
  });
});
