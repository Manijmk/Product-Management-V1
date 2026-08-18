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
        .setTitle("PMS Backend")
        .setDescription("PMS backend bootstrap API")
        .setVersion("0.1.0")
        .addBearerAuth()
        .build()
    );
    SwaggerModule.setup("api/docs", app, document);
  }
  await app.init();
  return app;
}
