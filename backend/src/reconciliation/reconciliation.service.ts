import { HttpStatus, Injectable } from "@nestjs/common";
import { ADMIN_ROLE, OWNER_ROLE } from "../auth/roles.js";
import { ApiError } from "../http/api-error.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";
import type { CreateCashHandoverDto } from "./dto/cash-handover.dto.js";
import type {
  CreateReconciliationDto,
  SubmitCashCountDto,
  SubmitStockCountDto
} from "./dto/reconciliation.dto.js";
import { ReconciliationRepository } from "./reconciliation.repository.js";

type ReconciliationRecord = NonNullable<Awaited<ReturnType<ReconciliationRepository["findReconciliation"]>>>;
type CashHandoverRecord = NonNullable<Awaited<ReturnType<ReconciliationRepository["findCashHandover"]>>>;

const administrative = (context: AuthenticatedTenantContext): boolean =>
  context.roles.includes(OWNER_ROLE) || context.roles.includes(ADMIN_ROLE);

function mapReconciliation(record: ReconciliationRecord) {
  return {
    reconciliationId: record.reconciliation_id.toString(),
    tripId: record.trip_id.toString(),
    reconciliationNumber: record.reconciliation_number,
    status: record.status,
    notes: record.notes,
    startedAt: record.started_at.toISOString(),
    submittedAt: record.submitted_at?.toISOString() ?? null,
    approvedAt: record.approved_at?.toISOString() ?? null,
    stock: record.trip_stock_reconciliation.map((line) => ({
      tripStockReconciliationId: line.trip_stock_recon_id.toString(),
      inventoryLocationId: line.inventory_location_id.toString(),
      productId: line.product_id.toString(),
      inventoryStateId: line.inventory_state_id.toString(),
      expectedQty: line.expected_qty.toString(),
      actualQty: line.actual_qty.toString(),
      varianceQty: line.variance_qty?.toString() ?? null,
      varianceReasonCode: line.variance_reason_code,
      varianceNotes: line.variance_notes,
      approvalStatus: line.approval_status,
      adjustmentInventoryLedgerId: line.adjustment_inventory_ledger_id?.toString() ?? null
    })),
    cash: record.trip_cash_reconciliation.map((line) => ({
      tripCashReconciliationId: line.trip_cash_recon_id.toString(),
      staffId: line.staff_id.toString(),
      expectedCash: line.expected_cash.toString(),
      actualCash: line.actual_cash.toString(),
      varianceAmount: line.variance_amount?.toString() ?? null,
      varianceReasonCode: line.variance_reason_code,
      varianceNotes: line.variance_notes,
      approvalStatus: line.approval_status,
      adjustmentMoneyLedgerId: line.adjustment_money_ledger_id?.toString() ?? null
    })),
    exceptions: record.reconciliation_exception.map((exception) => ({
      reconciliationExceptionId: exception.reconciliation_exception_id.toString(),
      type: exception.exception_type,
      severity: exception.severity,
      tripStopId: exception.trip_stop_id?.toString() ?? null,
      stopEventId: exception.stop_event_id?.toString() ?? null,
      detectedSource: exception.detected_source,
      description: exception.description,
      status: exception.status,
      resolutionNotes: exception.resolution_notes,
      detectedAt: exception.detected_at.toISOString()
    })),
    adjustments: record.post_reconciliation_adjustment.map((adjustment) => ({
      adjustmentId: adjustment.post_recon_adjustment_id.toString(),
      reconciliationExceptionId: adjustment.reconciliation_exception_id?.toString() ?? null,
      adjustmentType: adjustment.adjustment_type,
      reasonCode: adjustment.reason_code,
      reasonNotes: adjustment.reason_notes,
      approvalStatus: adjustment.approval_status,
      inventoryLedgerId: adjustment.inventory_ledger_id?.toString() ?? null,
      moneyLedgerId: adjustment.money_ledger_id?.toString() ?? null,
      stopEventId: adjustment.stop_event_id?.toString() ?? null,
      requestedAt: adjustment.requested_at.toISOString(),
      approvedAt: adjustment.approved_at?.toISOString() ?? null
    }))
  };
}

function mapHandover(handover: CashHandoverRecord) {
  return {
    cashHandoverId: handover.cash_handover_id.toString(),
    tripId: handover.trip_id?.toString() ?? null,
    reconciliationId: handover.reconciliation_id?.toString() ?? null,
    fromStaffId: handover.from_staff_id.toString(),
    toUserId: handover.to_user_id.toString(),
    amount: handover.amount.toString(),
    status: handover.status,
    moneyLedgerId: handover.money_ledger_id?.toString() ?? null,
    submittedAt: handover.submitted_at.toISOString(),
    confirmedAt: handover.confirmed_at?.toISOString() ?? null,
    disputedAt: handover.disputed_at?.toISOString() ?? null,
    disputeReason: handover.dispute_reason
  };
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly transactions: PrismaTenantTransactionService,
    private readonly repository: ReconciliationRepository
  ) {}

  completeTrip(context: AuthenticatedTenantContext, tripId: number) {
    return this.transactions.run(context, async (transaction) => {
      await this.repository.lock(transaction, `trip-close:${context.tenantId}:${tripId}`);
      const trip = await this.repository.findTrip(transaction, context.tenantId, tripId);
      if (trip === null) throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_NOT_FOUND", "The trip was not found");
      if (trip.status !== "IN_PROGRESS") {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_TRIP_STATUS", "Only an in-progress trip may be completed");
      }
      const terminal = new Set(["COMPLETED", "PARTIAL", "SKIPPED", "NOT_AVAILABLE", "FAILED", "RESCHEDULED", "CANCELLED"]);
      const unresolved = trip.trip_stop.filter((stop) => !terminal.has(stop.status));
      if (unresolved.length > 0) {
        throw new ApiError(HttpStatus.CONFLICT, "UNRESOLVED_TRIP_STOPS", "Every trip stop must be explicitly handled", {
          tripStopIds: unresolved.map((stop) => stop.trip_stop_id.toString())
        });
      }
      const completed = await this.repository.completeTrip(transaction, context.tenantId, trip.tripId);
      return {
        tripId: completed.tripId.toString(),
        tripNumber: completed.tripNumber,
        status: completed.status,
        completedAt: completed.completed_at?.toISOString() ?? null
      };
    });
  }

  createReconciliation(context: AuthenticatedTenantContext, tripId: number, input: CreateReconciliationDto) {
    return this.transactions.run(context, async (transaction) => {
      await this.repository.lock(transaction, `reconciliation-trip:${context.tenantId}:${tripId}`);
      const trip = await this.repository.findTrip(transaction, context.tenantId, tripId);
      if (trip === null) throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_NOT_FOUND", "The trip was not found");
      if (trip.status !== "COMPLETED") {
        throw new ApiError(HttpStatus.CONFLICT, "TRIP_NOT_COMPLETED", "Reconciliation requires a completed trip");
      }
      if (trip.trip_reconciliation !== null) {
        throw new ApiError(HttpStatus.CONFLICT, "RECONCILIATION_ALREADY_EXISTS", "The trip already has a reconciliation");
      }
      const created = await this.repository.createReconciliation(
        transaction,
        context.tenantId,
        trip.tripId,
        `RECON-${trip.tripNumber}`,
        input.notes
      );
      const [record, expectedStock, expectedCash] = await Promise.all([
        this.repository.findReconciliation(transaction, context.tenantId, created.reconciliation_id),
        this.repository.expectedStockSnapshot(transaction, context.tenantId, trip.vehicleId),
        this.repository.expectedCashSnapshot(transaction, context.tenantId, trip.tripId)
      ]);
      if (expectedStock.some((line) => line.expected_qty.isNegative())) {
        throw new ApiError(HttpStatus.CONFLICT, "NEGATIVE_DERIVED_STOCK", "Ledger-derived stock cannot be reconciled as a non-negative physical count");
      }
      if (expectedCash.some((line) => line.expected_cash.isNegative())) {
        throw new ApiError(HttpStatus.CONFLICT, "NEGATIVE_DERIVED_CASH", "Ledger-derived staff cash cannot be reconciled as a non-negative physical count");
      }
      return {
        ...mapReconciliation(record!),
        expectedStock: expectedStock.map((line) => ({
          inventoryLocationId: line.inventory_location_id.toString(),
          productId: line.product_id.toString(),
          inventoryStateId: line.inventory_state_id.toString(),
          expectedQty: line.expected_qty.toString()
        })),
        expectedCash: expectedCash.map((line) => ({
          staffId: line.staff_id.toString(),
          expectedCash: line.expected_cash.toString()
        }))
      };
    });
  }

  getReconciliation(context: AuthenticatedTenantContext, reconciliationId: number) {
    return this.transactions.run(context, async (transaction) => {
      const record = await this.repository.findReconciliation(transaction, context.tenantId, reconciliationId);
      if (record === null) throw new ApiError(HttpStatus.NOT_FOUND, "RECONCILIATION_NOT_FOUND", "The reconciliation was not found");
      return mapReconciliation(record);
    });
  }

  submitStock(context: AuthenticatedTenantContext, reconciliationId: number, input: SubmitStockCountDto) {
    return this.transactions.run(context, async (transaction) => {
      await this.repository.lock(transaction, `reconciliation:${context.tenantId}:${reconciliationId}`);
      const source = await this.repository.findStockDimension(
        transaction,
        context.tenantId,
        reconciliationId,
        input.inventoryLocationId,
        input.productId,
        input.inventoryStateId
      );
      if (source === null) throw new ApiError(HttpStatus.NOT_FOUND, "RECONCILIATION_NOT_FOUND", "The reconciliation was not found");
      if (!new Set(["OPEN", "REOPENED"]).has(source.status)) {
        throw new ApiError(HttpStatus.CONFLICT, "RECONCILIATION_NOT_EDITABLE", "The reconciliation is not editable");
      }
      const [location, product, state] = await this.repository.findLocationProductState(
        transaction,
        context.tenantId,
        input.inventoryLocationId,
        input.productId,
        input.inventoryStateId
      );
      if (location === null || product === null || state === null) {
        throw new ApiError(HttpStatus.NOT_FOUND, "STOCK_DIMENSION_NOT_FOUND", "The stock dimension was not found in this tenant");
      }
      if (source.trip.vehicleId === null || location.vehicle_id !== source.trip.vehicleId) {
        throw new ApiError(HttpStatus.BAD_REQUEST, "INVALID_RECONCILIATION_LOCATION", "Stock counts must target the trip vehicle location");
      }
      const expectedQty = await this.repository.expectedStock(
        transaction,
        context.tenantId,
        input.inventoryLocationId,
        input.productId,
        input.inventoryStateId
      );
      if (expectedQty < 0) {
        throw new ApiError(HttpStatus.CONFLICT, "NEGATIVE_DERIVED_STOCK", "Ledger-derived stock cannot be reconciled as a non-negative physical count");
      }
      if (Math.abs(input.actualQty - expectedQty) >= 0.0005 && input.varianceReasonCode === undefined) {
        throw new ApiError(HttpStatus.BAD_REQUEST, "STOCK_VARIANCE_REASON_REQUIRED", "A non-zero stock variance requires a reason");
      }
      const actorStaff = await this.repository.findActorStaff(transaction, context.tenantId, context.userId);
      const line = await this.repository.upsertStock(
        transaction,
        context.tenantId,
        reconciliationId,
        context.userId,
        actorStaff?.staff_id,
        { ...input, expectedQty }
      );
      return {
        tripStockReconciliationId: line.trip_stock_recon_id.toString(),
        expectedQty: line.expected_qty.toString(),
        actualQty: line.actual_qty.toString(),
        varianceQty: line.variance_qty?.toString() ?? null,
        approvalStatus: line.approval_status
      };
    });
  }

  submitCash(context: AuthenticatedTenantContext, reconciliationId: number, input: SubmitCashCountDto) {
    return this.transactions.run(context, async (transaction) => {
      await this.repository.lock(transaction, `reconciliation:${context.tenantId}:${reconciliationId}`);
      const source = await this.repository.findCashSource(transaction, context.tenantId, reconciliationId, input.staffId);
      if (source === null) throw new ApiError(HttpStatus.NOT_FOUND, "RECONCILIATION_NOT_FOUND", "The reconciliation was not found");
      if (!new Set(["OPEN", "REOPENED"]).has(source.status)) {
        throw new ApiError(HttpStatus.CONFLICT, "RECONCILIATION_NOT_EDITABLE", "The reconciliation is not editable");
      }
      if (source.trip.primaryStaffId !== BigInt(input.staffId) && source.trip.trip_staff.length === 0) {
        throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_STAFF_NOT_FOUND", "The staff member is not assigned to this trip");
      }
      const actorStaff = await this.repository.findActorStaff(transaction, context.tenantId, context.userId);
      if (!administrative(context) && actorStaff?.staff_id !== BigInt(input.staffId)) {
        throw new ApiError(HttpStatus.FORBIDDEN, "CASH_COUNT_STAFF_MISMATCH", "Staff may submit only their own actual cash");
      }
      const expectedCash = await this.repository.expectedCash(
        transaction,
        context.tenantId,
        source.trip.tripId,
        input.staffId
      );
      if (expectedCash < 0) {
        throw new ApiError(HttpStatus.CONFLICT, "NEGATIVE_DERIVED_CASH", "Ledger-derived staff cash cannot be reconciled as a non-negative physical count");
      }
      if (Math.abs(input.actualCash - expectedCash) >= 0.005 && input.varianceReasonCode === undefined) {
        throw new ApiError(HttpStatus.BAD_REQUEST, "CASH_VARIANCE_REASON_REQUIRED", "A non-zero cash variance requires a reason");
      }
      const line = await this.repository.upsertCash(
        transaction,
        context.tenantId,
        reconciliationId,
        context.userId,
        actorStaff?.staff_id,
        { ...input, expectedCash }
      );
      return {
        tripCashReconciliationId: line.trip_cash_recon_id.toString(),
        expectedCash: line.expected_cash.toString(),
        actualCash: line.actual_cash.toString(),
        varianceAmount: line.variance_amount?.toString() ?? null,
        approvalStatus: line.approval_status
      };
    });
  }

  submitReconciliation(context: AuthenticatedTenantContext, reconciliationId: number) {
    return this.transactions.run(context, async (transaction) => {
      await this.repository.lock(transaction, `reconciliation:${context.tenantId}:${reconciliationId}`);
      const record = await this.repository.findReconciliation(transaction, context.tenantId, reconciliationId);
      if (record === null) throw new ApiError(HttpStatus.NOT_FOUND, "RECONCILIATION_NOT_FOUND", "The reconciliation was not found");
      if (!new Set(["OPEN", "REOPENED"]).has(record.status)) {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_RECONCILIATION_STATUS", "Only an open or reopened reconciliation may be submitted");
      }
      if (record.trip_stock_reconciliation.length + record.trip_cash_reconciliation.length === 0) {
        throw new ApiError(HttpStatus.CONFLICT, "RECONCILIATION_COUNTS_REQUIRED", "At least one stock or cash count is required");
      }
      const actorStaff = await this.repository.findActorStaff(transaction, context.tenantId, context.userId);
      await this.repository.createVarianceExceptions(
        transaction,
        context.tenantId,
        record.reconciliation_id,
        record.trip_id
      );
      await this.repository.submitReconciliation(
        transaction,
        context.tenantId,
        record.reconciliation_id,
        context.userId,
        actorStaff?.staff_id
      );
      return mapReconciliation((await this.repository.findReconciliation(
        transaction, context.tenantId, reconciliationId
      ))!);
    });
  }

  approveReconciliation(context: AuthenticatedTenantContext, reconciliationId: number) {
    return this.transactions.run(context, async (transaction) => {
      await this.repository.lock(transaction, `reconciliation:${context.tenantId}:${reconciliationId}`);
      const record = await this.repository.findReconciliation(transaction, context.tenantId, reconciliationId);
      if (record === null) throw new ApiError(HttpStatus.NOT_FOUND, "RECONCILIATION_NOT_FOUND", "The reconciliation was not found");
      if (record.status !== "SUBMITTED") {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_RECONCILIATION_STATUS", "Only a submitted reconciliation may be approved");
      }
      if (record.reconciliation_exception.some((exception) =>
        exception.severity === "CRITICAL" && new Set(["OPEN", "UNDER_REVIEW"]).has(exception.status)
      )) {
        throw new ApiError(HttpStatus.CONFLICT, "CRITICAL_RECONCILIATION_EXCEPTION", "Critical reconciliation exceptions must be resolved first");
      }
      const actorStaff = await this.repository.findActorStaff(transaction, context.tenantId, context.userId);
      for (const line of record.trip_stock_reconciliation) {
        const variance = line.variance_qty?.toNumber() ?? 0;
        if (Math.abs(variance) < 0.0005) continue;
        if (actorStaff?.staff_id === line.counted_by_staff_id) {
          throw new ApiError(HttpStatus.FORBIDDEN, "SELF_VARIANCE_APPROVAL_NOT_ALLOWED", "Staff cannot approve their own stock variance");
        }
        const ledger = await this.repository.createInventoryVarianceAdjustment(
          transaction, context.tenantId, record.trip_id, context.userId, line
        );
        await this.repository.approveStockLine(
          transaction, context.tenantId, line.trip_stock_recon_id, context.userId, ledger.inventoryLedgerId
        );
      }
      for (const line of record.trip_cash_reconciliation) {
        const variance = line.variance_amount?.toNumber() ?? 0;
        if (Math.abs(variance) < 0.005) continue;
        if (actorStaff?.staff_id === line.submitted_by_staff_id) {
          throw new ApiError(HttpStatus.FORBIDDEN, "SELF_VARIANCE_APPROVAL_NOT_ALLOWED", "Staff cannot approve their own cash variance");
        }
        const ledger = await this.repository.createCashVarianceAdjustment(
          transaction, context.tenantId, record.trip_id, context.userId, line
        );
        await this.repository.approveCashLine(
          transaction, context.tenantId, line.trip_cash_recon_id, context.userId, ledger.moneyLedgerId
        );
      }
      await this.repository.resolveVarianceExceptions(
        transaction, context.tenantId, record.reconciliation_id, context.userId
      );
      await this.repository.approveHeader(
        transaction, context.tenantId, record.reconciliation_id, context.userId
      );
      return mapReconciliation((await this.repository.findReconciliation(
        transaction, context.tenantId, reconciliationId
      ))!);
    });
  }

  reconcileTrip(context: AuthenticatedTenantContext, tripId: number) {
    return this.transactions.run(context, async (transaction) => {
      await this.repository.lock(transaction, `trip-close:${context.tenantId}:${tripId}`);
      const trip = await this.repository.findTrip(transaction, context.tenantId, tripId);
      if (trip === null) throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_NOT_FOUND", "The trip was not found");
      if (trip.status !== "COMPLETED") {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_TRIP_STATUS", "Only a completed trip may be reconciled");
      }
      if (trip.trip_reconciliation?.status !== "APPROVED") {
        throw new ApiError(HttpStatus.CONFLICT, "RECONCILIATION_NOT_APPROVED", "The trip reconciliation is not approved");
      }
      const record = await this.repository.findReconciliation(
        transaction, context.tenantId, trip.trip_reconciliation.reconciliation_id
      );
      if (record!.reconciliation_exception.some((exception) => new Set(["OPEN", "UNDER_REVIEW"]).has(exception.status))) {
        throw new ApiError(HttpStatus.CONFLICT, "OPEN_RECONCILIATION_EXCEPTION", "All reconciliation exceptions must be resolved");
      }
      const reconciled = await this.repository.reconcileTrip(transaction, context.tenantId, trip.tripId);
      return {
        tripId: reconciled.tripId.toString(),
        tripNumber: reconciled.tripNumber,
        status: reconciled.status,
        reconciledAt: reconciled.reconciled_at?.toISOString() ?? null
      };
    });
  }

  createCashHandover(context: AuthenticatedTenantContext, tripId: number, input: CreateCashHandoverDto) {
    return this.transactions.run(context, async (transaction) => {
      await this.repository.lock(transaction, `cash-handover:${context.tenantId}:${tripId}`);
      const [trip, actorStaff, target] = await Promise.all([
        this.repository.findTrip(transaction, context.tenantId, tripId),
        this.repository.findActorStaff(transaction, context.tenantId, context.userId),
        this.repository.findTargetAdmin(transaction, context.tenantId, input.toUserId)
      ]);
      if (trip === null) throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_NOT_FOUND", "The trip was not found");
      if (trip.status !== "COMPLETED") {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_TRIP_STATUS", "Cash handover requires a completed trip");
      }
      if (actorStaff === null) {
        throw new ApiError(HttpStatus.FORBIDDEN, "STAFF_LOGIN_REQUIRED", "Cash handover requires an active linked staff identity");
      }
      if (target === null) throw new ApiError(HttpStatus.NOT_FOUND, "HANDOVER_RECIPIENT_NOT_FOUND", "The Owner/Admin recipient was not found");
      if (trip.primaryStaffId !== actorStaff.staff_id && !trip.trip_staff.some((assignment) => assignment.staff_id === actorStaff.staff_id)) {
        throw new ApiError(HttpStatus.FORBIDDEN, "STAFF_NOT_ASSIGNED_TO_TRIP", "The staff member is not assigned to this trip");
      }
      const expected = await this.repository.expectedCash(
        transaction, context.tenantId, trip.tripId, Number(actorStaff.staff_id)
      );
      const reserved = await this.repository.pendingHandoverAmount(
        transaction, context.tenantId, trip.tripId, actorStaff.staff_id
      );
      if (input.amount > expected - reserved) {
        throw new ApiError(HttpStatus.CONFLICT, "HANDOVER_EXCEEDS_STAFF_CASH", "The handover exceeds derived available staff cash", {
          availableAmount: Math.max(expected - reserved, 0)
        });
      }
      return mapHandover(await this.repository.createCashHandover(
        transaction,
        context.tenantId,
        trip.tripId,
        trip.trip_reconciliation?.reconciliation_id,
        actorStaff.staff_id,
        input.toUserId,
        input.amount
      ));
    });
  }

  confirmCashHandover(context: AuthenticatedTenantContext, cashHandoverId: number) {
    return this.transactions.run(context, async (transaction) => {
      await this.repository.lock(transaction, `cash-handover:${context.tenantId}:${cashHandoverId}`);
      const handover = await this.repository.findCashHandover(transaction, context.tenantId, cashHandoverId);
      if (handover === null) throw new ApiError(HttpStatus.NOT_FOUND, "CASH_HANDOVER_NOT_FOUND", "The cash handover was not found");
      if (!new Set(["SUBMITTED", "DISPUTED"]).has(handover.status)) {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_CASH_HANDOVER_STATUS", "The cash handover cannot be confirmed");
      }
      const ledger = await this.repository.confirmCashHandover(
        transaction, context.tenantId, context.userId, handover
      );
      return mapHandover(await this.repository.updateCashHandover(
        transaction,
        context.tenantId,
        handover.cash_handover_id,
        { status: "CONFIRMED", confirmedByUserId: context.userId, moneyLedgerId: ledger.moneyLedgerId }
      ));
    });
  }

  disputeCashHandover(context: AuthenticatedTenantContext, cashHandoverId: number, reason: string) {
    return this.transactions.run(context, async (transaction) => {
      await this.repository.lock(transaction, `cash-handover:${context.tenantId}:${cashHandoverId}`);
      const handover = await this.repository.findCashHandover(transaction, context.tenantId, cashHandoverId);
      if (handover === null) throw new ApiError(HttpStatus.NOT_FOUND, "CASH_HANDOVER_NOT_FOUND", "The cash handover was not found");
      if (handover.status !== "SUBMITTED") {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_CASH_HANDOVER_STATUS", "Only a submitted handover may be disputed");
      }
      return mapHandover(await this.repository.updateCashHandover(
        transaction,
        context.tenantId,
        handover.cash_handover_id,
        { status: "DISPUTED", confirmedByUserId: context.userId, disputeReason: reason }
      ));
    });
  }

  approvePostReconciliationAdjustment(context: AuthenticatedTenantContext, adjustmentId: number) {
    return this.transactions.run(context, async (transaction) => {
      await this.repository.lock(transaction, `post-reconciliation-adjustment:${context.tenantId}:${adjustmentId}`);
      const adjustment = await this.repository.findPostAdjustment(transaction, context.tenantId, adjustmentId);
      if (adjustment === null) throw new ApiError(HttpStatus.NOT_FOUND, "POST_RECONCILIATION_ADJUSTMENT_NOT_FOUND", "The adjustment was not found");
      if (adjustment.approval_status !== "PENDING" || adjustment.stop_event === null) {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_POST_RECONCILIATION_ADJUSTMENT", "The adjustment is not pending or has no quarantined event");
      }
      if (adjustment.stop_event.trip.vehicleId === null) {
        throw new ApiError(HttpStatus.CONFLICT, "TRIP_VEHICLE_REQUIRED", "The late event trip has no vehicle");
      }
      const [location, stateRows] = await Promise.all([
        this.repository.findVehicleLocation(transaction, context.tenantId, adjustment.stop_event.trip.vehicleId),
        this.repository.findStates(transaction)
      ]);
      if (location === null) throw new ApiError(HttpStatus.CONFLICT, "VEHICLE_INVENTORY_LOCATION_REQUIRED", "The trip vehicle has no inventory location");
      const states = Object.fromEntries(stateRows.map((state) => [state.code, state.inventory_state_id]));
      let firstInventoryLedgerId: bigint | undefined;
      let firstMoneyLedgerId: bigint | undefined;
      for (const product of adjustment.stop_event.stop_event_product) {
        const base = {
          tenantId: context.tenantId,
          adjustmentId: adjustment.post_recon_adjustment_id,
          productId: product.product_id,
          tripId: adjustment.stop_event.tripId,
          tripStopId: adjustment.stop_event.tripStopId,
          stopEventId: adjustment.stop_event.stopEventId,
          eventTime: adjustment.stop_event.eventTime,
          actorUserId: context.userId
        };
        for (const movement of [
          product.full_qty_delivered.toNumber() > 0 ? {
            fromLocationId: location.inventory_location_id,
            fromStateId: states.FULL,
            quantity: product.full_qty_delivered.toNumber()
          } : null,
          product.empty_qty_received_good.toNumber() > 0 ? {
            toLocationId: location.inventory_location_id,
            fromStateId: states.EMPTY,
            toStateId: states.EMPTY,
            quantity: product.empty_qty_received_good.toNumber()
          } : null,
          product.empty_qty_received_damaged.toNumber() > 0 &&
          !product.exchange_exception.some((exception) => exception.resolution === "REJECT_DAMAGE") ? {
            toLocationId: location.inventory_location_id,
            fromStateId: states.DAMAGED,
            toStateId: states.DAMAGED,
            quantity: product.empty_qty_received_damaged.toNumber()
          } : null
        ]) {
          if (movement === null) continue;
          const ledger = await this.repository.createLateInventoryAdjustment(transaction, { ...base, ...movement });
          firstInventoryLedgerId ??= ledger.inventoryLedgerId;
        }
        for (const amount of [product.line_charge_amount.toNumber(), product.damage_charge_amount.toNumber()]) {
          if (amount <= 0) continue;
          const ledger = await this.repository.createLateMoneyAdjustment(transaction, {
            tenantId: context.tenantId,
            adjustmentId: adjustment.post_recon_adjustment_id,
            partyId: adjustment.stop_event.partyId,
            amount,
            tripId: adjustment.stop_event.tripId,
            tripStopId: adjustment.stop_event.tripStopId,
            stopEventId: adjustment.stop_event.stopEventId,
            eventTime: adjustment.stop_event.eventTime,
            actorUserId: context.userId
          });
          firstMoneyLedgerId ??= ledger.moneyLedgerId;
        }
      }
      await this.repository.approvePostAdjustment(
        transaction,
        context.tenantId,
        adjustment.post_recon_adjustment_id,
        context.userId,
        firstInventoryLedgerId,
        firstMoneyLedgerId
      );
      if (adjustment.reconciliation_exception_id !== null) {
        await this.repository.resolveException(
          transaction,
          context.tenantId,
          adjustment.reconciliation_exception_id,
          context.userId,
          "Late event adjustment approved and appended"
        );
      }
      return {
        adjustmentId: adjustment.post_recon_adjustment_id.toString(),
        approvalStatus: "APPROVED",
        inventoryLedgerId: firstInventoryLedgerId?.toString() ?? null,
        moneyLedgerId: firstMoneyLedgerId?.toString() ?? null,
        stopEventId: adjustment.stop_event.stopEventId.toString()
      };
    });
  }

  resolveException(context: AuthenticatedTenantContext, exceptionId: number, notes: string) {
    return this.transactions.run(context, async (transaction) => {
      const exception = await this.repository.findException(transaction, context.tenantId, exceptionId);
      if (exception === null) throw new ApiError(HttpStatus.NOT_FOUND, "RECONCILIATION_EXCEPTION_NOT_FOUND", "The exception was not found");
      if (!new Set(["OPEN", "UNDER_REVIEW"]).has(exception.status)) {
        throw new ApiError(HttpStatus.CONFLICT, "RECONCILIATION_EXCEPTION_NOT_OPEN", "The exception is not open");
      }
      if (exception.post_reconciliation_adjustment.some((adjustment) => adjustment.approval_status === "PENDING")) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "PENDING_POST_RECONCILIATION_ADJUSTMENT",
          "The pending post-reconciliation adjustment must be approved before resolving this exception"
        );
      }
      const resolved = await this.repository.resolveException(
        transaction, context.tenantId, exception.reconciliation_exception_id, context.userId, notes
      );
      return {
        reconciliationExceptionId: resolved.reconciliation_exception_id.toString(),
        status: resolved.status,
        resolvedAt: resolved.resolved_at?.toISOString() ?? null,
        resolutionNotes: resolved.resolution_notes
      };
    });
  }
}
