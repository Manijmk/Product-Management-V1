import type { ApiErrorCode } from "../http/error-codes.js";

export class DomainError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = "DomainError";
  }
}
