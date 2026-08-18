import "reflect-metadata";
import { loadConfig } from "./config/env.js";
import { createPool } from "./db/pool.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config);
const app = await buildApp(config, pool);

async function shutdown(): Promise<void> {
  await app.close();
  await pool.end();
}

process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
await app.listen(config.APP_PORT, "0.0.0.0");
