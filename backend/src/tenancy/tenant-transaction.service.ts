import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config/env.js";
import { withTenantTransaction } from "../db/transaction.js";
import { APP_CONFIG, PG_POOL } from "../infrastructure/tokens.js";
import type { AuthenticatedTenantContext } from "./authenticated-tenant-context.js";

@Injectable()
export class TenantTransactionService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  run<T>(
    context: AuthenticatedTenantContext,
    work: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    return withTenantTransaction(
      this.pool,
      context,
      work,
      { runtimeRole: this.config.DATABASE_RUNTIME_ROLE }
    );
  }
}
