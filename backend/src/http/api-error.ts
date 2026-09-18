import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiErrorCode } from "./error-codes.js";

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details: Readonly<Record<string, unknown>>;
  };
}

export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    code: ApiErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super({ error: { code, message, details } } satisfies ApiErrorBody, status);
  }
}
