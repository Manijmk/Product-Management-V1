import type { Pool, PoolClient } from "pg";
import {
  assertAuthenticatedTenantContext,
  type AuthenticatedTenantContext
} from "../tenancy/authenticated-tenant-context.js";

export type DbClient = Pick<PoolClient, "query">;

export interface TenantTransactionOptions {
  readonly runtimeRole?: string;
}

function quoteRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(role)) {
    throw new Error("Invalid database runtime role");
  }
  return `"${role}"`;
}

async function runTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withSystemTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  return runTransaction(pool, work);
}

export async function withTenantTransaction<T>(
  pool: Pool,
  context: AuthenticatedTenantContext,
  work: (client: PoolClient) => Promise<T>,
  options: TenantTransactionOptions = {}
): Promise<T> {
  assertAuthenticatedTenantContext(context);
  return runTransaction(pool, async (client) => {
    if (options.runtimeRole) {
      await client.query(`SET LOCAL ROLE ${quoteRoleIdentifier(options.runtimeRole)}`);
    }
    // set_config(..., true) is PostgreSQL's parameterized equivalent of:
    // SET LOCAL app.tenant_id = '<authenticated tenant id>'.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(context.tenantId)]);
    await client.query("SET LOCAL search_path TO pms, public");
    return work(client);
  });
}
