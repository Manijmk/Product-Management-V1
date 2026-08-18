import pg from "pg";
import type { AppConfig } from "../config/env.js";

const { Pool, types } = pg;
types.setTypeParser(20, (value) => Number(value));

export function createPool(config: AppConfig): pg.Pool {
  return new Pool({
    connectionString: config.DATABASE_URL,
    min: config.DATABASE_POOL_MIN,
    max: config.DATABASE_POOL_MAX,
    application_name: "pms-backend"
  });
}
