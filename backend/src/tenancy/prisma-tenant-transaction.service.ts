import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AppConfig } from "../config/env.js";
import { APP_CONFIG } from "../infrastructure/tokens.js";
import { PrismaService } from "../infrastructure/prisma.service.js";
import {
  assertAuthenticatedTenantContext,
  type AuthenticatedTenantContext
} from "./authenticated-tenant-context.js";

export type TenantPrismaTransaction = Prisma.TransactionClient;

@Injectable()
export class PrismaTenantTransactionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  run<T>(
    context: AuthenticatedTenantContext,
    work: (transaction: TenantPrismaTransaction) => Promise<T>
  ): Promise<T> {
    assertAuthenticatedTenantContext(context);
    return this.prisma.$transaction(async (transaction) => {
      if (this.config.DATABASE_RUNTIME_ROLE !== undefined) {
        // The role name is validated by environment parsing before interpolation.
        await transaction.$executeRawUnsafe(
          `SET LOCAL ROLE "${this.config.DATABASE_RUNTIME_ROLE}"`
        );
      }
      // set_config(..., true) is PostgreSQL's parameterized equivalent of
      // SET LOCAL app.tenant_id and is scoped to this transaction.
      await transaction.$queryRaw(
        Prisma.sql`SELECT set_config('app.tenant_id', ${String(context.tenantId)}, true)`
      );
      await transaction.$executeRawUnsafe("SET LOCAL search_path TO pms, public");
      return work(transaction);
    });
  }
}
