import { randomUUID } from "node:crypto";
import type { AuthContext } from "../auth/types.js";
import { withTenantTransaction, type DbClient } from "../db/transaction.js";
import { AppError, notFound } from "../http/errors.js";
import type { ServiceDeps } from "./deps.js";

export class ReconciliationService {
  constructor(private readonly deps: ServiceDeps) {}

  private tx<T>(auth: AuthContext, work: (db: DbClient) => Promise<T>) {
    return withTenantTransaction(this.deps.pool, auth.tenantId, this.deps.config.DATABASE_RUNTIME_ROLE, work);
  }

  create(auth: AuthContext, tripId: number) {
    return this.tx(auth, async (db) => {
      const trip = (await db.query<{ status: string; trip_number: string; vehicle_id: number | null }>(
        "SELECT status,trip_number,vehicle_id FROM trip WHERE trip_id=$1", [tripId]
      )).rows[0];
      if (!trip) notFound("trip");
      if (trip.status !== "COMPLETED") throw new AppError(409, "TRIP_NOT_COMPLETED", "Reconciliation requires a COMPLETED Trip");
      const header = (await db.query(
        `INSERT INTO trip_reconciliation (tenant_id,trip_id,reconciliation_number)
         VALUES ($1,$2,$3) RETURNING *`,
        [auth.tenantId, tripId, `REC-${trip.trip_number}-${randomUUID().slice(0, 6).toUpperCase()}`]
      )).rows[0];
      return { ...header, expectations: await this.expectations(db, tripId, trip.vehicle_id) };
    });
  }

  private async expectations(db: DbClient, tripId: number, vehicleId: number | null) {
    const stock = vehicleId
      ? await db.query(
          `SELECT soh.inventory_location_id,soh.product_id,soh.inventory_state_id,soh.quantity AS expected_qty
             FROM stock_on_hand_view soh
             JOIN inventory_location il ON il.inventory_location_id=soh.inventory_location_id
            WHERE il.vehicle_id=$1 ORDER BY soh.product_id,soh.inventory_state_id`,
          [vehicleId]
        )
      : { rows: [] };
    const cash = await db.query(
      `SELECT staff_id,
              COALESCE(SUM(CASE
                WHEN transaction_type='CUSTOMER_PAYMENT' AND payment_method='CASH' THEN amount
                WHEN transaction_type='STAFF_CASH_HANDOVER' THEN -amount
                ELSE 0 END),0) AS expected_cash
         FROM money_ledger_entry WHERE trip_id=$1 AND staff_id IS NOT NULL GROUP BY staff_id`,
      [tripId]
    );
    return { stock: stock.rows, cash: cash.rows };
  }

  submitStock(auth: AuthContext, reconciliationId: number, input: {
    lines: Array<{ inventoryLocationId: number; productId: number; inventoryStateId: number; actualQty: number; varianceReasonCode?: string; varianceNotes?: string }>;
  }) {
    return this.tx(auth, async (db) => {
      await this.assertEditable(db, reconciliationId);
      const rows = [];
      for (const line of input.lines) {
        const expected = Number((await db.query<{ quantity: string }>(
          `SELECT quantity FROM stock_on_hand_view
            WHERE inventory_location_id=$1 AND product_id=$2 AND inventory_state_id=$3`,
          [line.inventoryLocationId, line.productId, line.inventoryStateId]
        )).rows[0]?.quantity ?? 0);
        if (expected !== line.actualQty && !line.varianceReasonCode) {
          throw new AppError(422, "VARIANCE_REASON_REQUIRED", "A non-zero stock variance requires a reason");
        }
        const result = await db.query(
          `INSERT INTO trip_stock_reconciliation
            (tenant_id,reconciliation_id,inventory_location_id,product_id,inventory_state_id,expected_qty,actual_qty,
             variance_reason_code,variance_notes,approval_status,counted_by_staff_id,counted_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (tenant_id,reconciliation_id,inventory_location_id,product_id,inventory_state_id)
           DO UPDATE SET actual_qty=EXCLUDED.actual_qty,variance_reason_code=EXCLUDED.variance_reason_code,
                         variance_notes=EXCLUDED.variance_notes,approval_status=EXCLUDED.approval_status,
                         counted_by_staff_id=EXCLUDED.counted_by_staff_id,counted_by_user_id=EXCLUDED.counted_by_user_id,
                         counted_at=NOW()
           RETURNING *`,
          [auth.tenantId, reconciliationId, line.inventoryLocationId, line.productId, line.inventoryStateId,
            expected, line.actualQty, line.varianceReasonCode ?? null, line.varianceNotes ?? null,
            expected === line.actualQty ? "NOT_REQUIRED" : "PENDING", auth.staffId ?? null, auth.userId]
        );
        rows.push(result.rows[0]);
      }
      return rows;
    });
  }

  submitCash(auth: AuthContext, reconciliationId: number, input: {
    staffId: number;
    actualCash: number;
    varianceReasonCode?: string;
    varianceNotes?: string;
  }) {
    return this.tx(auth, async (db) => {
      const tripId = await this.assertEditable(db, reconciliationId);
      const expected = Number((await db.query<{ expected_cash: string }>(
        `SELECT COALESCE(SUM(CASE
          WHEN transaction_type='CUSTOMER_PAYMENT' AND payment_method='CASH' THEN amount
          WHEN transaction_type='STAFF_CASH_HANDOVER' THEN -amount ELSE 0 END),0) AS expected_cash
         FROM money_ledger_entry WHERE trip_id=$1 AND staff_id=$2`,
        [tripId, input.staffId]
      )).rows[0]?.expected_cash ?? 0);
      if (expected !== input.actualCash && !input.varianceReasonCode) {
        throw new AppError(422, "VARIANCE_REASON_REQUIRED", "A non-zero cash variance requires a reason");
      }
      return (await db.query(
        `INSERT INTO trip_cash_reconciliation
          (tenant_id,reconciliation_id,staff_id,expected_cash,actual_cash,variance_reason_code,variance_notes,
           approval_status,submitted_by_staff_id,submitted_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tenant_id,reconciliation_id,staff_id)
         DO UPDATE SET actual_cash=EXCLUDED.actual_cash,variance_reason_code=EXCLUDED.variance_reason_code,
                       variance_notes=EXCLUDED.variance_notes,approval_status=EXCLUDED.approval_status,
                       submitted_by_staff_id=EXCLUDED.submitted_by_staff_id,submitted_by_user_id=EXCLUDED.submitted_by_user_id,
                       submitted_at=NOW()
         RETURNING *`,
        [auth.tenantId, reconciliationId, input.staffId, expected, input.actualCash,
          input.varianceReasonCode ?? null, input.varianceNotes ?? null, expected === input.actualCash ? "NOT_REQUIRED" : "PENDING",
          auth.staffId ?? null, auth.userId]
      )).rows[0];
    });
  }

  submit(auth: AuthContext, reconciliationId: number) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `UPDATE trip_reconciliation
            SET status='SUBMITTED',submitted_by_staff_id=$2,submitted_by_user_id=$3
          WHERE reconciliation_id=$1 AND status IN ('OPEN','REOPENED') RETURNING *`,
        [reconciliationId, auth.staffId ?? null, auth.userId]
      );
      if (!result.rows[0]) throw new AppError(409, "RECONCILIATION_NOT_SUBMITTABLE", "Reconciliation is not OPEN or REOPENED");
      return result.rows[0];
    });
  }

  approve(auth: AuthContext, reconciliationId: number) {
    return this.tx(auth, async (db) => {
      const header = (await db.query<{ trip_id: number; status: string }>(
        "SELECT trip_id,status FROM trip_reconciliation WHERE reconciliation_id=$1 FOR UPDATE", [reconciliationId]
      )).rows[0];
      if (!header) notFound("reconciliation");
      if (header.status !== "SUBMITTED") throw new AppError(409, "RECONCILIATION_NOT_APPROVABLE", "Only SUBMITTED reconciliation may be approved");
      const openExceptions = Number((await db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM reconciliation_exception WHERE reconciliation_id=$1 AND status IN ('OPEN','UNDER_REVIEW')",
        [reconciliationId]
      )).rows[0]?.count ?? 0);
      if (openExceptions) throw new AppError(409, "OPEN_RECONCILIATION_EXCEPTIONS", "Open reconciliation exceptions block approval", { openExceptions });

      const stockRows = await db.query<{
        trip_stock_recon_id: number; inventory_location_id: number; product_id: number; inventory_state_id: number;
        variance_qty: string;
      }>("SELECT * FROM trip_stock_reconciliation WHERE reconciliation_id=$1 AND approval_status='PENDING' FOR UPDATE", [reconciliationId]);
      for (const row of stockRows.rows) {
        const variance = Number(row.variance_qty);
        const ledger = (await db.query<{ inventory_ledger_id: number }>(
          `INSERT INTO inventory_ledger_entry
            (tenant_id,product_id,from_location_id,to_location_id,from_state_id,to_state_id,quantity,event_type,
             trip_id,reference_type,reference_id,occurred_at,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'ADJUSTMENT',$8,'STOCK_RECONCILIATION',$9,NOW(),$10)
           RETURNING inventory_ledger_id`,
          [auth.tenantId, row.product_id, variance < 0 ? row.inventory_location_id : null,
            variance > 0 ? row.inventory_location_id : null, variance < 0 ? row.inventory_state_id : null,
            variance > 0 ? row.inventory_state_id : null, Math.abs(variance), header.trip_id, row.trip_stock_recon_id, auth.userId]
        )).rows[0]!;
        await db.query(
          `UPDATE trip_stock_reconciliation SET approval_status='APPROVED',approved_by_user_id=$2,approved_at=NOW(),adjustment_inventory_ledger_id=$3
            WHERE trip_stock_recon_id=$1`,
          [row.trip_stock_recon_id, auth.userId, ledger.inventory_ledger_id]
        );
      }

      const cashRows = await db.query<{ trip_cash_recon_id: number; staff_id: number; variance_amount: string }>(
        "SELECT * FROM trip_cash_reconciliation WHERE reconciliation_id=$1 AND approval_status='PENDING' FOR UPDATE", [reconciliationId]
      );
      for (const row of cashRows.rows) {
        const variance = Number(row.variance_amount);
        const ledger = (await db.query<{ money_ledger_id: number }>(
          `INSERT INTO money_ledger_entry
            (tenant_id,staff_id,amount,direction,transaction_type,account_type,trip_id,reference_type,reference_id,occurred_at,created_by_user_id)
           VALUES ($1,$2,$3,$4,'ADJUSTMENT','STAFF_CASH',$5,'CASH_RECONCILIATION',$6,NOW(),$7)
           RETURNING money_ledger_id`,
          [auth.tenantId, row.staff_id, Math.abs(variance), variance > 0 ? "IN" : "OUT", header.trip_id, row.trip_cash_recon_id, auth.userId]
        )).rows[0]!;
        await db.query(
          `UPDATE trip_cash_reconciliation SET approval_status='APPROVED',approved_by_user_id=$2,approved_at=NOW(),adjustment_money_ledger_id=$3
            WHERE trip_cash_recon_id=$1`,
          [row.trip_cash_recon_id, auth.userId, ledger.money_ledger_id]
        );
      }

      return (await db.query(
        "UPDATE trip_reconciliation SET status='APPROVED',approved_by_user_id=$2 WHERE reconciliation_id=$1 RETURNING *",
        [reconciliationId, auth.userId]
      )).rows[0];
    });
  }

  reconcileTrip(auth: AuthContext, tripId: number) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        "UPDATE trip SET status='RECONCILED' WHERE trip_id=$1 AND status='COMPLETED' RETURNING *", [tripId]
      );
      if (!result.rows[0]) throw new AppError(409, "TRIP_NOT_RECONCILABLE", "Trip must be COMPLETED with an approved reconciliation");
      return result.rows[0];
    });
  }

  submitCashHandover(auth: AuthContext, tripId: number, input: { fromStaffId: number; toUserId: number; amount: number; reconciliationId?: number }) {
    return this.tx(auth, async (db) => (await db.query(
      `INSERT INTO cash_handover
        (tenant_id,trip_id,reconciliation_id,from_staff_id,to_user_id,amount,submitted_by_staff_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [auth.tenantId, tripId, input.reconciliationId ?? null, input.fromStaffId, input.toUserId, input.amount, auth.staffId ?? input.fromStaffId]
    )).rows[0]);
  }

  confirmCashHandover(auth: AuthContext, handoverId: number) {
    return this.tx(auth, async (db) => {
      const handover = (await db.query<{
        cash_handover_id: number; trip_id: number | null; from_staff_id: number; amount: string; status: string;
      }>("SELECT * FROM cash_handover WHERE cash_handover_id=$1 FOR UPDATE", [handoverId])).rows[0];
      if (!handover) notFound("cash_handover");
      if (!["SUBMITTED", "DISPUTED"].includes(handover.status)) throw new AppError(409, "CASH_HANDOVER_NOT_CONFIRMABLE", "Cash handover is not confirmable");
      const ledger = (await db.query<{ money_ledger_id: number }>(
        `INSERT INTO money_ledger_entry
          (tenant_id,staff_id,amount,direction,transaction_type,payment_method,account_type,trip_id,
           reference_type,reference_id,occurred_at,created_by_user_id)
         VALUES ($1,$2,$3,'OUT','STAFF_CASH_HANDOVER','CASH','STAFF_CASH',$4,'CASH_HANDOVER',$5,NOW(),$6)
         RETURNING money_ledger_id`,
        [auth.tenantId, handover.from_staff_id, handover.amount, handover.trip_id, handover.cash_handover_id, auth.userId]
      )).rows[0]!;
      return (await db.query(
        `UPDATE cash_handover SET status='CONFIRMED',confirmed_by_user_id=$2,money_ledger_id=$3
          WHERE cash_handover_id=$1 RETURNING *`,
        [handoverId, auth.userId, ledger.money_ledger_id]
      )).rows[0];
    });
  }

  disputeCashHandover(auth: AuthContext, handoverId: number, reason: string) {
    return this.tx(auth, async (db) => {
      const result = await db.query(
        `UPDATE cash_handover SET status='DISPUTED',dispute_reason=$2,confirmed_by_user_id=$3
          WHERE cash_handover_id=$1 AND status='SUBMITTED' RETURNING *`,
        [handoverId, reason, auth.userId]
      );
      if (!result.rows[0]) throw new AppError(409, "CASH_HANDOVER_NOT_DISPUTABLE", "Only submitted handovers may be disputed");
      return result.rows[0];
    });
  }

  private async assertEditable(db: DbClient, reconciliationId: number): Promise<number> {
    const header = (await db.query<{ trip_id: number; status: string }>(
      "SELECT trip_id,status FROM trip_reconciliation WHERE reconciliation_id=$1", [reconciliationId]
    )).rows[0];
    if (!header) notFound("reconciliation");
    if (!["OPEN", "REOPENED"].includes(header.status)) throw new AppError(409, "RECONCILIATION_NOT_EDITABLE", "Reconciliation is not editable");
    return header.trip_id;
  }
}
