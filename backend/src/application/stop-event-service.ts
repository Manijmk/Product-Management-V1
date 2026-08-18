import type { AuthContext } from "../auth/types.js";
import { withTenantTransaction, type DbClient } from "../db/transaction.js";
import { calculateExchange, type ExcessEmptyResolution, type QuantityMode } from "../domain/exchange.js";
import { resolveDamageRate, resolvePrice } from "../domain/pricing.js";
import { AppError, notFound } from "../http/errors.js";
import type { ServiceDeps } from "./deps.js";

export interface StopEventProductInput {
  tripStopProductId?: number;
  productId: number;
  quantityMode?: QuantityMode;
  observedGoodEmptyQty?: number;
  goodEmptyQty?: number;
  damagedEmptyQty?: number;
  rejectedEmptyQty?: number;
  fullQtyDelivered?: number;
  excessEmptyResolution?: ExcessEmptyResolution;
  authorizeContainerDue?: boolean;
  damageResolution?: "CHARGE_DAMAGE" | "ACCEPT_DAMAGE_WITHOUT_CHARGE" | "REJECT_DAMAGE";
  priceOverride?: { price: number; reason: string };
  notes?: string;
}

export interface StopEventInput {
  clientUuid: string;
  eventTime: string;
  eventType?: string;
  deviceId?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  completionStatus?: "COMPLETED" | "PARTIAL";
  products: StopEventProductInput[];
  payments?: Array<{ amount: number; paymentMethod: string }>;
}

interface StopContext {
  trip_stop_id: number;
  trip_id: number;
  party_id: number;
  stop_status: string;
  trip_status: string;
  vehicle_id: number | null;
}

export class StopEventService {
  constructor(private readonly deps: ServiceDeps) {}

  async post(auth: AuthContext, tripStopId: number, input: StopEventInput) {
    try {
      return await this.run(auth, tripStopId, input);
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === "23505" && pgError.constraint === "uq_stop_event_client_uuid") {
        return withTenantTransaction(this.deps.pool, auth.tenantId, this.deps.config.DATABASE_RUNTIME_ROLE, (db) =>
          this.getAccepted(db, input.clientUuid)
        );
      }
      throw error;
    }
  }

  private run(auth: AuthContext, tripStopId: number, input: StopEventInput) {
    return withTenantTransaction(this.deps.pool, auth.tenantId, this.deps.config.DATABASE_RUNTIME_ROLE, async (db) => {
      const existing = await this.findAccepted(db, input.clientUuid);
      if (existing) return existing;

      const stop = (await db.query<StopContext>(
        `SELECT ts.trip_stop_id,ts.trip_id,ts.party_id,ts.status AS stop_status,
                t.status AS trip_status,t.vehicle_id
           FROM trip_stop ts JOIN trip t ON t.trip_id=ts.trip_id
          WHERE ts.trip_stop_id=$1 FOR UPDATE OF ts`,
        [tripStopId]
      )).rows[0];
      if (!stop) notFound("trip_stop");

      const isLate = stop.trip_status === "RECONCILED";
      if (!isLate && !["IN_PROGRESS", "COMPLETED"].includes(stop.trip_status)) {
        throw new AppError(409, "TRIP_NOT_EXECUTABLE", "Stop events require an IN_PROGRESS or completed/reconciled offline Trip");
      }
      if (!isLate && ["COMPLETED", "PARTIAL"].includes(stop.stop_status)) {
        throw new AppError(409, "TRIP_STOP_ALREADY_EXECUTED", "This TripStop already has a terminal execution");
      }
      if (!stop.vehicle_id) throw new AppError(422, "TRIP_VEHICLE_REQUIRED", "Inventory-posting StopEvents require a Trip vehicle");

      const locations = await this.ensureLocations(db, auth, stop.vehicle_id, stop.party_id);
      const event = (await db.query<{ stop_event_id: number }>(
        `INSERT INTO stop_event
          (tenant_id,trip_id,trip_stop_id,party_id,event_type,performed_by_staff_id,performed_by_user_id,
           event_time,client_uuid,device_id,latitude,longitude,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING stop_event_id`,
        [auth.tenantId, stop.trip_id, stop.trip_stop_id, stop.party_id, input.eventType ?? "DELIVERY",
          auth.staffId ?? null, auth.userId, input.eventTime, input.clientUuid, input.deviceId ?? null,
          input.latitude ?? null, input.longitude ?? null, input.notes ?? null]
      )).rows[0]!;

      let totalCharge = 0;
      for (const line of input.products) {
        const configured = (await db.query<{
          trip_stop_product_id: number | null;
          quantity_mode: QuantityMode;
          exchange_ratio: string | null;
        }>(
          `SELECT tsp.trip_stop_product_id,tsp.quantity_mode,p.exchange_ratio
             FROM product p
             LEFT JOIN trip_stop_product tsp
               ON tsp.product_id=p.product_id AND tsp.trip_stop_id=$1
            WHERE p.product_id=$2`,
          [tripStopId, line.productId]
        )).rows[0];
        if (!configured) notFound("product");
        if (line.tripStopProductId && configured.trip_stop_product_id !== line.tripStopProductId) {
          throw new AppError(422, "TRIP_STOP_PRODUCT_MISMATCH", "Product does not belong to the specified TripStopProduct");
        }
        if (line.quantityMode && line.quantityMode !== configured.quantity_mode) {
          throw new AppError(422, "QUANTITY_MODE_MISMATCH", "Client quantity mode differs from server configuration");
        }

        const stateIds = await this.stateIds(db);
        const availableFullQty = await this.availableStock(db, locations.vehicle, line.productId, stateIds.FULL);
        const observedGood = line.observedGoodEmptyQty ?? line.goodEmptyQty ?? 0;
        const acceptedGood = line.goodEmptyQty ?? observedGood;
        const fullDelivered = line.fullQtyDelivered ?? 0;
        const damaged = line.damagedEmptyQty ?? 0;
        const rejected = line.rejectedEmptyQty ?? 0;
        const exchange = calculateExchange({
          quantityMode: configured.quantity_mode,
          exchangeRatio: configured.exchange_ratio === null ? null : Number(configured.exchange_ratio),
          observedGoodEmptyQty: observedGood,
          acceptedGoodEmptyQty: acceptedGood,
          damagedEmptyQty: damaged,
          rejectedEmptyQty: rejected,
          fullQtyDelivered: fullDelivered,
          availableFullQty,
          ...(line.excessEmptyResolution ? { excessEmptyResolution: line.excessEmptyResolution } : {}),
          ...(line.authorizeContainerDue !== undefined ? { authorizeContainerDue: line.authorizeContainerDue } : {})
        });

        const standardPrice = await resolvePrice(db, stop.party_id, line.productId, input.eventTime);
        const privilegedOverride = Boolean(line.priceOverride && auth.roles.some((role) => role === "OWNER" || role === "ADMIN"));
        const appliedPrice = privilegedOverride ? line.priceOverride!.price : standardPrice.price;
        const priceSource = privilegedOverride ? "STAFF_OVERRIDE" : standardPrice.source;
        const lineCharge = Math.round(appliedPrice * fullDelivered * 100) / 100;

        let damageCharge = 0;
        if (damaged > 0) {
          if (!line.damageResolution) throw new AppError(422, "DAMAGE_RESOLUTION_REQUIRED", "Damaged empties require an explicit resolution");
          if (line.damageResolution === "CHARGE_DAMAGE") {
            damageCharge = Math.round((await resolveDamageRate(db, line.productId, input.eventTime)) * damaged * 100) / 100;
          }
        }

        const eventProduct = (await db.query<{ stop_event_product_id: number }>(
          `INSERT INTO stop_event_product
            (tenant_id,stop_event_id,trip_stop_product_id,product_id,quantity_mode_snapshot,exchange_ratio_snapshot,
             full_qty_delivered,empty_qty_received_good,empty_qty_received_damaged,empty_qty_rejected,
             container_credit_qty,container_due_qty,price_applied,price_source,line_charge_amount,damage_charge_amount,notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           RETURNING stop_event_product_id`,
          [auth.tenantId, event.stop_event_id, configured.trip_stop_product_id, line.productId, configured.quantity_mode,
            configured.exchange_ratio, fullDelivered, acceptedGood, damaged, rejected, exchange.containerCreditQty,
            exchange.containerDueQty, appliedPrice, priceSource, lineCharge, damageCharge, line.notes ?? null]
        )).rows[0]!;

        for (const exception of exchange.exceptions) {
          await this.insertExchangeException(db, auth, eventProduct.stop_event_product_id, exception.type, exception.quantity, exception.resolution);
        }
        if (damaged > 0 && line.damageResolution) {
          await this.insertExchangeException(db, auth, eventProduct.stop_event_product_id, "DAMAGED_CONTAINER", damaged, line.damageResolution);
        }

        if (line.priceOverride) {
          await db.query(
            `INSERT INTO price_override
              (tenant_id,stop_event_product_id,standard_price,requested_price,requested_by_staff_id,requested_by_user_id,
               approval_status,approved_by_user_id,approved_at,reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [auth.tenantId, eventProduct.stop_event_product_id, standardPrice.price, line.priceOverride.price,
              auth.staffId ?? null, auth.userId, privilegedOverride ? "APPROVED" : "PENDING",
              privilegedOverride ? auth.userId : null, privilegedOverride ? new Date() : null, line.priceOverride.reason]
          );
        }

        if (fullDelivered > 0) {
          await this.insertInventory(db, auth, stop, event.stop_event_id, line.productId, locations.vehicle, locations.customer,
            stateIds.FULL, stateIds.FULL, fullDelivered, "DELIVERY", isLate);
        }
        if (acceptedGood > 0) {
          await this.insertInventory(db, auth, stop, event.stop_event_id, line.productId, locations.customer, locations.vehicle,
            stateIds.EMPTY, stateIds.EMPTY, acceptedGood, "EMPTY_RETURN", isLate);
        }
        if (damaged > 0 && line.damageResolution !== "REJECT_DAMAGE") {
          await this.insertInventory(db, auth, stop, event.stop_event_id, line.productId, locations.customer, locations.vehicle,
            stateIds.DAMAGED, stateIds.DAMAGED, damaged, "DAMAGE_RETURN", isLate);
        }
        if (lineCharge > 0) {
          await this.insertMoney(db, auth, stop, event.stop_event_id, lineCharge, "IN", "CUSTOMER_CHARGE", null, "CUSTOMER_RECEIVABLE", isLate);
        }
        if (damageCharge > 0) {
          await this.insertMoney(db, auth, stop, event.stop_event_id, damageCharge, "IN", "DAMAGE_CHARGE", null, "CUSTOMER_RECEIVABLE", isLate);
        }
        totalCharge += lineCharge + damageCharge;
      }

      for (const payment of input.payments ?? []) {
        if (payment.amount <= 0) throw new AppError(422, "INVALID_PAYMENT_AMOUNT", "Payment amount must be positive");
        await this.insertMoney(db, auth, stop, event.stop_event_id, payment.amount, "IN", "CUSTOMER_PAYMENT",
          payment.paymentMethod, payment.paymentMethod === "CASH" ? "STAFF_CASH" : "BANK", isLate);
      }

      if (!isLate) {
        await db.query(
          `UPDATE trip_stop SET status=$2,completed_at=NOW() WHERE trip_stop_id=$1`,
          [tripStopId, input.completionStatus ?? "COMPLETED"]
        );
        await db.query(
          `UPDATE trip_stop_product SET status=$2 WHERE trip_stop_id=$1`,
          [tripStopId, input.completionStatus ?? "COMPLETED"]
        );
      } else {
        await this.recordLateEvent(db, auth, stop, event.stop_event_id, input.clientUuid);
      }
      return this.getAccepted(db, input.clientUuid, totalCharge);
    });
  }

  private async findAccepted(db: DbClient, clientUuid: string) {
    const row = (await db.query<{ stop_event_id: number }>("SELECT stop_event_id FROM stop_event WHERE client_uuid=$1", [clientUuid])).rows[0];
    return row ? this.getAccepted(db, clientUuid) : null;
  }

  private async getAccepted(db: DbClient, clientUuid: string, knownTotalCharge?: number) {
    const event = (await db.query("SELECT * FROM stop_event WHERE client_uuid=$1", [clientUuid])).rows[0];
    if (!event) notFound("stop_event");
    const [products, inventory, money] = await Promise.all([
      db.query("SELECT * FROM stop_event_product WHERE stop_event_id=$1 ORDER BY stop_event_product_id", [event.stop_event_id]),
      db.query("SELECT * FROM inventory_ledger_entry WHERE stop_event_id=$1 ORDER BY inventory_ledger_id", [event.stop_event_id]),
      db.query("SELECT * FROM money_ledger_entry WHERE stop_event_id=$1 ORDER BY money_ledger_id", [event.stop_event_id])
    ]);
    return {
      event,
      products: products.rows,
      inventoryLedgerEntries: inventory.rows,
      moneyLedgerEntries: money.rows,
      totalCharge: knownTotalCharge ?? products.rows.reduce((sum, row) => sum + Number(row.line_charge_amount) + Number(row.damage_charge_amount), 0)
    };
  }

  private async ensureLocations(db: DbClient, auth: AuthContext, vehicleId: number, partyId: number) {
    const vehicle = (await db.query<{ inventory_location_id: number }>(
      `INSERT INTO inventory_location (tenant_id,location_code,name,location_type,vehicle_id,created_by_user_id)
       SELECT $1,'VEHICLE:'||vehicle_id,'Vehicle '||registration_no,'VEHICLE',vehicle_id,$3 FROM vehicle WHERE vehicle_id=$2
       ON CONFLICT (tenant_id,location_code) DO UPDATE SET name=EXCLUDED.name RETURNING inventory_location_id`,
      [auth.tenantId, vehicleId, auth.userId]
    )).rows[0];
    const customer = (await db.query<{ inventory_location_id: number }>(
      `INSERT INTO inventory_location (tenant_id,location_code,name,location_type,party_id,created_by_user_id)
       SELECT $1,'CUSTOMER:'||party_id,name,'CUSTOMER',party_id,$3 FROM party WHERE party_id=$2
       ON CONFLICT (tenant_id,location_code) DO UPDATE SET name=EXCLUDED.name RETURNING inventory_location_id`,
      [auth.tenantId, partyId, auth.userId]
    )).rows[0];
    if (!vehicle || !customer) throw new AppError(422, "INVENTORY_LOCATION_CONTEXT_INVALID", "Could not resolve event inventory locations");
    return { vehicle: vehicle.inventory_location_id, customer: customer.inventory_location_id };
  }

  private async stateIds(db: DbClient) {
    const result = await db.query<{ code: string; inventory_state_id: number }>("SELECT code,inventory_state_id FROM inventory_state");
    return Object.fromEntries(result.rows.map((row) => [row.code, row.inventory_state_id])) as Record<"FULL" | "EMPTY" | "DAMAGED", number>;
  }

  private async availableStock(db: DbClient, locationId: number, productId: number, stateId: number) {
    const row = (await db.query<{ quantity: string }>(
      `SELECT quantity FROM stock_on_hand_view WHERE inventory_location_id=$1 AND product_id=$2 AND inventory_state_id=$3`,
      [locationId, productId, stateId]
    )).rows[0];
    return Math.max(Number(row?.quantity ?? 0), 0);
  }

  private insertExchangeException(db: DbClient, auth: AuthContext, eventProductId: number, type: string, quantity: number, resolution: string) {
    return db.query(
      `INSERT INTO exchange_exception
        (tenant_id,stop_event_product_id,exception_type,quantity,resolution,authorized_by_staff_id,approved_by_user_id,approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [auth.tenantId, eventProductId, type, quantity, resolution, auth.staffId ?? null,
        auth.staffId ? null : auth.userId, auth.staffId ? null : new Date()]
    );
  }

  private insertInventory(
    db: DbClient, auth: AuthContext, stop: StopContext, eventId: number, productId: number,
    fromLocation: number, toLocation: number, fromState: number, toState: number, quantity: number,
    eventType: string, isLate: boolean
  ) {
    return db.query(
      `INSERT INTO inventory_ledger_entry
        (tenant_id,product_id,from_location_id,to_location_id,from_state_id,to_state_id,party_id,quantity,event_type,
         trip_id,trip_stop_id,stop_event_id,reference_type,reference_id,occurred_at,created_by_user_id,created_by_staff_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$12,$14,$15,$16)`,
      [auth.tenantId, productId, fromLocation, toLocation, fromState, toState, stop.party_id, quantity, eventType,
        stop.trip_id, stop.trip_stop_id, eventId, isLate ? "POST_RECONCILIATION_PENDING" : "STOP_EVENT", new Date(), auth.userId, auth.staffId ?? null]
    );
  }

  private insertMoney(
    db: DbClient, auth: AuthContext, stop: StopContext, eventId: number, amount: number, direction: string,
    transactionType: string, paymentMethod: string | null, accountType: string, isLate: boolean
  ) {
    return db.query(
      `INSERT INTO money_ledger_entry
        (tenant_id,party_id,staff_id,amount,direction,transaction_type,payment_method,account_type,
         trip_id,trip_stop_id,stop_event_id,reference_type,reference_id,occurred_at,created_by_user_id,created_by_staff_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,NOW(),$13,$14)`,
      [auth.tenantId, stop.party_id, paymentMethod === "CASH" ? auth.staffId ?? null : null, amount, direction,
        transactionType, paymentMethod, accountType, stop.trip_id, stop.trip_stop_id, eventId,
        isLate ? "POST_RECONCILIATION_PENDING" : "STOP_EVENT", auth.userId, auth.staffId ?? null]
    );
  }

  private async recordLateEvent(db: DbClient, auth: AuthContext, stop: StopContext, eventId: number, clientUuid: string) {
    const reconciliation = (await db.query<{ reconciliation_id: number }>(
      "SELECT reconciliation_id FROM trip_reconciliation WHERE trip_id=$1", [stop.trip_id]
    )).rows[0];
    if (!reconciliation) throw new AppError(409, "RECONCILIATION_NOT_FOUND", "Reconciled Trip has no reconciliation header");
    const exception = (await db.query<{ reconciliation_exception_id: number }>(
      `INSERT INTO reconciliation_exception
        (tenant_id,reconciliation_id,exception_type,severity,trip_id,trip_stop_id,stop_event_id,detected_source,description)
       VALUES ($1,$2,'LATE_STOP_EVENT','CRITICAL',$3,$4,$5,'SYNC_ENGINE',$6)
       RETURNING reconciliation_exception_id`,
      [auth.tenantId, reconciliation.reconciliation_id, stop.trip_id, stop.trip_stop_id, eventId,
        `Late offline StopEvent ${clientUuid} was posted after reconciliation and requires explicit review.`]
    )).rows[0]!;
    await db.query(
      `INSERT INTO post_reconciliation_adjustment
        (tenant_id,reconciliation_id,trip_id,reconciliation_exception_id,adjustment_type,reason_code,reason_notes,
         requested_by_staff_id,requested_by_user_id,stop_event_id)
       VALUES ($1,$2,$3,$4,'MIXED','LATE_OFFLINE_EVENT',$5,$6,$7,$8)`,
      [auth.tenantId, reconciliation.reconciliation_id, stop.trip_id, exception.reconciliation_exception_id,
        "Pending owner/admin review of ledger effects appended after operational close.", auth.staffId ?? null, auth.userId, eventId]
    );
  }
}
