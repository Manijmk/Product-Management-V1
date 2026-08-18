import { promises as fs } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

export async function applyMigrations(pool: Pool, migrationDirectory: string): Promise<string[]> {
  const names = (await fs.readdir(migrationDirectory))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort();
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.pms_schema_migration (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Set((await client.query<{ filename: string }>("SELECT filename FROM public.pms_schema_migration")).rows.map((row) => row.filename));
    const newlyApplied: string[] = [];
    for (const name of names) {
      if (applied.has(name)) continue;
      const sql = await fs.readFile(path.join(migrationDirectory, name), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO public.pms_schema_migration (filename) VALUES ($1)", [name]);
      newlyApplied.push(name);
    }
    return newlyApplied;
  } finally {
    client.release();
  }
}
