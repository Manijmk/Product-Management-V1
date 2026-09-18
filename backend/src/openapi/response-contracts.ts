import type { OpenAPIObject, OperationObject, ReferenceObject, SchemaObject } from "@nestjs/swagger";

const id: SchemaObject = { type: "string", example: "1" };
const text: SchemaObject = { type: "string" };
const nullableText: SchemaObject = { type: "string", nullable: true };
const dateTime: SchemaObject = { type: "string", format: "date-time" };

function record(properties: Record<string, SchemaObject | ReferenceObject>, required = Object.keys(properties)): SchemaObject {
  return { type: "object", properties, required, additionalProperties: true };
}

const dataSchemas: Record<string, SchemaObject> = {
  HealthData: record({ status: text, database: text }),
  RoleData: record({ roleId: id, roleCode: text, roleName: text, status: text }),
  RoleSummaryData: record({ roleId: id, roleCode: text, roleName: text }),
  UserData: record({
    userId: id, loginIdentity: nullableText, mobile: nullableText, email: nullableText,
    displayName: nullableText, status: text, roles: { type: "array", items: { $ref: "#/components/schemas/RoleSummaryData" } },
    createdAt: dateTime
  }),
  RoleAssignmentData: record({ userId: id, role: { $ref: "#/components/schemas/RoleSummaryData" } }),
  StaffData: record({
    staffId: id, userId: nullableText, employeeCode: nullableText, name: text, mobile: nullableText,
    staffType: text, status: text, joinedOn: nullableText, createdAt: dateTime
  }),
  StaffLinkedRoleData: record({ roleId: id, roleCode: text, roleName: text }),
  StaffLinkedUserData: record({
    userId: id, loginIdentity: nullableText, email: nullableText, mobile: nullableText,
    displayName: nullableText, status: text,
    roles: { type: "array", items: { $ref: "#/components/schemas/StaffLinkedRoleData" } }
  }),
  StaffDetailData: record({
    staffId: id, userId: nullableText, employeeCode: nullableText, name: text, mobile: nullableText,
    staffType: text, status: text, joinedOn: nullableText, createdAt: dateTime, updatedAt: dateTime,
    user: { allOf: [{ $ref: "#/components/schemas/StaffLinkedUserData" }], nullable: true }
  }),
  ProductData: record({
    productId: id, productCode: text, name: text, unitType: text, exchangeRatio: nullableText,
    activeStatus: text, createdAt: dateTime, updatedAt: dateTime
  }),
  ProductPriceData: record({ productPriceId: id, price: text, effectiveFrom: dateTime, effectiveTo: nullableText, status: text, createdAt: dateTime }),
  DamageRateData: record({ damageRateId: id, damageType: text, rate: text, effectiveFrom: dateTime, effectiveTo: nullableText, status: text, createdAt: dateTime }),
  ProductDetailData: record({
    productId: id, productCode: text, name: text, unitType: text, exchangeRatio: nullableText, activeStatus: text,
    createdAt: dateTime, updatedAt: dateTime,
    prices: { type: "array", items: { $ref: "#/components/schemas/ProductPriceData" } },
    damageRates: { type: "array", items: { $ref: "#/components/schemas/DamageRateData" } }
  }),
  CustomerData: record({
    partyId: id, partyCode: nullableText, name: text, relationshipType: text, mobile: nullableText,
    customerStatus: text, createdSource: text, createdAt: dateTime, updatedAt: dateTime
  }),
  PartyProductData: record({
    partyProductId: id, productId: id, productCode: text, productName: text, quantityMode: text,
    defaultQty: nullableText, forecastQty: nullableText, exchangePolicy: nullableText, activeStatus: text,
    createdAt: dateTime, updatedAt: dateTime
  }),
  CustomerPriceData: record({
    partyProductPriceId: id, productId: id, price: text, effectiveFrom: dateTime, effectiveTo: nullableText,
    approvalStatus: text, approvedByUserId: nullableText, approvedAt: nullableText, createdAt: dateTime
  }),
  CustomerDetailData: record({
    partyId: id, partyCode: nullableText, name: text, relationshipType: text, mobile: nullableText,
    customerStatus: text, createdSource: text, createdAt: dateTime, updatedAt: dateTime,
    alternateMobile: nullableText, addressLine1: nullableText, addressLine2: nullableText, locality: nullableText,
    city: nullableText, postalCode: nullableText, latitude: nullableText, longitude: nullableText,
    createdByUserId: nullableText, approvedByUserId: nullableText, approvedAt: nullableText,
    products: { type: "array", items: { $ref: "#/components/schemas/PartyProductData" } },
    prices: { type: "array", items: { $ref: "#/components/schemas/CustomerPriceData" } }
  }),
  RouteData: record({ routeId: id, routeCode: text, routeName: text, description: nullableText, status: text, createdAt: dateTime, updatedAt: dateTime }),
  RouteStopProductData: record({
    routeStopProductId: id, partyProductId: id, productId: id, productCode: text, productName: text,
    quantityMode: text, plannedQty: nullableText, forecastQty: nullableText, notes: nullableText, activeStatus: text
  }),
  RouteStopData: record({
    routeStopId: id, partyId: id, partyName: text, customerStatus: text, sortableOrder: text,
    preferredTimeFrom: nullableText, preferredTimeTo: nullableText, notes: nullableText, activeStatus: text,
    products: { type: "array", items: { $ref: "#/components/schemas/RouteStopProductData" } }
  }),
  RouteDetailData: record({
    routeId: id, routeCode: text, routeName: text, description: nullableText, status: text,
    createdAt: dateTime, updatedAt: dateTime,
    stops: { type: "array", items: { $ref: "#/components/schemas/RouteStopData" } }
  }),
  VehicleData: record({
    vehicleId: id, registrationNo: text, vehicleType: text, capacity: nullableText, capacityUnit: nullableText,
    ownershipType: text, status: text, notes: nullableText, createdAt: dateTime, updatedAt: dateTime
  }),
  TripData: record({
    tripId: id, tripNumber: text, routeId: nullableText, tripDate: { type: "string", format: "date" },
    shiftCode: nullableText, vehicleId: nullableText, primaryStaffId: nullableText, status: text,
    plannedStartAt: nullableText, actualStartAt: nullableText, createdAt: dateTime, updatedAt: dateTime
  }),
  TripStaffAssignmentData: record({
    tripStaffId: id, staffId: id, staffName: text, staffStatus: text, tripRole: text,
    joinedAt: nullableText, leftAt: nullableText, isPrimary: { type: "boolean" }
  }),
  TripStopProductData: record({
    tripStopProductId: id, productId: id, productCode: text, productName: text, partyProductId: nullableText,
    quantityMode: text, plannedQty: nullableText, forecastQty: nullableText, priceSnapshot: nullableText,
    status: text, notes: nullableText
  }),
  TripStopData: record({
    tripStopId: id, partyId: id, partyName: text, customerStatus: text, routeStopTemplateId: nullableText,
    source: text, sortableOrder: text, status: text, notes: nullableText, addedAt: dateTime,
    products: { type: "array", items: { $ref: "#/components/schemas/TripStopProductData" } }
  }),
  TripRouteSummaryData: record({ routeCode: text, routeName: text }),
  TripVehicleSummaryData: record({ registrationNo: text, vehicleType: text, status: text }),
  TripPrimaryStaffSummaryData: record({ name: text, status: text }),
  TripDetailData: record({
    tripId: id, tripNumber: text, routeId: nullableText, tripDate: { type: "string", format: "date" },
    shiftCode: nullableText, vehicleId: nullableText, primaryStaffId: nullableText, status: text,
    plannedStartAt: nullableText, actualStartAt: nullableText, createdAt: dateTime, updatedAt: dateTime,
    route: { allOf: [{ $ref: "#/components/schemas/TripRouteSummaryData" }], nullable: true },
    vehicle: { allOf: [{ $ref: "#/components/schemas/TripVehicleSummaryData" }], nullable: true },
    primaryStaff: { allOf: [{ $ref: "#/components/schemas/TripPrimaryStaffSummaryData" }], nullable: true },
    staff: { type: "array", items: { $ref: "#/components/schemas/TripStaffAssignmentData" } },
    stops: { type: "array", items: { $ref: "#/components/schemas/TripStopData" } }
  }),
  TripStopOrderData: record({ tripStopId: id, sortableOrder: text, status: text }),
  TripCompletionData: record({ tripId: id, tripNumber: text, status: text, completedAt: nullableText }),
  TripReconciledData: record({ tripId: id, tripNumber: text, status: text, reconciledAt: nullableText }),
  ExchangeExceptionData: record({ exchangeExceptionId: id, type: text, quantity: text, resolution: text }),
  PriceOverrideData: record({ priceOverrideId: id, standardPrice: text, requestedPrice: text, approvalStatus: text, reason: text }),
  StopEventProductData: record({
    stopEventProductId: id, tripStopProductId: nullableText, productId: id, quantityMode: text,
    exchangeRatio: nullableText, fullQtyDelivered: text, goodEmptyQtyAccepted: text, damagedEmptyQty: text,
    rejectedEmptyQty: text, containerCreditQty: text, containerDueQty: text, priceApplied: nullableText,
    priceSource: nullableText, lineChargeAmount: text, damageChargeAmount: text,
    exchangeExceptions: { type: "array", items: { $ref: "#/components/schemas/ExchangeExceptionData" } },
    priceOverride: { allOf: [{ $ref: "#/components/schemas/PriceOverrideData" }], nullable: true }
  }),
  InventoryLedgerData: record({
    inventoryLedgerId: id, productId: id, quantity: text, eventType: text,
    fromLocationId: nullableText, toLocationId: nullableText, fromStateId: nullableText, toStateId: nullableText
  }),
  MoneyLedgerData: record({ moneyLedgerId: id, amount: text, direction: text, transactionType: text, paymentMethod: nullableText, accountType: text }),
  ReconciliationReviewData: record({ reconciliationExceptionId: id, exceptionStatus: text, adjustmentId: nullableText, adjustmentStatus: nullableText }),
  StopEventData: record({
    duplicate: { type: "boolean" }, stopEventId: id, tripId: id, tripStopId: id, partyId: id,
    eventType: text, eventStatus: text, eventTime: dateTime, serverReceivedAt: dateTime,
    clientUuid: { type: "string", format: "uuid" },
    products: { type: "array", items: { $ref: "#/components/schemas/StopEventProductData" } },
    inventoryLedgerEntries: { type: "array", items: { $ref: "#/components/schemas/InventoryLedgerData" } },
    moneyLedgerEntries: { type: "array", items: { $ref: "#/components/schemas/MoneyLedgerData" } },
    reconciliationReview: { allOf: [{ $ref: "#/components/schemas/ReconciliationReviewData" }], nullable: true }
  }),
  FollowUpData: record({
    followUpId: id, sourceTripStopId: id, sourceStopEventId: nullableText, productId: id,
    remainingQty: nullableText, resolutionType: text, status: text, reason: nullableText, createdAt: dateTime
  }),
  ReconciliationStockLineData: record({
    tripStockReconciliationId: id, inventoryLocationId: id, productId: id, inventoryStateId: id,
    expectedQty: text, actualQty: text, varianceQty: nullableText, varianceReasonCode: nullableText,
    varianceNotes: nullableText, approvalStatus: text, adjustmentInventoryLedgerId: nullableText
  }),
  ReconciliationCashLineData: record({
    tripCashReconciliationId: id, staffId: id, expectedCash: text, actualCash: text,
    varianceAmount: nullableText, varianceReasonCode: nullableText, varianceNotes: nullableText,
    approvalStatus: text, adjustmentMoneyLedgerId: nullableText
  }),
  ReconciliationExceptionData: record({
    reconciliationExceptionId: id, type: text, severity: text, tripStopId: nullableText, stopEventId: nullableText,
    detectedSource: text, description: text, status: text, resolutionNotes: nullableText, detectedAt: dateTime
  }),
  ReconciliationAdjustmentData: record({
    adjustmentId: id, reconciliationExceptionId: nullableText, adjustmentType: text, reasonCode: text,
    reasonNotes: nullableText, approvalStatus: text, inventoryLedgerId: nullableText, moneyLedgerId: nullableText,
    stopEventId: nullableText, requestedAt: dateTime, approvedAt: nullableText
  }),
  ReconciliationData: record({
    reconciliationId: id, tripId: id, reconciliationNumber: text, status: text, notes: nullableText,
    startedAt: dateTime, submittedAt: nullableText, approvedAt: nullableText,
    stock: { type: "array", items: { $ref: "#/components/schemas/ReconciliationStockLineData" } },
    cash: { type: "array", items: { $ref: "#/components/schemas/ReconciliationCashLineData" } },
    exceptions: { type: "array", items: { $ref: "#/components/schemas/ReconciliationExceptionData" } },
    adjustments: { type: "array", items: { $ref: "#/components/schemas/ReconciliationAdjustmentData" } }
  }),
  CashHandoverData: record({
    cashHandoverId: id, tripId: nullableText, reconciliationId: nullableText, fromStaffId: id, toUserId: id,
    amount: text, status: text, moneyLedgerId: nullableText, submittedAt: dateTime, confirmedAt: nullableText,
    disputedAt: nullableText, disputeReason: nullableText
  }),
  StockSubmissionData: record({ tripStockReconciliationId: id, expectedQty: text, actualQty: text, varianceQty: nullableText, approvalStatus: text }),
  CashSubmissionData: record({ tripCashReconciliationId: id, expectedCash: text, actualCash: text, varianceAmount: nullableText, approvalStatus: text }),
  AdjustmentData: record({ adjustmentId: id, approvalStatus: text, inventoryLedgerId: nullableText, moneyLedgerId: nullableText, stopEventId: id }),
  ExceptionResolutionData: record({ reconciliationExceptionId: id, status: text, resolvedAt: nullableText, resolutionNotes: nullableText }),
  AuthRoleData: record({ code: text, name: text }),
  AuthStaffData: record({ staffId: id, employeeCode: nullableText, name: text, staffType: text, status: text }),
  CurrentUserData: record({
    id, displayName: nullableText, tenantId: id,
    roles: { type: "array", items: { $ref: "#/components/schemas/AuthRoleData" } },
    staff: { allOf: [{ $ref: "#/components/schemas/AuthStaffData" }], nullable: true }
  }),
  LoginData: record({
    accessToken: { type: "string" }, tokenType: { type: "string", enum: ["Bearer"] },
    expiresIn: { type: "integer", example: 1800 }, user: { $ref: "#/components/schemas/CurrentUserData" }
  }),
  LogoutData: record({ loggedOut: { type: "boolean", enum: [true] } })
};

interface Contract { readonly data: string; readonly list?: true }

export const OPERATION_SUCCESS_CONTRACTS: Readonly<Record<string, Contract>> = {
  Auth_login: { data: "LoginData" }, Auth_me: { data: "CurrentUserData" }, Auth_logout: { data: "LogoutData" },
  Health_health: { data: "HealthData" },
  Users_list: { data: "UserData", list: true }, Users_create: { data: "UserData" },
  Users_roles: { data: "RoleData", list: true }, Users_assignRole: { data: "RoleAssignmentData" },
  Staff_list: { data: "StaffData", list: true }, Staff_create: { data: "StaffData" }, Staff_get: { data: "StaffDetailData" },
  Products_list: { data: "ProductData", list: true }, Products_create: { data: "ProductData" },
  Products_get: { data: "ProductDetailData" }, Products_createPrice: { data: "ProductPriceData" },
  Products_createDamageRate: { data: "DamageRateData" },
  Customers_list: { data: "CustomerData", list: true }, Customers_create: { data: "CustomerData" },
  Customers_get: { data: "CustomerDetailData" }, Customers_approve: { data: "CustomerData" },
  Customers_addProduct: { data: "PartyProductData" }, Customers_createPrice: { data: "CustomerPriceData" },
  Routes_list: { data: "RouteData", list: true }, Routes_create: { data: "RouteData" }, Routes_get: { data: "RouteDetailData" },
  Routes_addStop: { data: "RouteDetailData" }, Routes_reorderStop: { data: "RouteDetailData" },
  Vehicles_list: { data: "VehicleData", list: true }, Vehicles_create: { data: "VehicleData" }, Vehicles_get: { data: "VehicleData" },
  Trips_list: { data: "TripData", list: true }, Trips_create: { data: "TripDetailData" }, Trips_get: { data: "TripDetailData" },
  Trips_addStaff: { data: "TripDetailData" }, Trips_addStop: { data: "TripDetailData" }, Trips_reorderStop: { data: "TripStopOrderData" },
  Trips_dispatch: { data: "TripData" }, Trips_start: { data: "TripData" },
  StopEvents_create: { data: "StopEventData" }, StopEvents_createFollowUp: { data: "FollowUpData" },
  Reconciliation_completeTrip: { data: "TripCompletionData" },
  Reconciliation_createReconciliation: { data: "ReconciliationData" }, Reconciliation_getReconciliation: { data: "ReconciliationData" },
  Reconciliation_submitStock: { data: "StockSubmissionData" }, Reconciliation_submitCash: { data: "CashSubmissionData" },
  Reconciliation_submitReconciliation: { data: "ReconciliationData" }, Reconciliation_approveReconciliation: { data: "ReconciliationData" },
  Reconciliation_reconcileTrip: { data: "TripReconciledData" }, Reconciliation_createHandover: { data: "CashHandoverData" },
  Reconciliation_confirmHandover: { data: "CashHandoverData" }, Reconciliation_disputeHandover: { data: "CashHandoverData" },
  Reconciliation_approveAdjustment: { data: "AdjustmentData" }, Reconciliation_resolveException: { data: "ExceptionResolutionData" }
};

const paginationMeta: SchemaObject = record({
  page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 },
  total: { type: "integer", minimum: 0 }, totalPages: { type: "integer", minimum: 0 }
});

function responseSchemaName(contract: Contract): string {
  return `${contract.data}${contract.list === true ? "List" : ""}Response`;
}

function operations(document: OpenAPIObject): OperationObject[] {
  const result: OperationObject[] = [];
  for (const path of Object.values(document.paths)) {
    if (path === undefined) continue;
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const operation = path[method];
      if (operation !== undefined) result.push(operation);
    }
  }
  return result;
}

export function applySuccessResponseContracts(document: OpenAPIObject): void {
  document.components ??= {};
  document.components.schemas ??= {};
  Object.assign(document.components.schemas, dataSchemas, { PaginationMeta: paginationMeta });
  for (const contract of Object.values(OPERATION_SUCCESS_CONTRACTS)) {
    const schemaName = responseSchemaName(contract);
    document.components.schemas[schemaName] = contract.list === true
      ? record({
          data: { type: "array", items: { $ref: `#/components/schemas/${contract.data}` } },
          meta: { $ref: "#/components/schemas/PaginationMeta" }
        })
      : record({ data: { $ref: `#/components/schemas/${contract.data}` } });
  }

  for (const operation of operations(document)) {
    const operationId = operation.operationId;
    if (operationId === undefined) continue;
    const contract = OPERATION_SUCCESS_CONTRACTS[operationId];
    if (contract === undefined) throw new Error(`Missing success response contract for ${operationId}`);
    const successfulStatuses = Object.keys(operation.responses).filter((status) => /^2\d\d$/.test(status));
    if (successfulStatuses.length === 0) throw new Error(`Missing success status for ${operationId}`);
    for (const status of successfulStatuses) {
      operation.responses[status] = {
        description: "Successful response",
        content: { "application/json": { schema: { $ref: `#/components/schemas/${responseSchemaName(contract)}` } } }
      };
    }
    operation.security = operationId === "Auth_login" || operationId === "Health_health"
      ? []
      : [{ bearer: [] }];
  }
}

export function validateOpenApiContract(document: OpenAPIObject): void {
  const schemas = document.components?.schemas ?? {};
  for (const operation of operations(document)) {
    const operationId = operation.operationId ?? "unknown";
    const contract = OPERATION_SUCCESS_CONTRACTS[operationId];
    if (contract === undefined) throw new Error(`Undocumented operation ${operationId}`);
    const successful = Object.entries(operation.responses).filter(([status]) => /^2\d\d$/.test(status));
    if (successful.length === 0) throw new Error(`No successful response for ${operationId}`);
    for (const [, response] of successful) {
      if (response === undefined || !("content" in response)) throw new Error(`No response content for ${operationId}`);
      const schema = response.content?.["application/json"]?.schema;
      if (schema === undefined || !("$ref" in schema)) throw new Error(`Anonymous success response for ${operationId}`);
      const schemaName = schema.$ref.split("/").at(-1);
      if (schemaName === undefined || schemas[schemaName] === undefined) throw new Error(`Missing response schema for ${operationId}`);
    }
  }
  const routeId = schemas.CreateTripDto !== undefined && "properties" in schemas.CreateTripDto
    ? schemas.CreateTripDto.properties?.routeId
    : undefined;
  if (routeId === undefined || !("type" in routeId) || routeId.type !== "integer" || routeId.nullable !== true) {
    throw new Error("CreateTripDto.routeId must be a nullable integer");
  }
}
