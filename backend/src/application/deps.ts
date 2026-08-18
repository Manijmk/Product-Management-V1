import type { Pool } from "pg";
import type { AppConfig } from "../config/env.js";

export interface ServiceDeps {
  pool: Pool;
  config: Pick<AppConfig, "DATABASE_RUNTIME_ROLE">;
}
