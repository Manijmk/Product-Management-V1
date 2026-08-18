export const OWNER_ROLE = "OWNER";
export const ADMIN_ROLE = "ADMIN";
export const ROUTE_STAFF_ROLE = "ROUTE_STAFF";

export const ADMINISTRATIVE_ROLES = [OWNER_ROLE, ADMIN_ROLE] as const;
export const MASTER_DATA_ROLES = [OWNER_ROLE, ADMIN_ROLE, ROUTE_STAFF_ROLE] as const;
