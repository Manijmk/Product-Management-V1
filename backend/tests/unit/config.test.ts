import { describe, expect, it } from "@jest/globals";
import { loadConfig } from "../../src/config/env.js";

const validEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/pms",
  AUTH_JWT_SECRET: "test-secret-that-is-at-least-32-characters"
};

describe("environment configuration", () => {
  it("loads validated defaults", () => {
    const config = loadConfig(validEnvironment);

    expect(config).toMatchObject({
      APP_NAME: "pms-backend",
      APP_PORT: 4000,
      DATABASE_POOL_MIN: 2,
      DATABASE_POOL_MAX: 10,
      AUTH_JWT_ISSUER: "pms-backend",
      AUTH_JWT_AUDIENCE: "pms-api",
      SWAGGER_ENABLED: true
    });
  });

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() => loadConfig({ ...validEnvironment, DATABASE_URL: "mysql://localhost/pms" }))
      .toThrow("Database URLs must use the PostgreSQL protocol");
  });

  it("rejects an invalid pool range", () => {
    expect(() => loadConfig({
      ...validEnvironment,
      DATABASE_POOL_MIN: "11",
      DATABASE_POOL_MAX: "10"
    })).toThrow("DATABASE_POOL_MIN cannot exceed DATABASE_POOL_MAX");
  });
});
