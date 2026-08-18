import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/env.js";
import { createPool } from "./pool.js";
import { applyMigrations } from "./migrations.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const pool = createPool(config);
try {
  const names = await applyMigrations(pool, path.resolve(here, "../../../database"));
  process.stdout.write(`Applied ${names.length} migrations: ${names.join(", ")}\n`);
} finally {
  await pool.end();
}
