import type { Pool, PoolClient } from "pg";

export type DbClient = Pick<PoolClient, "query">;

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
  tenantId: number,
  runtimeRole: string | undefined,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error("Invalid tenant context");
  return runTransaction(pool, async (client) => {
    if (runtimeRole) await client.query(`SET LOCAL ROLE ${runtimeRole}`);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenantId)]);
    await client.query("SET LOCAL search_path TO pms, public");
    return work(client);
  });
}
