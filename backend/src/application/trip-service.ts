import { randomUUID } from "node:crypto";
import type { AuthContext } from "../auth/types.js";
import { withTenantTransaction, type DbClient } from "../db/transaction.js";
import { AppError, notFound } from "../http/errors.js";
import type { ServiceDeps } from "./deps.js";

interface StopProductInput {
  productId?: number;
  partyProductId?: number;
  quantityMode: string;
  plannedQty?: number;
  forecastQty?: number;
}

export class TripService {
  constructor(private readonly deps: ServiceDeps) {}

  private tx<T>(auth: AuthContext, work: (db: DbClient) => Promise<T>) {
    return withTenantTransaction(this.deps.pool, auth.tenantId, this.deps.config.DATABASE_RUNTIME_ROLE, work);
  }

  listRoutes(auth: AuthContext) {
    return this.tx(auth, async (db) => (await db.query("SELECT * FROM route ORDER BY route_id")).rows);
  }

  createRoute(auth: AuthContext, input: { routeCode: string; routeName: string; description?: string }) {
    return this.tx(auth, async (db) => (await db.query(
      `INSERT INTO route (tenant_id,route_code,route_name,description,created_by_user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [auth.tenantId, input.routeCode, input.routeName, input.description ?? null, auth.userId]
    )).rows[0]);
  }

  addRouteStop(auth: AuthContext, routeId: number, input: {
    partyId: number;
    defaultSequence: number;
    products: Array<StopProductInput & { partyProductId: number }>;
  }) {
    return this.tx(auth, async (db) => {
      const stop = (await db.query(
        `INSERT INTO route_stop_template (tenant_id,route_id,party_id,default_sequence,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [auth.tenantId, routeId, input.partyId, input.defaultSequence, auth.userId]
      )).rows[0];
      for (const product of input.products) {
        await db.query(
          `INSERT INTO route_stop_product
            (tenant_id,route_stop_template_id,party_product_id,quantity_mode,planned_qty,forecast_qty,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [auth.tenantId, stop.route_stop_template_id, product.partyProductId, product.quantityMode,
            product.plannedQty ?? null, product.forecastQty ?? null, auth.userId]
        );
      }
      return stop;
    });
  }

  createTrip(auth: AuthContext, input: { routeId?: number | null; tripDate: string; vehicleId?: number; primaryStaffId?: number; tripNumber?: string }) {
    return this.tx(auth, async (db) => {
      const tripNumber = input.tripNumber ?? `TRIP-${input.tripDate}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const trip = (await db.query(
        `INSERT INTO trip (tenant_id,trip_number,route_id,trip_date,vehicle_id,primary_staff_id,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [auth.tenantId, tripNumber, input.routeId ?? null, input.tripDate, input.vehicleId ?? null, input.primaryStaffId ?? null, auth.userId]
      )).rows[0];
      if (input.primaryStaffId) {
        await db.query(
          `INSERT INTO trip_staff (tenant_id,trip_id,staff_id,trip_role,is_primary,assigned_by_user_id)
           VALUES ($1,$2,$3,'DELIVERY_STAFF',TRUE,$4)`,
          [auth.tenantId, trip.trip_id, input.primaryStaffId, auth.userId]
        );
      }
      if (input.routeId) {
        const templates = await db.query<{ route_stop_template_id: number; party_id: number; default_sequence: string }>(
          `SELECT route_stop_template_id,party_id,default_sequence FROM route_stop_template
            WHERE route_id=$1 AND active_status='ACTIVE' ORDER BY default_sequence`,
          [input.routeId]
        );
        for (const template of templates.rows) {
          const stop = (await db.query(
            `INSERT INTO trip_stop
              (tenant_id,trip_id,party_id,route_stop_template_id,source,sortable_order)
             VALUES ($1,$2,$3,$4,'ROUTE',$5) RETURNING trip_stop_id`,
            [auth.tenantId, trip.trip_id, template.party_id, template.route_stop_template_id, template.default_sequence]
          )).rows[0];
          await db.query(
            `INSERT INTO trip_stop_product
              (tenant_id,trip_stop_id,product_id,party_product_id,quantity_mode,planned_qty,forecast_qty)
             SELECT $1,$2,pp.product_id,rsp.party_product_id,rsp.quantity_mode,rsp.planned_qty,rsp.forecast_qty
               FROM route_stop_product rsp
               JOIN party_product pp ON pp.party_product_id=rsp.party_product_id
              WHERE rsp.route_stop_template_id=$3 AND rsp.active_status='ACTIVE'`,
            [auth.tenantId, stop.trip_stop_id, template.route_stop_template_id]
          );
        }
      }
      return this.getTripWithin(db, trip.trip_id);
    });
  }

  getTrip(auth: AuthContext, tripId: number) {
    return this.tx(auth, (db) => this.getTripWithin(db, tripId));
  }

  private async getTripWithin(db: DbClient, tripId: number) {
    const trip = (await db.query("SELECT * FROM trip WHERE trip_id=$1", [tripId])).rows[0];
    if (!trip) notFound("trip");
    const [staff, stops, products] = await Promise.all([
      db.query("SELECT * FROM trip_staff WHERE trip_id=$1 ORDER BY trip_staff_id", [tripId]),
      db.query("SELECT * FROM trip_stop WHERE trip_id=$1 ORDER BY sortable_order", [tripId]),
      db.query(`SELECT tsp.* FROM trip_stop_product tsp JOIN trip_stop ts ON ts.trip_stop_id=tsp.trip_stop_id WHERE ts.trip_id=$1 ORDER BY tsp.trip_stop_product_id`, [tripId])
    ]);
    return { ...trip, staff: staff.rows, stops: stops.rows.map((stop) => ({ ...stop, products: products.rows.filter((p) => p.trip_stop_id === stop.trip_stop_id) })) };
  }

  addTripStaff(auth: AuthContext, tripId: number, input: { staffId: number; tripRole: string; isPrimary?: boolean }) {
    return this.tx(auth, async (db) => (await db.query(
      `INSERT INTO trip_staff (tenant_id,trip_id,staff_id,trip_role,is_primary,assigned_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [auth.tenantId, tripId, input.staffId, input.tripRole, input.isPrimary ?? false, auth.userId]
    )).rows[0]);
  }

  addTripStop(auth: AuthContext, tripId: number, input: { partyId: number; source: string; sortableOrder: number; products: StopProductInput[] }) {
    return this.tx(auth, async (db) => {
      await db.query("SELECT assert_trip_accepts_new_stop($1,$2)", [auth.tenantId, tripId]);
      const party = (await db.query<{ customer_status: string }>("SELECT customer_status FROM party WHERE party_id=$1", [input.partyId])).rows[0];
      if (!party) notFound("customer");
      if (!["ACTIVE", "TEMPORARY"].includes(party.customer_status)) {
        throw new AppError(422, "CUSTOMER_NOT_USABLE", "Only ACTIVE or TEMPORARY customers may be added to a Trip");
      }
      const stop = (await db.query(
        `INSERT INTO trip_stop
          (tenant_id,trip_id,party_id,source,sortable_order,added_by_user_id,added_by_staff_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [auth.tenantId, tripId, input.partyId, input.source, input.sortableOrder, auth.userId, auth.staffId ?? null]
      )).rows[0];
      for (const product of input.products) {
        let productId = product.productId;
        if (!productId && product.partyProductId) {
          productId = (await db.query<{ product_id: number }>("SELECT product_id FROM party_product WHERE party_product_id=$1", [product.partyProductId])).rows[0]?.product_id;
        }
        if (!productId) throw new AppError(422, "PRODUCT_REQUIRED", "Each TripStop product requires productId or partyProductId");
        await db.query(
          `INSERT INTO trip_stop_product
            (tenant_id,trip_stop_id,product_id,party_product_id,quantity_mode,planned_qty,forecast_qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [auth.tenantId, stop.trip_stop_id, productId, product.partyProductId ?? null, product.quantityMode,
            product.plannedQty ?? null, product.forecastQty ?? null]
        );
      }
      return stop;
    });
  }

  reorderStop(auth: AuthContext, tripId: number, stopId: number, sortableOrder: number) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `UPDATE trip_stop SET sortable_order=$3 WHERE trip_id=$1 AND trip_stop_id=$2 AND status='PENDING' RETURNING *`,
        [tripId, stopId, sortableOrder]
      );
      if (!result.rows[0]) throw new AppError(409, "STOP_NOT_REORDERABLE", "Only pending stops on this Trip may be reordered");
      return result.rows[0];
    });
  }

  loadTrip(auth: AuthContext, tripId: number, input: { lines: Array<{ productId: number; state: string; quantity: number; fromLocationId: number; toLocationId: number }> }) {
    return this.tx(auth, async (db) => {
      const trip = (await db.query<{ status: string }>("SELECT status FROM trip WHERE trip_id=$1 FOR UPDATE", [tripId])).rows[0];
      if (!trip) notFound("trip");
      if (!["PLANNED", "LOADED", "DISPATCHED", "IN_PROGRESS"].includes(trip.status)) {
        throw new AppError(409, "TRIP_NOT_LOADABLE", "Trip status does not allow vehicle loading");
      }
      for (const line of input.lines) {
        const state = (await db.query<{ inventory_state_id: number }>("SELECT inventory_state_id FROM inventory_state WHERE code=$1", [line.state])).rows[0];
        if (!state) throw new AppError(422, "INVENTORY_STATE_NOT_FOUND", "Unknown inventory state", { state: line.state });
        await db.query(
          `INSERT INTO inventory_ledger_entry
            (tenant_id,product_id,from_location_id,to_location_id,from_state_id,to_state_id,quantity,event_type,trip_id,occurred_at,created_by_user_id,created_by_staff_id)
           VALUES ($1,$2,$3,$4,$5,$5,$6,'TRIP_LOAD',$7,NOW(),$8,$9)`,
          [auth.tenantId, line.productId, line.fromLocationId, line.toLocationId, state.inventory_state_id, line.quantity, tripId, auth.userId, auth.staffId ?? null]
        );
      }
      if (trip.status === "PLANNED") await db.query("UPDATE trip SET status='LOADED' WHERE trip_id=$1", [tripId]);
      return { tripId, loadedLines: input.lines.length };
    });
  }

  transition(auth: AuthContext, tripId: number, from: string, to: string) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `UPDATE trip SET status=$3, actual_start_at=CASE WHEN $3='IN_PROGRESS' THEN NOW() ELSE actual_start_at END
          WHERE trip_id=$1 AND status=$2 RETURNING *`,
        [tripId, from, to]
      );
      if (!result.rows[0]) throw new AppError(409, "INVALID_TRIP_STATE", `Trip must be ${from} to transition to ${to}`);
      return result.rows[0];
    });
  }

  completeTrip(auth: AuthContext, tripId: number) {
    return this.tx(auth, async (db) => {
      const pending = Number((await db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM trip_stop WHERE trip_id=$1 AND status IN ('PENDING','IN_SERVICE')", [tripId]
      )).rows[0]?.count ?? 0);
      if (pending > 0) throw new AppError(409, "UNRESOLVED_TRIP_STOPS", "Trip cannot complete with pending stops", { pending });
      const result = await db.query(
        "UPDATE trip SET status='COMPLETED', completed_at=NOW() WHERE trip_id=$1 AND status='IN_PROGRESS' RETURNING *", [tripId]
      );
      if (!result.rows[0]) throw new AppError(409, "TRIP_NOT_COMPLETABLE", "Trip must be IN_PROGRESS to complete");
      return result.rows[0];
    });
  }

  markStop(auth: AuthContext, stopId: number, status: "SKIPPED" | "FAILED" | "NOT_AVAILABLE", reasonCode: string, notes?: string) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `UPDATE trip_stop SET status=$2,reason_code=$3,notes=$4,attempted_at=NOW()
          WHERE trip_stop_id=$1 AND status IN ('PENDING','IN_SERVICE') RETURNING *`,
        [stopId, status, reasonCode, notes ?? null]
      );
      if (!result.rows[0]) throw new AppError(409, "STOP_NOT_ACTIONABLE", "Only pending/in-service stops may be classified");
      return result.rows[0];
    });
  }

  createFollowUp(auth: AuthContext, stopId: number, input: { productId: number; remainingQty: number; resolutionType: string; newTripStopId?: number; reason?: string }) {
    return this.tx(auth, async (db) => {
      const stop = (await db.query<{ party_id: number }>("SELECT party_id FROM trip_stop WHERE trip_stop_id=$1", [stopId])).rows[0];
      if (!stop) notFound("trip_stop");
      return (await db.query(
        `INSERT INTO stop_follow_up
          (tenant_id,source_trip_stop_id,party_id,product_id,remaining_qty,resolution_type,new_trip_stop_id,reason,created_by_user_id,created_by_staff_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [auth.tenantId, stopId, stop.party_id, input.productId, input.remainingQty, input.resolutionType,
          input.newTripStopId ?? null, input.reason ?? null, auth.userId, auth.staffId ?? null]
      )).rows[0];
    });
  }
}
