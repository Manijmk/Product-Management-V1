import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Pool } from "pg";

export const FOUNDATION_MIGRATIONS = [
  "001_foundation.sql",
  "002_operations.sql",
  "003_execution_ledgers.sql",
  "004_reconciliation.sql",
  "005_runtime_security.sql",
  "006_schema_fixes.sql",
  "007_local_authentication.sql"
] as const;

interface MigrationSource {
  readonly filename: string;
  readonly sql: string;
  readonly checksum: string;
}

function withoutTransactionWrapper(migration: MigrationSource): string {
  const beginMatch = /\bBEGIN;\s*/i.exec(migration.sql);
  const commitIndex = migration.sql.toUpperCase().lastIndexOf("COMMIT;");
  if (!beginMatch || beginMatch.index >= commitIndex) {
    throw new Error(`Migration must contain a BEGIN/COMMIT wrapper: ${migration.filename}`);
  }
  return [
    migration.sql.slice(0, beginMatch.index),
    migration.sql.slice(beginMatch.index + beginMatch[0].length, commitIndex),
    migration.sql.slice(commitIndex + "COMMIT;".length)
  ].join("");
}

export async function applyMigrations(pool: Pool, migrationDirectory: string): Promise<string[]> {
  const migrations: MigrationSource[] = await Promise.all(
    FOUNDATION_MIGRATIONS.map(async (filename) => {
      const sql = await fs.readFile(path.join(migrationDirectory, filename), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      return { filename, sql, checksum };
    })
  );
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('pms-foundation-migrations'))");
    lockAcquired = true;
    await client.query(`CREATE TABLE IF NOT EXISTS public.pms_schema_migration (
      filename text PRIMARY KEY,
      checksum text,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query("ALTER TABLE public.pms_schema_migration ADD COLUMN IF NOT EXISTS checksum text");
    const applied = new Map(
      (await client.query<{ filename: string; checksum: string | null }>(
        "SELECT filename, checksum FROM public.pms_schema_migration"
      )).rows.map((row) => [row.filename, row.checksum])
    );
    const newlyApplied: string[] = [];
    for (const migration of migrations) {
      const recordedChecksum = applied.get(migration.filename);
      if (recordedChecksum !== undefined) {
        if (recordedChecksum !== null && recordedChecksum !== migration.checksum) {
          throw new Error(`Applied migration was modified: ${migration.filename}`);
        }
        if (recordedChecksum === null) {
          await client.query(
            "UPDATE public.pms_schema_migration SET checksum = $2 WHERE filename = $1",
            [migration.filename, migration.checksum]
          );
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(withoutTransactionWrapper(migration));
        await client.query(
          "INSERT INTO public.pms_schema_migration (filename, checksum) VALUES ($1, $2)",
          [migration.filename, migration.checksum]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      newlyApplied.push(migration.filename);
    }
    return newlyApplied;
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock(hashtext('pms-foundation-migrations'))");
    }
    client.release();
  }
}
