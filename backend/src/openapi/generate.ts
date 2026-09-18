import "reflect-metadata";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import type { AppConfig } from "../config/env.js";
import { createPool } from "../db/pool.js";

const config: AppConfig = {
  NODE_ENV: "test",
  APP_NAME: "pms-openapi-generator",
  APP_PORT: 4000,
  DATABASE_URL: "postgresql://openapi:openapi@127.0.0.1:5432/openapi",
  DATABASE_POOL_MIN: 0,
  DATABASE_POOL_MAX: 1,
  AUTH_JWT_SECRET: "openapi-generation-secret-at-least-32-characters",
  AUTH_JWT_ISSUER: "pms-backend",
  AUTH_JWT_AUDIENCE: "pms-api",
  LOG_LEVEL: "silent",
  SWAGGER_ENABLED: true
};
const pool = createPool(config);
const app = await buildApp(config, pool);
try {
  const server = app.getHttpAdapter().getInstance() as FastifyInstance;
  await server.ready();
  const response = await server.inject({ method: "GET", url: "/api/openapi.json" });
  if (response.statusCode !== 200) throw new Error(`OpenAPI generation failed with HTTP ${response.statusCode}`);
  const outputDirectory = path.resolve(process.cwd(), "..", "docs");
  const outputPath = path.join(outputDirectory, "openapi-v1.json");
  const serialized = `${JSON.stringify(response.json(), null, 2)}\n`;
  if (process.argv.includes("--verify")) {
    const frozen = await readFile(outputPath, "utf8");
    if (frozen !== serialized) throw new Error("Frozen OpenAPI contract is out of date; run npm run openapi:generate");
  } else {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
  }
} finally {
  await app.close();
  await pool.end();
}
