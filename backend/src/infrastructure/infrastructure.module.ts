import { DynamicModule, Global, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import { APP_CONFIG, PG_POOL } from "./tokens.js";
import { PrismaService } from "./prisma.service.js";
import { TenantTransactionService } from "../tenancy/tenant-transaction.service.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";

@Global()
@Module({})
export class InfrastructureModule {
  static register(config: AppConfig, pool: Pool): DynamicModule {
    return {
      module: InfrastructureModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            genReqId: (request) => String(request.headers["x-correlation-id"] ?? randomUUID()),
            redact: ["req.headers.authorization"]
          }
        })
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: PG_POOL, useValue: pool },
        { provide: PrismaService, useFactory: () => new PrismaService({ datasourceUrl: config.DATABASE_URL }) },
        TenantTransactionService,
        PrismaTenantTransactionService
      ],
      exports: [
        APP_CONFIG,
        PG_POOL,
        PrismaService,
        TenantTransactionService,
        PrismaTenantTransactionService,
        LoggerModule
      ]
    };
  }
}
