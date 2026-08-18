import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import type { Pool } from "pg";
import type { AppConfig } from "./config/env.js";
import { errorHandler } from "./http/errors.js";
import { registerRoutes } from "./http/routes.js";

export async function buildApp(config: AppConfig, pool: Pool) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, genReqId: (request) => String(request.headers["x-correlation-id"] ?? crypto.randomUUID()) });
  await app.register(fastifyJwt, { secret: config.JWT_SECRET });
  app.setErrorHandler(errorHandler);
  await registerRoutes(app, pool, config);
  return app;
}
