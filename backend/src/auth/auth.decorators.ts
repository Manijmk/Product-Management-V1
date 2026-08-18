import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AuthenticatedRequest } from "./auth.types.js";

export const PUBLIC_ENDPOINT = "pms:public-endpoint";
export const REQUIRED_ROLES = "pms:required-roles";

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ENDPOINT, true);

export const RequireRoles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().auth
);
