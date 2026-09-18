import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import type { ApiErrorBody } from "./api-error.js";
import { DomainError } from "../domain/domain-error.js";
import type { ApiErrorCode } from "./error-codes.js";

function errorBody(code: ApiErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}): ApiErrorBody {
  return { error: { code, message, details } };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "object" && body !== null && "error" in body) {
        void response.status(status).send(body);
        return;
      }
      void response.status(status).send(errorBody(
        status === HttpStatus.NOT_FOUND ? "NOT_FOUND" : "HTTP_ERROR",
        exception.message
      ));
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        void response.status(HttpStatus.CONFLICT).send(errorBody(
          "RESOURCE_CONFLICT",
          "A record with the same unique value already exists"
        ));
        return;
      }
      if (exception.code === "P2003") {
        void response.status(HttpStatus.BAD_REQUEST).send(errorBody(
          "INVALID_REFERENCE",
          "A referenced record does not exist in this tenant"
        ));
        return;
      }
    }

    if (exception instanceof DomainError) {
      void response.status(HttpStatus.BAD_REQUEST).send(errorBody(
        exception.code,
        exception.message,
        exception.details
      ));
      return;
    }

    void response.status(HttpStatus.INTERNAL_SERVER_ERROR).send(errorBody(
      "INTERNAL_ERROR",
      "An unexpected server error occurred"
    ));
  }
}
