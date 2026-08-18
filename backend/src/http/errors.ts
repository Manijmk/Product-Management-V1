import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

type PgLikeError = Error & { code?: string; constraint?: string };

export function errorHandler(error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
  }
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: { issues: error.issues } }
    });
  }
  const pgError = error as PgLikeError;
  if (pgError.code === "23505") {
    return reply.status(409).send({
      error: { code: "CONFLICT", message: "A unique record already exists", details: { constraint: pgError.constraint } }
    });
  }
  if (pgError.code === "23503" || pgError.code === "23514" || pgError.code === "42501") {
    return reply.status(pgError.code === "42501" ? 403 : 422).send({
      error: {
        code: pgError.code === "42501" ? "DATABASE_ACCESS_DENIED" : "BUSINESS_CONSTRAINT_VIOLATION",
        message: "The operation violates a database-enforced business rule",
        details: { constraint: pgError.constraint }
      }
    });
  }
  request.log.error({ err: error }, "request failed");
  return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error", details: {} } });
}

export function notFound(resource: string): never {
  throw new AppError(404, `${resource.toUpperCase()}_NOT_FOUND`, `${resource} was not found`);
}
