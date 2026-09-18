import "dotenv/config";
import { z } from "zod";

const booleanFromString = z.preprocess(
  (value) => value === true || value === "true",
  z.boolean()
);

const optionalDatabaseRole = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().regex(/^[a-z_][a-z0-9_]*$/i).optional()
);

const postgresUrl = z.string().url().refine(
  (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
  "Database URLs must use the PostgreSQL protocol"
);

const optionalSeedPassword = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().min(8).max(256).optional()
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().min(1).default("pms-backend"),
  APP_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: postgresUrl,
  DATABASE_MIGRATION_URL: postgresUrl.optional(),
  DATABASE_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_RUNTIME_ROLE: optionalDatabaseRole,
  AUTH_JWT_SECRET: z.string().min(32, "AUTH_JWT_SECRET must be at least 32 characters"),
  AUTH_JWT_ISSUER: z.string().min(1).default("pms-backend"),
  AUTH_JWT_AUDIENCE: z.string().min(1).default("pms-api"),
  UAT_SEED_PASSWORD: optionalSeedPassword,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SWAGGER_ENABLED: booleanFromString.default(true)
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = schema.parse(source);
  if (config.DATABASE_POOL_MIN > config.DATABASE_POOL_MAX) {
    throw new Error("DATABASE_POOL_MIN cannot exceed DATABASE_POOL_MAX");
  }
  return config;
}
