export interface AuthenticatedTenantContext {
  readonly tenantId: number;
  readonly userId: number;
  readonly roles: readonly string[];
}

export function assertAuthenticatedTenantContext(
  context: AuthenticatedTenantContext
): void {
  if (!Number.isSafeInteger(context.tenantId) || context.tenantId <= 0) {
    throw new Error("Invalid authenticated tenant context");
  }
  if (!Number.isSafeInteger(context.userId) || context.userId <= 0) {
    throw new Error("Invalid authenticated user context");
  }
}
