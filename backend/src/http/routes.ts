import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z, type ZodType } from "zod";
import type { AppConfig } from "../config/env.js";
import { withSystemTransaction, withTenantTransaction } from "../db/transaction.js";
import { AppError, notFound } from "./errors.js";
import { createAuthenticate, requireRoles } from "../auth/guard.js";
import { CatalogService } from "../application/catalog-service.js";
import { TripService } from "../application/trip-service.js";
import { StopEventService } from "../application/stop-event-service.js";
import { ReconciliationService } from "../application/reconciliation-service.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const tripParams = z.object({ tripId: z.coerce.number().int().positive() });
const stopParams = z.object({ tripId: z.coerce.number().int().positive(), tripStopId: z.coerce.number().int().positive() });
const productParams = z.object({ productId: z.coerce.number().int().positive() });
const partyParams = z.object({ partyId: z.coerce.number().int().positive() });
const partyProductParams = z.object({ partyId: z.coerce.number().int().positive(), productId: z.coerce.number().int().positive() });
const routeParams = z.object({ routeId: z.coerce.number().int().positive() });
const reconciliationParams = z.object({ reconciliationId: z.coerce.number().int().positive() });
const handoverParams = z.object({ cashHandoverId: z.coerce.number().int().positive() });

function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

const productBody = z.object({
  productCode: z.string().min(1).max(50), name: z.string().min(1).max(200),
  unitType: z.enum(["EXCHANGE", "CONSUMABLE", "DEPOSIT"]), exchangeRatio: z.number().positive().optional()
}).strict();
const priceBody = z.object({ price: z.number().nonnegative(), effectiveFrom: z.iso.datetime({ offset: true }), effectiveTo: z.iso.datetime({ offset: true }).optional() }).strict();
const stopProductBody = z.object({
  productId: z.number().int().positive().optional(), partyProductId: z.number().int().positive().optional(),
  quantityMode: z.enum(["FIXED_PLANNED", "RETURN_MATCHED", "AD_HOC"]),
  plannedQty: z.number().positive().optional(), forecastQty: z.number().positive().optional()
}).strict();

export async function registerRoutes(app: FastifyInstance, pool: Pool, config: AppConfig) {
  const authenticate = createAuthenticate(pool, config.DATABASE_RUNTIME_ROLE);
  const catalog = new CatalogService({ pool, config });
  const trips = new TripService({ pool, config });
  const events = new StopEventService({ pool, config });
  const reconciliation = new ReconciliationService({ pool, config });
  const ownerAdmin = requireRoles("OWNER", "ADMIN");
  const operational = requireRoles("OWNER", "ADMIN", "ROUTE_STAFF");

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/api/v1/auth/login", async (request) => {
    if (!config.AUTH_ALLOW_INSECURE_DEV_LOGIN) {
      throw new AppError(503, "AUTH_PROVIDER_NOT_CONFIGURED", "The Sprint 0 development login scaffold is disabled");
    }
    const input = parse(z.object({ tenantCode: z.string().min(1), loginIdentity: z.string().min(1) }).strict(), request.body);
    const tenant = await withSystemTransaction(pool, async (db) => (await db.query<{ tenant_id: number }>(
      "SELECT tenant_id FROM pms.tenant WHERE tenant_code=$1 AND status='ACTIVE'", [input.tenantCode]
    )).rows[0]);
    if (!tenant) throw new AppError(401, "INVALID_LOGIN", "Tenant or login identity was not found");
    const user = await withTenantTransaction(pool, tenant.tenant_id, config.DATABASE_RUNTIME_ROLE, async (db) =>
      (await db.query<{ user_id: number }>(
        `SELECT user_id FROM app_user WHERE status='ACTIVE' AND
          (login_identity=$1 OR mobile=$1 OR email=$1)`, [input.loginIdentity]
      )).rows[0]
    );
    if (!user) throw new AppError(401, "INVALID_LOGIN", "Tenant or login identity was not found");
    return {
      accessToken: app.jwt.sign({ sub: String(user.user_id), tenantId: tenant.tenant_id }, { expiresIn: `${config.JWT_ACCESS_TOKEN_TTL_MINUTES}m` })
    };
  });

  app.get("/api/v1/me", { preHandler: [authenticate] }, (request) => catalog.getMe(request.auth));

  app.get("/api/v1/products", { preHandler: [authenticate, operational] }, (request) => catalog.listProducts(request.auth));
  app.post("/api/v1/products", { preHandler: [authenticate, ownerAdmin] }, (request) => catalog.createProduct(request.auth, parse(productBody, request.body)));
  app.post("/api/v1/products/:productId/prices", { preHandler: [authenticate, ownerAdmin] }, (request) => {
    const { productId } = parse(productParams, request.params);
    return catalog.addProductPrice(request.auth, productId, parse(priceBody, request.body));
  });
  app.post("/api/v1/products/:productId/damage-rates", { preHandler: [authenticate, ownerAdmin] }, (request) => {
    const { productId } = parse(productParams, request.params);
    const body = parse(z.object({ damageType: z.enum(["DAMAGED", "BROKEN", "LOST"]), rate: z.number().nonnegative(), effectiveFrom: z.iso.datetime({ offset: true }), effectiveTo: z.iso.datetime({ offset: true }).optional() }).strict(), request.body);
    return catalog.addDamageRate(request.auth, productId, body);
  });

  app.get("/api/v1/customers", { preHandler: [authenticate, operational] }, (request) => catalog.listCustomers(request.auth));
  app.post("/api/v1/customers", { preHandler: [authenticate, operational] }, (request) => catalog.createCustomer(request.auth,
    parse(z.object({ name: z.string().min(1), mobile: z.string().optional(), relationshipType: z.enum(["SUBSCRIPTION_ROUTE", "AD_HOC", "WALK_IN"]), creationMode: z.enum(["TEMPORARY", "PERMANENT"]) }).strict(), request.body)
  ));
  app.post("/api/v1/customers/:partyId/approve", { preHandler: [authenticate, ownerAdmin] }, (request) => catalog.approveCustomer(request.auth, parse(partyParams, request.params).partyId));
  app.post("/api/v1/customers/:partyId/products", { preHandler: [authenticate, ownerAdmin] }, (request) => {
    const { partyId } = parse(partyParams, request.params);
    const body = parse(z.object({ productId: z.number().int().positive(), quantityMode: z.enum(["FIXED_PLANNED", "RETURN_MATCHED", "AD_HOC"]), defaultQty: z.number().positive().optional(), forecastQty: z.number().positive().optional(), exchangePolicy: z.enum(["STRICT", "ALLOW_CONTAINER_DUE", "STAFF_OVERRIDE"]).optional() }).strict(), request.body);
    return catalog.addCustomerProduct(request.auth, partyId, body);
  });
  app.post("/api/v1/customers/:partyId/products/:productId/prices", { preHandler: [authenticate, ownerAdmin] }, (request) => {
    const ids = parse(partyProductParams, request.params);
    return catalog.addCustomerPrice(request.auth, ids.partyId, ids.productId, parse(priceBody, request.body));
  });

  app.get("/api/v1/staff", { preHandler: [authenticate, ownerAdmin] }, (request) => catalog.listStaff(request.auth));
  app.post("/api/v1/staff", { preHandler: [authenticate, ownerAdmin] }, (request) => catalog.createStaff(request.auth,
    parse(z.object({ userId: z.number().int().positive().optional(), employeeCode: z.string().optional(), name: z.string().min(1), mobile: z.string().optional(), staffType: z.string().min(1) }).strict(), request.body)
  ));
  app.get("/api/v1/vehicles", { preHandler: [authenticate, operational] }, (request) => catalog.listVehicles(request.auth));
  app.post("/api/v1/vehicles", { preHandler: [authenticate, ownerAdmin] }, (request) => catalog.createVehicle(request.auth,
    parse(z.object({ registrationNo: z.string().min(1), vehicleType: z.string().min(1), capacity: z.number().positive().optional(), capacityUnit: z.string().optional(), ownershipType: z.enum(["OWNED", "RENTED", "LEASED", "THIRD_PARTY"]).optional() }).strict(), request.body)
  ));

  app.get("/api/v1/routes", { preHandler: [authenticate, operational] }, (request) => trips.listRoutes(request.auth));
  app.post("/api/v1/routes", { preHandler: [authenticate, ownerAdmin] }, (request) => trips.createRoute(request.auth,
    parse(z.object({ routeCode: z.string().min(1), routeName: z.string().min(1), description: z.string().optional() }).strict(), request.body)
  ));
  app.post("/api/v1/routes/:routeId/stops", { preHandler: [authenticate, ownerAdmin] }, (request) => {
    const { routeId } = parse(routeParams, request.params);
    const body = parse(z.object({ partyId: z.number().int().positive(), defaultSequence: z.number().positive(), products: z.array(stopProductBody.extend({ partyProductId: z.number().int().positive() })).min(1) }).strict(), request.body);
    return trips.addRouteStop(request.auth, routeId, body);
  });

  app.post("/api/v1/trips", { preHandler: [authenticate, ownerAdmin] }, (request) => trips.createTrip(request.auth,
    parse(z.object({ routeId: z.number().int().positive().nullable().optional(), tripDate: z.iso.date(), vehicleId: z.number().int().positive().optional(), primaryStaffId: z.number().int().positive().optional(), tripNumber: z.string().optional() }).strict(), request.body)
  ));
  app.get("/api/v1/trips/:tripId", { preHandler: [authenticate, operational] }, (request) => trips.getTrip(request.auth, parse(tripParams, request.params).tripId));
  app.post("/api/v1/trips/:tripId/staff", { preHandler: [authenticate, ownerAdmin] }, (request) => {
    const { tripId } = parse(tripParams, request.params);
    return trips.addTripStaff(request.auth, tripId, parse(z.object({ staffId: z.number().int().positive(), tripRole: z.enum(["DRIVER", "DELIVERY_STAFF", "HELPER", "RELIEVER"]), isPrimary: z.boolean().optional() }).strict(), request.body));
  });
  app.post("/api/v1/trips/:tripId/stops", { preHandler: [authenticate, operational] }, (request) => {
    const { tripId } = parse(tripParams, request.params);
    const body = parse(z.object({ partyId: z.number().int().positive(), source: z.enum(["ADMIN_ADDED", "STAFF_ADDED", "CUSTOMER_ORDER", "AD_HOC_NEW_CUSTOMER", "RESCHEDULED"]), sortableOrder: z.number().positive(), products: z.array(stopProductBody).min(1) }).strict(), request.body);
    return trips.addTripStop(request.auth, tripId, body);
  });
  app.patch("/api/v1/trips/:tripId/stops/:tripStopId/order", { preHandler: [authenticate, operational] }, (request) => {
    const ids = parse(stopParams, request.params);
    return trips.reorderStop(request.auth, ids.tripId, ids.tripStopId, parse(z.object({ sortableOrder: z.number().positive() }).strict(), request.body).sortableOrder);
  });
  app.post("/api/v1/trips/:tripId/load", { preHandler: [authenticate, ownerAdmin] }, (request) => {
    const { tripId } = parse(tripParams, request.params);
    const body = parse(z.object({ lines: z.array(z.object({ productId: z.number().int().positive(), state: z.enum(["FULL", "EMPTY", "DAMAGED", "CLEANING", "REFILL", "LOST"]), quantity: z.number().positive(), fromLocationId: z.number().int().positive(), toLocationId: z.number().int().positive() }).strict()).min(1) }).strict(), request.body);
    return trips.loadTrip(request.auth, tripId, body);
  });
  app.post("/api/v1/trips/:tripId/dispatch", { preHandler: [authenticate, ownerAdmin] }, (request) => trips.transition(request.auth, parse(tripParams, request.params).tripId, "LOADED", "DISPATCHED"));
  app.post("/api/v1/trips/:tripId/start", { preHandler: [authenticate, operational] }, (request) => trips.transition(request.auth, parse(tripParams, request.params).tripId, "DISPATCHED", "IN_PROGRESS"));
  app.post("/api/v1/trips/:tripId/complete", { preHandler: [authenticate, operational] }, (request) => trips.completeTrip(request.auth, parse(tripParams, request.params).tripId));

  app.post("/api/v1/trip-stops/:id/events", { preHandler: [authenticate, operational] }, (request) => {
    const { id } = parse(idParams, request.params);
    const line = z.object({
      tripStopProductId: z.number().int().positive().optional(), productId: z.number().int().positive(),
      quantityMode: z.enum(["FIXED_PLANNED", "RETURN_MATCHED", "AD_HOC"]).optional(),
      observedGoodEmptyQty: z.number().nonnegative().optional(), goodEmptyQty: z.number().nonnegative().optional(),
      damagedEmptyQty: z.number().nonnegative().optional(), rejectedEmptyQty: z.number().nonnegative().optional(),
      fullQtyDelivered: z.number().nonnegative().optional(), excessEmptyResolution: z.enum(["ACCEPT_AS_CREDIT", "ACCEPT_ONLY_REPLACED"]).optional(),
      authorizeContainerDue: z.boolean().optional(), damageResolution: z.enum(["CHARGE_DAMAGE", "ACCEPT_DAMAGE_WITHOUT_CHARGE", "REJECT_DAMAGE"]).optional(),
      priceOverride: z.object({ price: z.number().nonnegative(), reason: z.string().min(1) }).strict().optional(), notes: z.string().optional()
    }).strict();
    const body = parse(z.object({
      clientUuid: z.uuid(), eventTime: z.iso.datetime({ offset: true }), eventType: z.enum(["DELIVERY", "COLLECTION_ONLY", "RETURN_ONLY", "DAMAGE", "REPLACEMENT"]).optional(),
      deviceId: z.string().optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), notes: z.string().optional(),
      completionStatus: z.enum(["COMPLETED", "PARTIAL"]).optional(), products: z.array(line).min(1),
      payments: z.array(z.object({ amount: z.number().positive(), paymentMethod: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "WALLET", "OTHER"]) }).strict()).optional()
    }).strict(), request.body);
    return events.post(request.auth, id, body);
  });
  app.post("/api/v1/trip-stops/:id/skip", { preHandler: [authenticate, operational] }, (request) => {
    const { id } = parse(idParams, request.params); const body = parse(z.object({ reasonCode: z.string().min(1), notes: z.string().optional() }).strict(), request.body);
    return trips.markStop(request.auth, id, "SKIPPED", body.reasonCode, body.notes);
  });
  app.post("/api/v1/trip-stops/:id/fail", { preHandler: [authenticate, operational] }, (request) => {
    const { id } = parse(idParams, request.params); const body = parse(z.object({ reasonCode: z.string().min(1), notes: z.string().optional(), status: z.enum(["FAILED", "NOT_AVAILABLE"]).optional() }).strict(), request.body);
    return trips.markStop(request.auth, id, body.status ?? "FAILED", body.reasonCode, body.notes);
  });
  app.post("/api/v1/trip-stops/:id/follow-up", { preHandler: [authenticate, operational] }, (request) => {
    const { id } = parse(idParams, request.params); const body = parse(z.object({ productId: z.number().int().positive(), remainingQty: z.number().positive(), resolutionType: z.enum(["NEW_TRIP_STOP", "FOLLOW_UP", "CANCELLED"]), newTripStopId: z.number().int().positive().optional(), reason: z.string().optional() }).strict(), request.body);
    return trips.createFollowUp(request.auth, id, body);
  });

  app.post("/api/v1/trips/:tripId/reconciliation", { preHandler: [authenticate, operational] }, (request) => reconciliation.create(request.auth, parse(tripParams, request.params).tripId));
  app.put("/api/v1/reconciliations/:reconciliationId/stock", { preHandler: [authenticate, operational] }, (request) => {
    const { reconciliationId } = parse(reconciliationParams, request.params);
    const body = parse(z.object({ lines: z.array(z.object({ inventoryLocationId: z.number().int().positive(), productId: z.number().int().positive(), inventoryStateId: z.number().int().positive(), actualQty: z.number().nonnegative(), varianceReasonCode: z.string().min(1).optional(), varianceNotes: z.string().optional() }).strict()).min(1) }).strict(), request.body);
    return reconciliation.submitStock(request.auth, reconciliationId, body);
  });
  app.put("/api/v1/reconciliations/:reconciliationId/cash", { preHandler: [authenticate, operational] }, (request) => {
    const { reconciliationId } = parse(reconciliationParams, request.params);
    const body = parse(z.object({ staffId: z.number().int().positive(), actualCash: z.number().nonnegative(), varianceReasonCode: z.string().min(1).optional(), varianceNotes: z.string().optional() }).strict(), request.body);
    return reconciliation.submitCash(request.auth, reconciliationId, body);
  });
  app.post("/api/v1/reconciliations/:reconciliationId/submit", { preHandler: [authenticate, operational] }, (request) => reconciliation.submit(request.auth, parse(reconciliationParams, request.params).reconciliationId));
  app.post("/api/v1/reconciliations/:reconciliationId/approve", { preHandler: [authenticate, ownerAdmin] }, (request) => reconciliation.approve(request.auth, parse(reconciliationParams, request.params).reconciliationId));
  app.post("/api/v1/trips/:tripId/reconcile", { preHandler: [authenticate, ownerAdmin] }, (request) => reconciliation.reconcileTrip(request.auth, parse(tripParams, request.params).tripId));

  app.post("/api/v1/trips/:tripId/cash-handovers", { preHandler: [authenticate, operational] }, (request) => {
    const { tripId } = parse(tripParams, request.params);
    const body = parse(z.object({ fromStaffId: z.number().int().positive(), toUserId: z.number().int().positive(), amount: z.number().positive(), reconciliationId: z.number().int().positive().optional() }).strict(), request.body);
    return reconciliation.submitCashHandover(request.auth, tripId, body);
  });
  app.post("/api/v1/cash-handovers/:cashHandoverId/confirm", { preHandler: [authenticate, ownerAdmin] }, (request) => reconciliation.confirmCashHandover(request.auth, parse(handoverParams, request.params).cashHandoverId));
  app.post("/api/v1/cash-handovers/:cashHandoverId/dispute", { preHandler: [authenticate, ownerAdmin] }, (request) => reconciliation.disputeCashHandover(request.auth, parse(handoverParams, request.params).cashHandoverId,
    parse(z.object({ reason: z.string().min(1) }).strict(), request.body).reason));
}
