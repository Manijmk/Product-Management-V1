import { HttpException, HttpStatus } from "@nestjs/common";

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details: Readonly<Record<string, unknown>>;
  };
}

export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super({ error: { code, message, details } } satisfies ApiErrorBody, status);
  }
}
