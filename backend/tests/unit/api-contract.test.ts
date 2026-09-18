import { describe, expect, it } from "@jest/globals";
import { API_ERROR_CODES } from "../../src/http/error-codes.js";
import { ListQueryDto, pageResponse } from "../../src/http/list-query.dto.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { OpenAPIObject } from "@nestjs/swagger";
import { OPERATION_SUCCESS_CONTRACTS, validateOpenApiContract } from "../../src/openapi/response-contracts.js";

describe("Sprint 0 frozen API conventions", () => {
  it("keeps the stable error catalog sorted and duplicate-free", () => {
    expect(API_ERROR_CODES).toEqual([...new Set(API_ERROR_CODES)].sort());
  });

  it("applies bounded offset pagination, search, status, and deterministic metadata", () => {
    const query = Object.assign(new ListQueryDto(), { limit: 1, offset: 0, q: "alpha", status: "ACTIVE" });
    expect(pageResponse([
      { name: "Alpha", status: "ACTIVE" },
      { name: "Alpha old", status: "INACTIVE" },
      { name: "Beta", status: "ACTIVE" }
    ], query)).toEqual({
      items: [{ name: "Alpha", status: "ACTIVE" }],
      page: { limit: 1, offset: 0, count: 1, total: 1, hasMore: false }
    });
  });

  it("freezes every operation with a named success schema and valid security contract", () => {
    const document = JSON.parse(readFileSync(path.resolve(process.cwd(), "../docs/openapi-v1.json"), "utf8")) as OpenAPIObject;
    expect(() => validateOpenApiContract(document)).not.toThrow();
    expect(Object.keys(OPERATION_SUCCESS_CONTRACTS)).toHaveLength(53);
  });
});
