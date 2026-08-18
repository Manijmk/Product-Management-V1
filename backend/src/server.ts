import { loadConfig } from "./config/env.js";
import { createPool } from "./db/pool.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config);
const app = await buildApp(config, pool);

const close = async () => {
  await app.close();
  await pool.end();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

await app.listen({ port: config.APP_PORT, host: "0.0.0.0" });
