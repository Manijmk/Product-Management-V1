import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { TenantPrismaTransaction } from "../tenancy/prisma-tenant-transaction.service.js";

interface StockSnapshotRow {
  inventory_location_id: bigint;
  product_id: bigint;
  inventory_state_id: bigint;
  expected_qty: Prisma.Decimal;
}

interface CashSnapshotRow {
  staff_id: bigint;
  expected_cash: Prisma.Decimal;
}

const reconciliationSelection = {
  reconciliation_id: true,
  trip_id: true,
  reconciliation_number: true,
  status: true,
  started_at: true,
  submitted_at: true,
  approved_at: true,
  notes: true,
  trip_stock_reconciliation: {
    orderBy: { trip_stock_recon_id: "asc" as const },
    select: {
      trip_stock_recon_id: true,
      inventory_location_id: true,
      product_id: true,
      inventory_state_id: true,
      expected_qty: true,
      actual_qty: true,
      variance_qty: true,
      variance_reason_code: true,
      variance_notes: true,
      approval_status: true,
      adjustment_inventory_ledger_id: true,
      counted_by_staff_id: true
    }
  },
  trip_cash_reconciliation: {
    orderBy: { trip_cash_recon_id: "asc" as const },
    select: {
      trip_cash_recon_id: true,
      staff_id: true,
      expected_cash: true,
      actual_cash: true,
      variance_amount: true,
      variance_reason_code: true,
      variance_notes: true,
      approval_status: true,
      adjustment_money_ledger_id: true,
      submitted_by_staff_id: true
    }
  },
  reconciliation_exception: {
    orderBy: { reconciliation_exception_id: "asc" as const },
    select: {
      reconciliation_exception_id: true,
      exception_type: true,
      severity: true,
      trip_stop_id: true,
      stop_event_id: true,
      detected_source: true,
      description: true,
      status: true,
      resolution_notes: true,
      detected_at: true
    }
  },
  post_reconciliation_adjustment: {
    orderBy: { post_recon_adjustment_id: "asc" as const },
    select: {
      post_recon_adjustment_id: true,
      reconciliation_exception_id: true,
      adjustment_type: true,
      reason_code: true,
      reason_notes: true,
      approval_status: true,
      inventory_ledger_id: true,
      money_ledger_id: true,
      stop_event_id: true,
      requested_at: true,
      approved_at: true
    }
  }
} as const;

@Injectable()
export class ReconciliationRepository {
  async lock(transaction: TenantPrismaTransaction, key: string): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT 1 AS acquired FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    );
  }

  findTrip(transaction: TenantPrismaTransaction, tenantId: number, tripId: number) {
    return transaction.trip.findFirst({
      where: { tenantId: BigInt(tenantId), tripId: BigInt(tripId) },
      select: {
        tripId: true,
        tripNumber: true,
        status: true,
        vehicleId: true,
        primaryStaffId: true,
        trip_stop: { select: { trip_stop_id: true, status: true } },
        trip_staff: { where: { left_at: null }, select: { staff_id: true } },
        trip_reconciliation: { select: { reconciliation_id: true, status: true } }
      }
    });
  }

  completeTrip(transaction: TenantPrismaTransaction, tenantId: number, tripId: bigint) {
    return transaction.trip.update({
      where: { tenantId_tripId: { tenantId: BigInt(tenantId), tripId } },
      data: { status: "COMPLETED", completed_at: new Date() },
      select: { tripId: true, tripNumber: true, status: true, completed_at: true }
    });
  }

  createReconciliation(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripId: bigint,
    reconciliationNumber: string,
    notes?: string
  ) {
    return transaction.trip_reconciliation.create({
      data: {
        tenant_id: BigInt(tenantId),
        trip_id: tripId,
        reconciliation_number: reconciliationNumber,
        notes
      },
      select: { reconciliation_id: true }
    });
  }

  findReconciliation(transaction: TenantPrismaTransaction, tenantId: number, reconciliationId: number | bigint) {
    return transaction.trip_reconciliation.findFirst({
      where: { tenant_id: BigInt(tenantId), reconciliation_id: BigInt(reconciliationId) },
      select: reconciliationSelection
    });
  }

  expectedStockSnapshot(transaction: TenantPrismaTransaction, tenantId: number, vehicleId: bigint | null) {
    if (vehicleId === null) return Promise.resolve([] as StockSnapshotRow[]);
    return transaction.$queryRaw<StockSnapshotRow[]>(Prisma.sql`
      SELECT il.inventory_location_id,
             soh.product_id,
             soh.inventory_state_id,
             soh.quantity::numeric(14,3) AS expected_qty
        FROM pms.inventory_location il
        JOIN pms.stock_on_hand_view soh
          ON soh.tenant_id = il.tenant_id
         AND soh.inventory_location_id = il.inventory_location_id
       WHERE il.tenant_id = ${BigInt(tenantId)}
         AND il.vehicle_id = ${vehicleId}
         AND il.status = 'ACTIVE'
         AND soh.quantity <> 0
       ORDER BY soh.product_id, soh.inventory_state_id
    `);
  }

  expectedCashSnapshot(transaction: TenantPrismaTransaction, tenantId: number, tripId: bigint) {
    return transaction.$queryRaw<CashSnapshotRow[]>(Prisma.sql`
      SELECT staff_id,
             SUM(CASE
                   WHEN transaction_type = 'CUSTOMER_PAYMENT'
                    AND payment_method = 'CASH'
                    AND account_type = 'STAFF_CASH' THEN amount
                   WHEN transaction_type = 'STAFF_CASH_HANDOVER' THEN -amount
                   WHEN transaction_type = 'ADJUSTMENT' AND direction = 'IN' THEN amount
                   WHEN transaction_type = 'ADJUSTMENT' AND direction = 'OUT' THEN -amount
                   ELSE 0
                 END)::numeric(14,2) AS expected_cash
        FROM pms.money_ledger_entry
       WHERE tenant_id = ${BigInt(tenantId)}
         AND trip_id = ${tripId}
         AND staff_id IS NOT NULL
       GROUP BY staff_id
       ORDER BY staff_id
    `);
  }

  findStockDimension(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    reconciliationId: number,
    locationId: number,
    productId: number,
    stateId: number
  ) {
    return transaction.trip_reconciliation.findFirst({
      where: { tenant_id: BigInt(tenantId), reconciliation_id: BigInt(reconciliationId) },
      select: {
        reconciliation_id: true,
        status: true,
        trip: { select: { tripId: true, vehicleId: true } },
        trip_stock_reconciliation: {
          where: {
            inventory_location_id: BigInt(locationId),
            product_id: BigInt(productId),
            inventory_state_id: BigInt(stateId)
          },
          select: { trip_stock_recon_id: true }
        }
      }
    });
  }

  findLocationProductState(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    locationId: number,
    productId: number,
    stateId: number
  ) {
    return Promise.all([
      transaction.inventory_location.findFirst({
        where: { tenant_id: BigInt(tenantId), inventory_location_id: BigInt(locationId), status: "ACTIVE" },
        select: { inventory_location_id: true, vehicle_id: true }
      }),
      transaction.product.findFirst({
        where: { tenantId: BigInt(tenantId), productId: BigInt(productId), activeStatus: "ACTIVE" },
        select: { productId: true }
      }),
      transaction.inventory_state.findFirst({
        where: { inventory_state_id: BigInt(stateId) },
        select: { inventory_state_id: true }
      })
    ]);
  }

  async expectedStock(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    locationId: number,
    productId: number,
    stateId: number
  ): Promise<number> {
    const rows = await transaction.$queryRaw<{ quantity: Prisma.Decimal }[]>(Prisma.sql`
      SELECT COALESCE(quantity, 0)::numeric(14,3) AS quantity
        FROM pms.stock_on_hand_view
       WHERE tenant_id = ${BigInt(tenantId)}
         AND inventory_location_id = ${BigInt(locationId)}
         AND product_id = ${BigInt(productId)}
         AND inventory_state_id = ${BigInt(stateId)}
    `);
    return rows[0]?.quantity.toNumber() ?? 0;
  }

  upsertStock(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    reconciliationId: number,
    actorUserId: number,
    actorStaffId: bigint | undefined,
    input: {
      inventoryLocationId: number;
      productId: number;
      inventoryStateId: number;
      expectedQty: number;
      actualQty: number;
      varianceReasonCode?: string;
      varianceNotes?: string;
    }
  ) {
    const variance = Math.abs(input.actualQty - input.expectedQty) >= 0.0005;
    return transaction.trip_stock_reconciliation.upsert({
      where: {
        tenant_id_reconciliation_id_inventory_location_id_product_id_inventory_state_id: {
          tenant_id: BigInt(tenantId),
          reconciliation_id: BigInt(reconciliationId),
          inventory_location_id: BigInt(input.inventoryLocationId),
          product_id: BigInt(input.productId),
          inventory_state_id: BigInt(input.inventoryStateId)
        }
      },
      create: {
        tenant_id: BigInt(tenantId),
        reconciliation_id: BigInt(reconciliationId),
        inventory_location_id: BigInt(input.inventoryLocationId),
        product_id: BigInt(input.productId),
        inventory_state_id: BigInt(input.inventoryStateId),
        expected_qty: input.expectedQty,
        actual_qty: input.actualQty,
        variance_reason_code: input.varianceReasonCode,
        variance_notes: input.varianceNotes,
        approval_status: variance ? "PENDING" : "NOT_REQUIRED",
        counted_by_staff_id: actorStaffId,
        counted_by_user_id: BigInt(actorUserId)
      },
      update: {
        expected_qty: input.expectedQty,
        actual_qty: input.actualQty,
        variance_reason_code: input.varianceReasonCode,
        variance_notes: input.varianceNotes,
        approval_status: variance ? "PENDING" : "NOT_REQUIRED",
        approved_by_user_id: null,
        approved_at: null,
        adjustment_inventory_ledger_id: null,
        counted_by_staff_id: actorStaffId,
        counted_by_user_id: BigInt(actorUserId),
        counted_at: new Date()
      },
      select: {
        trip_stock_recon_id: true,
        expected_qty: true,
        actual_qty: true,
        variance_qty: true,
        approval_status: true
      }
    });
  }

  findCashSource(transaction: TenantPrismaTransaction, tenantId: number, reconciliationId: number, staffId: number) {
    return transaction.trip_reconciliation.findFirst({
      where: { tenant_id: BigInt(tenantId), reconciliation_id: BigInt(reconciliationId) },
      select: {
        reconciliation_id: true,
        status: true,
        trip: {
          select: {
            tripId: true,
            primaryStaffId: true,
            trip_staff: { where: { staff_id: BigInt(staffId) }, select: { trip_staff_id: true } }
          }
        }
      }
    });
  }

  async expectedCash(transaction: TenantPrismaTransaction, tenantId: number, tripId: bigint, staffId: number): Promise<number> {
    const rows = await transaction.$queryRaw<{ expected_cash: Prisma.Decimal }[]>(Prisma.sql`
      SELECT COALESCE(SUM(CASE
               WHEN transaction_type = 'CUSTOMER_PAYMENT'
                AND payment_method = 'CASH'
                AND account_type = 'STAFF_CASH' THEN amount
               WHEN transaction_type = 'STAFF_CASH_HANDOVER' THEN -amount
               WHEN transaction_type = 'ADJUSTMENT' AND direction = 'IN' THEN amount
               WHEN transaction_type = 'ADJUSTMENT' AND direction = 'OUT' THEN -amount
               ELSE 0 END), 0)::numeric(14,2) AS expected_cash
        FROM pms.money_ledger_entry
       WHERE tenant_id = ${BigInt(tenantId)}
         AND trip_id = ${tripId}
         AND staff_id = ${BigInt(staffId)}
    `);
    return rows[0]?.expected_cash.toNumber() ?? 0;
  }

  upsertCash(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    reconciliationId: number,
    actorUserId: number,
    actorStaffId: bigint | undefined,
    input: {
      staffId: number;
      expectedCash: number;
      actualCash: number;
      varianceReasonCode?: string;
      varianceNotes?: string;
    }
  ) {
    const variance = Math.abs(input.actualCash - input.expectedCash) >= 0.005;
    return transaction.trip_cash_reconciliation.upsert({
      where: {
        tenant_id_reconciliation_id_staff_id: {
          tenant_id: BigInt(tenantId),
          reconciliation_id: BigInt(reconciliationId),
          staff_id: BigInt(input.staffId)
        }
      },
      create: {
        tenant_id: BigInt(tenantId),
        reconciliation_id: BigInt(reconciliationId),
        staff_id: BigInt(input.staffId),
        expected_cash: input.expectedCash,
        actual_cash: input.actualCash,
        variance_reason_code: input.varianceReasonCode,
        variance_notes: input.varianceNotes,
        approval_status: variance ? "PENDING" : "NOT_REQUIRED",
        submitted_by_staff_id: actorStaffId,
        submitted_by_user_id: BigInt(actorUserId)
      },
      update: {
        expected_cash: input.expectedCash,
        actual_cash: input.actualCash,
        variance_reason_code: input.varianceReasonCode,
        variance_notes: input.varianceNotes,
        approval_status: variance ? "PENDING" : "NOT_REQUIRED",
        approved_by_user_id: null,
        approved_at: null,
        adjustment_money_ledger_id: null,
        submitted_by_staff_id: actorStaffId,
        submitted_by_user_id: BigInt(actorUserId),
        submitted_at: new Date()
      },
      select: {
        trip_cash_recon_id: true,
        expected_cash: true,
        actual_cash: true,
        variance_amount: true,
        approval_status: true
      }
    });
  }

  findActorStaff(transaction: TenantPrismaTransaction, tenantId: number, userId: number) {
    return transaction.staff.findFirst({
      where: { tenant_id: BigInt(tenantId), user_id: BigInt(userId), status: "ACTIVE" },
      select: { staff_id: true }
    });
  }

  submitReconciliation(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    reconciliationId: bigint,
    actorUserId: number,
    actorStaffId?: bigint
  ) {
    return transaction.trip_reconciliation.update({
      where: { tenant_id_reconciliation_id: { tenant_id: BigInt(tenantId), reconciliation_id: reconciliationId } },
      data: {
        status: "SUBMITTED",
        submitted_by_staff_id: actorStaffId,
        submitted_by_user_id: BigInt(actorUserId),
        submitted_at: new Date()
      }
    });
  }

  createVarianceExceptions(transaction: TenantPrismaTransaction, tenantId: number, reconciliationId: bigint, tripId: bigint) {
    return transaction.$executeRaw(Prisma.sql`
      INSERT INTO pms.reconciliation_exception
        (tenant_id, reconciliation_id, exception_type, severity, trip_id,
         detected_source, description)
      SELECT ${BigInt(tenantId)}, ${reconciliationId}, 'STOCK_VARIANCE', 'WARNING', ${tripId},
             'RECONCILIATION_ENGINE', 'Stock variance reconciliation line ' || sr.trip_stock_recon_id
        FROM pms.trip_stock_reconciliation sr
       WHERE sr.tenant_id = ${BigInt(tenantId)}
         AND sr.reconciliation_id = ${reconciliationId}
         AND sr.variance_qty <> 0
         AND NOT EXISTS (
           SELECT 1 FROM pms.reconciliation_exception re
            WHERE re.tenant_id = sr.tenant_id
              AND re.reconciliation_id = sr.reconciliation_id
              AND re.exception_type = 'STOCK_VARIANCE'
              AND re.description = 'Stock variance reconciliation line ' || sr.trip_stock_recon_id
         )
      UNION ALL
      SELECT ${BigInt(tenantId)}, ${reconciliationId}, 'CASH_VARIANCE', 'WARNING', ${tripId},
             'RECONCILIATION_ENGINE', 'Cash variance reconciliation line ' || cr.trip_cash_recon_id
        FROM pms.trip_cash_reconciliation cr
       WHERE cr.tenant_id = ${BigInt(tenantId)}
         AND cr.reconciliation_id = ${reconciliationId}
         AND cr.variance_amount <> 0
         AND NOT EXISTS (
           SELECT 1 FROM pms.reconciliation_exception re
            WHERE re.tenant_id = cr.tenant_id
              AND re.reconciliation_id = cr.reconciliation_id
              AND re.exception_type = 'CASH_VARIANCE'
              AND re.description = 'Cash variance reconciliation line ' || cr.trip_cash_recon_id
         )
    `);
  }

  createInventoryVarianceAdjustment(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripId: bigint,
    actorUserId: number,
    line: {
      trip_stock_recon_id: bigint;
      inventory_location_id: bigint;
      product_id: bigint;
      inventory_state_id: bigint;
      variance_qty: Prisma.Decimal | null;
    }
  ) {
    const variance = line.variance_qty!.toNumber();
    return transaction.inventoryLedgerEntry.create({
      data: {
        tenantId: BigInt(tenantId),
        productId: line.product_id,
        from_location_id: variance < 0 ? line.inventory_location_id : undefined,
        to_location_id: variance > 0 ? line.inventory_location_id : undefined,
        from_state_id: variance < 0 ? line.inventory_state_id : undefined,
        to_state_id: variance > 0 ? line.inventory_state_id : undefined,
        quantity: Math.abs(variance),
        eventType: "ADJUSTMENT",
        tripId,
        reference_type: "STOCK_RECONCILIATION",
        reference_id: line.trip_stock_recon_id,
        occurredAt: new Date(),
        created_by_user_id: BigInt(actorUserId)
      },
      select: { inventoryLedgerId: true }
    });
  }

  approveStockLine(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    lineId: bigint,
    actorUserId: number,
    ledgerId: bigint
  ) {
    return transaction.trip_stock_reconciliation.update({
      where: { tenant_id_trip_stock_recon_id: { tenant_id: BigInt(tenantId), trip_stock_recon_id: lineId } },
      data: {
        approval_status: "APPROVED",
        approved_by_user_id: BigInt(actorUserId),
        approved_at: new Date(),
        adjustment_inventory_ledger_id: ledgerId
      }
    });
  }

  createCashVarianceAdjustment(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripId: bigint,
    actorUserId: number,
    line: { trip_cash_recon_id: bigint; staff_id: bigint; variance_amount: Prisma.Decimal | null }
  ) {
    const variance = line.variance_amount!.toNumber();
    return transaction.moneyLedgerEntry.create({
      data: {
        tenantId: BigInt(tenantId),
        staffId: line.staff_id,
        amount: Math.abs(variance),
        direction: variance > 0 ? "IN" : "OUT",
        transactionType: "ADJUSTMENT",
        account_type: "STAFF_CASH",
        tripId,
        reference_type: "CASH_RECONCILIATION",
        reference_id: line.trip_cash_recon_id,
        occurredAt: new Date(),
        created_by_user_id: BigInt(actorUserId)
      },
      select: { moneyLedgerId: true }
    });
  }

  approveCashLine(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    lineId: bigint,
    actorUserId: number,
    ledgerId: bigint
  ) {
    return transaction.trip_cash_reconciliation.update({
      where: { tenant_id_trip_cash_recon_id: { tenant_id: BigInt(tenantId), trip_cash_recon_id: lineId } },
      data: {
        approval_status: "APPROVED",
        approved_by_user_id: BigInt(actorUserId),
        approved_at: new Date(),
        adjustment_money_ledger_id: ledgerId
      }
    });
  }

  resolveVarianceExceptions(transaction: TenantPrismaTransaction, tenantId: number, reconciliationId: bigint, actorUserId: number) {
    return transaction.reconciliation_exception.updateMany({
      where: {
        tenant_id: BigInt(tenantId),
        reconciliation_id: reconciliationId,
        exception_type: { in: ["STOCK_VARIANCE", "CASH_VARIANCE"] },
        status: { in: ["OPEN", "UNDER_REVIEW"] }
      },
      data: {
        status: "RESOLVED",
        resolved_by_user_id: BigInt(actorUserId),
        resolved_at: new Date(),
        resolution_notes: "Variance adjustment approved"
      }
    });
  }

  approveHeader(transaction: TenantPrismaTransaction, tenantId: number, reconciliationId: bigint, actorUserId: number) {
    return transaction.trip_reconciliation.update({
      where: { tenant_id_reconciliation_id: { tenant_id: BigInt(tenantId), reconciliation_id: reconciliationId } },
      data: { status: "APPROVED", approved_by_user_id: BigInt(actorUserId), approved_at: new Date() }
    });
  }

  reconcileTrip(transaction: TenantPrismaTransaction, tenantId: number, tripId: bigint) {
    return transaction.trip.update({
      where: { tenantId_tripId: { tenantId: BigInt(tenantId), tripId } },
      data: { status: "RECONCILED", reconciled_at: new Date() },
      select: { tripId: true, tripNumber: true, status: true, reconciled_at: true }
    });
  }

  findTargetAdmin(transaction: TenantPrismaTransaction, tenantId: number, userId: number) {
    return transaction.appUser.findFirst({
      where: {
        tenantId: BigInt(tenantId),
        userId: BigInt(userId),
        status: "ACTIVE",
        user_role_user_role_tenant_id_user_idToapp_user: {
          some: { role: { role_code: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" } }
        }
      },
      select: { userId: true }
    });
  }

  async pendingHandoverAmount(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripId: bigint,
    staffId: bigint
  ): Promise<number> {
    const result = await transaction.cash_handover.aggregate({
      where: {
        tenant_id: BigInt(tenantId),
        trip_id: tripId,
        from_staff_id: staffId,
        status: "SUBMITTED"
      },
      _sum: { amount: true }
    });
    return result._sum.amount?.toNumber() ?? 0;
  }

  createCashHandover(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripId: bigint,
    reconciliationId: bigint | undefined,
    staffId: bigint,
    toUserId: number,
    amount: number
  ) {
    return transaction.cash_handover.create({
      data: {
        tenant_id: BigInt(tenantId),
        trip_id: tripId,
        reconciliation_id: reconciliationId,
        from_staff_id: staffId,
        to_user_id: BigInt(toUserId),
        amount,
        submitted_by_staff_id: staffId
      },
      select: {
        cash_handover_id: true,
        trip_id: true,
        reconciliation_id: true,
        from_staff_id: true,
        to_user_id: true,
        amount: true,
        status: true,
        money_ledger_id: true,
        submitted_at: true,
        confirmed_at: true,
        disputed_at: true,
        dispute_reason: true
      }
    });
  }

  findCashHandover(transaction: TenantPrismaTransaction, tenantId: number, cashHandoverId: number) {
    return transaction.cash_handover.findFirst({
      where: { tenant_id: BigInt(tenantId), cash_handover_id: BigInt(cashHandoverId) },
      select: {
        cash_handover_id: true,
        trip_id: true,
        reconciliation_id: true,
        from_staff_id: true,
        to_user_id: true,
        amount: true,
        status: true,
        money_ledger_id: true,
        submitted_at: true,
        confirmed_at: true,
        disputed_at: true,
        dispute_reason: true
      }
    });
  }

  confirmCashHandover(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    actorUserId: number,
    handover: { cash_handover_id: bigint; trip_id: bigint | null; from_staff_id: bigint; amount: Prisma.Decimal }
  ) {
    return transaction.moneyLedgerEntry.create({
      data: {
        tenantId: BigInt(tenantId),
        staffId: handover.from_staff_id,
        amount: handover.amount,
        direction: "OUT",
        transactionType: "STAFF_CASH_HANDOVER",
        payment_method: "CASH",
        account_type: "STAFF_CASH",
        tripId: handover.trip_id,
        reference_type: "CASH_HANDOVER",
        reference_id: handover.cash_handover_id,
        occurredAt: new Date(),
        created_by_user_id: BigInt(actorUserId)
      },
      select: { moneyLedgerId: true }
    });
  }

  updateCashHandover(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    cashHandoverId: bigint,
    data: { status: "CONFIRMED"; confirmedByUserId: number; moneyLedgerId: bigint } |
      { status: "DISPUTED"; confirmedByUserId: number; disputeReason: string }
  ) {
    return transaction.cash_handover.update({
      where: {
        tenant_id_cash_handover_id: { tenant_id: BigInt(tenantId), cash_handover_id: cashHandoverId }
      },
      data: data.status === "CONFIRMED" ? {
        status: data.status,
        confirmed_by_user_id: BigInt(data.confirmedByUserId),
        confirmed_at: new Date(),
        money_ledger_id: data.moneyLedgerId
      } : {
        status: data.status,
        confirmed_by_user_id: BigInt(data.confirmedByUserId),
        disputed_at: new Date(),
        dispute_reason: data.disputeReason
      },
      select: {
        cash_handover_id: true,
        trip_id: true,
        reconciliation_id: true,
        from_staff_id: true,
        to_user_id: true,
        amount: true,
        status: true,
        money_ledger_id: true,
        submitted_at: true,
        confirmed_at: true,
        disputed_at: true,
        dispute_reason: true
      }
    });
  }

  findPostAdjustment(transaction: TenantPrismaTransaction, tenantId: number, adjustmentId: number) {
    return transaction.post_reconciliation_adjustment.findFirst({
      where: { tenant_id: BigInt(tenantId), post_recon_adjustment_id: BigInt(adjustmentId) },
      select: {
        post_recon_adjustment_id: true,
        reconciliation_id: true,
        trip_id: true,
        reconciliation_exception_id: true,
        adjustment_type: true,
        approval_status: true,
        stop_event_id: true,
        stop_event: {
          select: {
            stopEventId: true,
            tripId: true,
            tripStopId: true,
            partyId: true,
            eventTime: true,
            trip: { select: { vehicleId: true } },
            stop_event_product: {
              select: {
                product_id: true,
                full_qty_delivered: true,
                empty_qty_received_good: true,
                empty_qty_received_damaged: true,
                line_charge_amount: true,
                damage_charge_amount: true,
                exchange_exception: { select: { resolution: true } }
              }
            }
          }
        }
      }
    });
  }

  findVehicleLocation(transaction: TenantPrismaTransaction, tenantId: number, vehicleId: bigint) {
    return transaction.inventory_location.findFirst({
      where: { tenant_id: BigInt(tenantId), vehicle_id: vehicleId, location_type: "VEHICLE", status: "ACTIVE" },
      select: { inventory_location_id: true }
    });
  }

  findStates(transaction: TenantPrismaTransaction) {
    return transaction.inventory_state.findMany({
      where: { code: { in: ["FULL", "EMPTY", "DAMAGED"] } },
      select: { inventory_state_id: true, code: true }
    });
  }

  createLateInventoryAdjustment(
    transaction: TenantPrismaTransaction,
    input: {
      tenantId: number;
      adjustmentId: bigint;
      productId: bigint;
      fromLocationId?: bigint;
      toLocationId?: bigint;
      fromStateId?: bigint;
      toStateId?: bigint;
      quantity: number;
      tripId: bigint;
      tripStopId: bigint;
      stopEventId: bigint;
      eventTime: Date;
      actorUserId: number;
    }
  ) {
    return transaction.inventoryLedgerEntry.create({
      data: {
        tenantId: BigInt(input.tenantId),
        productId: input.productId,
        from_location_id: input.fromLocationId,
        to_location_id: input.toLocationId,
        from_state_id: input.fromStateId,
        to_state_id: input.toStateId,
        quantity: input.quantity,
        eventType: "ADJUSTMENT",
        tripId: input.tripId,
        trip_stop_id: input.tripStopId,
        stopEventId: input.stopEventId,
        reference_type: "POST_RECON_ADJUSTMENT",
        reference_id: input.adjustmentId,
        occurredAt: input.eventTime,
        created_by_user_id: BigInt(input.actorUserId)
      },
      select: { inventoryLedgerId: true }
    });
  }

  createLateMoneyAdjustment(
    transaction: TenantPrismaTransaction,
    input: {
      tenantId: number;
      adjustmentId: bigint;
      partyId: bigint;
      amount: number;
      tripId: bigint;
      tripStopId: bigint;
      stopEventId: bigint;
      eventTime: Date;
      actorUserId: number;
    }
  ) {
    return transaction.moneyLedgerEntry.create({
      data: {
        tenantId: BigInt(input.tenantId),
        partyId: input.partyId,
        amount: input.amount,
        direction: "IN",
        transactionType: "ADJUSTMENT",
        account_type: "CUSTOMER_RECEIVABLE",
        tripId: input.tripId,
        trip_stop_id: input.tripStopId,
        stopEventId: input.stopEventId,
        reference_type: "POST_RECON_ADJUSTMENT",
        reference_id: input.adjustmentId,
        occurredAt: input.eventTime,
        created_by_user_id: BigInt(input.actorUserId)
      },
      select: { moneyLedgerId: true }
    });
  }

  approvePostAdjustment(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    adjustmentId: bigint,
    actorUserId: number,
    firstInventoryLedgerId?: bigint,
    firstMoneyLedgerId?: bigint
  ) {
    return transaction.post_reconciliation_adjustment.update({
      where: {
        tenant_id_post_recon_adjustment_id: {
          tenant_id: BigInt(tenantId),
          post_recon_adjustment_id: adjustmentId
        }
      },
      data: {
        approval_status: "APPROVED",
        approved_by_user_id: BigInt(actorUserId),
        approved_at: new Date(),
        inventory_ledger_id: firstInventoryLedgerId,
        money_ledger_id: firstMoneyLedgerId
      }
    });
  }

  resolveException(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    exceptionId: bigint,
    actorUserId: number,
    notes: string
  ) {
    return transaction.reconciliation_exception.update({
      where: {
        tenant_id_reconciliation_exception_id: {
          tenant_id: BigInt(tenantId),
          reconciliation_exception_id: exceptionId
        }
      },
      data: {
        status: "RESOLVED",
        resolved_by_user_id: BigInt(actorUserId),
        resolved_at: new Date(),
        resolution_notes: notes
      },
      select: {
        reconciliation_exception_id: true,
        status: true,
        resolved_at: true,
        resolution_notes: true
      }
    });
  }

  findException(transaction: TenantPrismaTransaction, tenantId: number, exceptionId: number) {
    return transaction.reconciliation_exception.findFirst({
      where: { tenant_id: BigInt(tenantId), reconciliation_exception_id: BigInt(exceptionId) },
      select: {
        reconciliation_exception_id: true,
        status: true,
        post_reconciliation_adjustment: { select: { approval_status: true } }
      }
    });
  }
}
