import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { Pool } from "pg";
import { Logger } from "nestjs-pino";
import type { AppConfig } from "./config/env.js";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./http/api-exception.filter.js";
import { ApiError } from "./http/api-error.js";
import { HttpStatus } from "@nestjs/common";
import { ApiErrorResponseDto } from "./http/api-contract.dto.js";
import { API_ERROR_CODES } from "./http/error-codes.js";
import { applySuccessResponseContracts, validateOpenApiContract } from "./openapi/response-contracts.js";

export async function buildApp(config: AppConfig, pool: Pool): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config, pool),
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: true }
  );
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) => new ApiError(
      HttpStatus.BAD_REQUEST,
      "VALIDATION_FAILED",
      "The request payload is invalid",
      { fields: errors.map((error) => ({ field: error.property, constraints: error.constraints ?? {} })) }
    )
  }));
  app.setGlobalPrefix("api/v1");
  if (config.SWAGGER_ENABLED) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("PMS Sprint 0 API")
        .setDescription("Frozen Sprint 0 operational API contract. Tenant context is derived from the bearer token.")
        .setVersion("1.0.0")
        .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" })
        .addTag("auth", "Local password authentication and current-user context")
        .addTag("users", "Tenant users and role assignments")
        .addTag("staff", "Operational staff")
        .addTag("products", "Product, price, and damage-rate master data")
        .addTag("customers", "Customer master data and approvals")
        .addTag("routes", "Route templates")
        .addTag("vehicles", "Vehicles")
        .addTag("trips", "Flexible trip planning")
        .addTag("stop-events", "Idempotent stop execution and ledger posting")
        .addTag("reconciliation", "Trip completion, reconciliation, and handover")
        .build(),
      {
        extraModels: [ApiErrorResponseDto],
        operationIdFactory: (controllerKey, methodKey) => `${controllerKey.replace(/Controller$/, "")}_${methodKey}`
      }
    );
    applySuccessResponseContracts(document);
    Object.assign(document, { "x-pms-error-codes": API_ERROR_CODES });
    const errorDescriptions: Readonly<Record<string, string>> = {
      "400": "Invalid request or domain rule violation",
      "401": "Authentication required or invalid",
      "403": "Authenticated role is not authorized",
      "404": "Tenant-scoped resource not found",
      "409": "Resource state or uniqueness conflict",
      "500": "Unexpected server error"
    };
    for (const pathItem of Object.values(document.paths)) {
      if (pathItem === undefined) continue;
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        const operation = pathItem[method];
        if (operation === undefined) continue;
        for (const [status, description] of Object.entries(errorDescriptions)) {
          operation.responses[status] ??= {
            description,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiErrorResponseDto" } }
            }
          };
        }
      }
    }
    validateOpenApiContract(document);
    SwaggerModule.setup("api/docs", app, document);
    app.getHttpAdapter().getInstance().get("/api/openapi.json", () => document);
  }
  await app.init();
  return app;
}
