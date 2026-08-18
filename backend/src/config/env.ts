import "dotenv/config";
import { z } from "zod";

const booleanFromString = z.preprocess(
  (value) => value === true || value === "true",
  z.boolean()
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_RUNTIME_ROLE: z.string().regex(/^[a-z_][a-z0-9_]*$/i).optional(),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  AUTH_ALLOW_INSECURE_DEV_LOGIN: booleanFromString.default(false),
  LOG_LEVEL: z.string().default("info")
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = schema.parse(source);
  if (config.NODE_ENV === "production" && config.AUTH_ALLOW_INSECURE_DEV_LOGIN) {
    throw new Error("AUTH_ALLOW_INSECURE_DEV_LOGIN cannot be enabled in production");
  }
  if (config.DATABASE_POOL_MIN > config.DATABASE_POOL_MAX) {
    throw new Error("DATABASE_POOL_MIN cannot exceed DATABASE_POOL_MAX");
  }
  return config;
}
