import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiError } from "../http/api-error.js";
import { REQUIRED_ROLES } from "./auth.decorators.js";
import type { AuthenticatedRequest } from "./auth.types.js";

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(executionContext: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly string[]>(REQUIRED_ROLES, [
      executionContext.getHandler(),
      executionContext.getClass()
    ]);
    if (required === undefined || required.length === 0) return true;

    const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!required.some((role) => request.auth.roles.includes(role))) {
      throw new ApiError(HttpStatus.FORBIDDEN, "ROLE_NOT_AUTHORIZED", "The authenticated role cannot perform this action", {
        requiredRoles: required
      });
    }
    return true;
  }
}
