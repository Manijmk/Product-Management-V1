import { HttpStatus, Injectable } from "@nestjs/common";
import { ADMIN_ROLE, OWNER_ROLE } from "../auth/roles.js";
import { ApiError } from "../http/api-error.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";
import { ExchangeCalculationService } from "./domain/exchange-calculation.service.js";
import { PostingService } from "./domain/posting.service.js";
import type { CreateFollowUpDto } from "./dto/create-follow-up.dto.js";
import type { CreateStopEventDto, StopEventProductDto } from "./dto/create-stop-event.dto.js";
import { StopEventsRepository } from "./stop-events.repository.js";

type EventResult = NonNullable<Awaited<ReturnType<StopEventsRepository["findResult"]>>>;
type ExecutionSource = NonNullable<Awaited<ReturnType<StopEventsRepository["findExecutionSource"]>>>;
type SourceProduct = ExecutionSource["trip_stop_product"][number];

interface PreparedProduct {
  readonly source: SourceProduct;
  readonly input: StopEventProductDto;
  readonly suggestedFullQty: number | null;
  readonly acceptedGoodEmptyQty: number;
  readonly containerCreditQty: number;
  readonly containerDueQty: number;
  readonly excessEmptyQty: number;
  readonly standardPrice?: number;
  readonly priceApplied?: number;
  readonly priceSource?: string;
  readonly overrideApproved: boolean;
  readonly lineCharge: number;
  readonly damageCharge: number;
  readonly partial: boolean;
}

const closeEnough = (left: number, right: number): boolean => Math.abs(left - right) < 0.0005;

function mapEvent(event: EventResult, duplicate: boolean) {
  return {
    duplicate,
    stopEventId: event.stopEventId.toString(),
    tripId: event.tripId.toString(),
    tripStopId: event.tripStopId.toString(),
    partyId: event.partyId.toString(),
    eventType: event.eventType,
    eventStatus: event.eventStatus,
    eventTime: event.eventTime.toISOString(),
    serverReceivedAt: event.server_received_at.toISOString(),
    clientUuid: event.clientUuid,
    products: event.stop_event_product.map((product) => ({
      stopEventProductId: product.stop_event_product_id.toString(),
      tripStopProductId: product.trip_stop_product_id?.toString() ?? null,
      productId: product.product_id.toString(),
      quantityMode: product.quantity_mode_snapshot,
      exchangeRatio: product.exchange_ratio_snapshot?.toString() ?? null,
      fullQtyDelivered: product.full_qty_delivered.toString(),
      goodEmptyQtyAccepted: product.empty_qty_received_good.toString(),
      damagedEmptyQty: product.empty_qty_received_damaged.toString(),
      rejectedEmptyQty: product.empty_qty_rejected.toString(),
      containerCreditQty: product.container_credit_qty.toString(),
      containerDueQty: product.container_due_qty.toString(),
      priceApplied: product.price_applied?.toString() ?? null,
      priceSource: product.price_source,
      lineChargeAmount: product.line_charge_amount.toString(),
      damageChargeAmount: product.damage_charge_amount.toString(),
      exchangeExceptions: product.exchange_exception.map((exception) => ({
        exchangeExceptionId: exception.exchange_exception_id.toString(),
        type: exception.exception_type,
        quantity: exception.quantity.toString(),
        resolution: exception.resolution
      })),
      priceOverride: product.price_override === null ? null : {
        priceOverrideId: product.price_override.price_override_id.toString(),
        standardPrice: product.price_override.standard_price.toString(),
        requestedPrice: product.price_override.requested_price.toString(),
        approvalStatus: product.price_override.approval_status,
        reason: product.price_override.reason
      }
    })),
    inventoryLedgerEntries: event.inventory_ledger_entry.map((entry) => ({
      inventoryLedgerId: entry.inventoryLedgerId.toString(),
      productId: entry.productId.toString(),
      quantity: entry.quantity.toString(),
      eventType: entry.eventType,
      fromLocationId: entry.from_location_id?.toString() ?? null,
      toLocationId: entry.to_location_id?.toString() ?? null,
      fromStateId: entry.from_state_id?.toString() ?? null,
      toStateId: entry.to_state_id?.toString() ?? null
    })),
    moneyLedgerEntries: event.money_ledger_entry.map((entry) => ({
      moneyLedgerId: entry.moneyLedgerId.toString(),
      amount: entry.amount.toString(),
      direction: entry.direction,
      transactionType: entry.transactionType,
      paymentMethod: entry.payment_method,
      accountType: entry.account_type
    })),
    reconciliationReview: event.reconciliation_exception[0] === undefined ? null : {
      reconciliationExceptionId: event.reconciliation_exception[0].reconciliation_exception_id.toString(),
      exceptionStatus: event.reconciliation_exception[0].status,
      adjustmentId: event.post_reconciliation_adjustment[0]?.post_recon_adjustment_id.toString() ?? null,
      adjustmentStatus: event.post_reconciliation_adjustment[0]?.approval_status ?? null
    }
  };
}

@Injectable()
export class StopEventsService {
  constructor(
    private readonly transactions: PrismaTenantTransactionService,
    private readonly repository: StopEventsRepository,
    private readonly exchange: ExchangeCalculationService,
    private readonly posting: PostingService
  ) {}

  create(context: AuthenticatedTenantContext, tripStopId: number, input: CreateStopEventDto) {
    const productKeys = input.products.map((product) => `${product.tripStopProductId}:${product.productId}`);
    if (new Set(productKeys).size !== productKeys.length) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "DUPLICATE_EVENT_PRODUCT", "Each stop product may appear only once per event");
    }
    const eventTime = new Date(input.eventTime);
    const administrative = context.roles.includes(OWNER_ROLE) || context.roles.includes(ADMIN_ROLE);

    return this.transactions.run(context, async (transaction) => {
      await this.repository.lockClientUuid(transaction, context.tenantId, input.clientUuid);
      const existing = await this.repository.findByClientUuid(transaction, context.tenantId, input.clientUuid);
      if (existing !== null) return mapEvent(existing, true);

      const source = await this.repository.findExecutionSource(transaction, context.tenantId, tripStopId);
      if (source === null) throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_STOP_NOT_FOUND", "The trip stop was not found");
      const lateAfterReconciliation = source.trip.status === "RECONCILED";
      if (!lateAfterReconciliation && source.trip.status !== "IN_PROGRESS") {
        throw new ApiError(HttpStatus.CONFLICT, "INVALID_TRIP_STATUS", "Stop execution requires an in-progress trip");
      }
      if (!lateAfterReconciliation && !["PENDING", "IN_SERVICE", "PARTIAL"].includes(source.status)) {
        throw new ApiError(HttpStatus.CONFLICT, "STOP_ALREADY_HANDLED", "The trip stop is already terminal");
      }
      if (lateAfterReconciliation && input.payments.length > 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          "LATE_EVENT_PAYMENT_NOT_SUPPORTED",
          "Late-event payments require a separately auditable financial adjustment"
        );
      }

      const actorStaff = await this.repository.findActorStaff(transaction, context.tenantId, context.userId);
      const actorStaffId = actorStaff?.staff_id;
      const physicalMovement = input.products.some((product) =>
        product.fullQtyDelivered > 0 || product.goodEmptyQty > 0 || product.damagedEmptyQty > 0
      );
      let vehicleLocationId: bigint | undefined;
      if (physicalMovement) {
        if (source.trip.vehicleId === null) {
          throw new ApiError(HttpStatus.CONFLICT, "TRIP_VEHICLE_REQUIRED", "Physical stop execution requires a trip vehicle");
        }
        await this.repository.lockVehicleInventory(transaction, context.tenantId, source.trip.vehicleId);
        const vehicleLocation = await this.repository.findVehicleLocation(transaction, context.tenantId, source.trip.vehicleId);
        if (vehicleLocation === null) {
          throw new ApiError(HttpStatus.CONFLICT, "VEHICLE_INVENTORY_LOCATION_REQUIRED", "The trip vehicle has no active inventory location");
        }
        vehicleLocationId = vehicleLocation.inventory_location_id;
      }

      const states = await this.repository.findInventoryStates(transaction);
      if (physicalMovement && (states.FULL === undefined || states.EMPTY === undefined || states.DAMAGED === undefined)) {
        throw new ApiError(HttpStatus.INTERNAL_SERVER_ERROR, "INVENTORY_STATE_CONFIGURATION_MISSING", "Required inventory states are not configured");
      }

      const prepared: PreparedProduct[] = [];
      for (const eventProduct of input.products) {
        const sourceProduct = source.trip_stop_product.find((product) =>
          product.trip_stop_product_id === BigInt(eventProduct.tripStopProductId) &&
          product.product_id === BigInt(eventProduct.productId)
        );
        if (sourceProduct === undefined) {
          throw new ApiError(HttpStatus.NOT_FOUND, "TRIP_STOP_PRODUCT_NOT_FOUND", "The product is not configured on this trip stop");
        }
        if (eventProduct.quantityMode !== undefined && eventProduct.quantityMode !== sourceProduct.quantity_mode) {
          throw new ApiError(HttpStatus.BAD_REQUEST, "QUANTITY_MODE_MISMATCH", "The request quantity mode does not match the trip snapshot");
        }
        if (sourceProduct.product.activeStatus !== "ACTIVE") {
          throw new ApiError(HttpStatus.CONFLICT, "PRODUCT_NOT_ACTIVE", "The product is not active");
        }
        if (
          eventProduct.fullQtyDelivered === 0 && eventProduct.goodEmptyQty === 0 &&
          eventProduct.damagedEmptyQty === 0 && eventProduct.rejectedEmptyQty === 0
        ) {
          throw new ApiError(HttpStatus.BAD_REQUEST, "EMPTY_EVENT_PRODUCT", "An event product must record actual activity");
        }
        if (sourceProduct.product.unitType !== "EXCHANGE" && eventProduct.goodEmptyQty > 0) {
          throw new ApiError(HttpStatus.BAD_REQUEST, "EMPTY_RETURN_NOT_ALLOWED", "Eligible empty returns require an EXCHANGE product");
        }

        let acceptedGoodEmptyQty = eventProduct.goodEmptyQty;
        let containerCreditQty = 0;
        let containerDueQty = 0;
        let excessEmptyQty = 0;
        let suggestedFullQty: number | null = null;
        const exchangeRatio = sourceProduct.product.exchangeRatio?.toNumber();
        if (sourceProduct.product.unitType === "EXCHANGE") {
          const calculated = this.exchange.calculate({
            exchangeRatio: exchangeRatio ?? 0,
            observedGoodEmptyQty: eventProduct.goodEmptyQty,
            fullQtyDelivered: eventProduct.fullQtyDelivered,
            excessEmptyResolution: eventProduct.excessEmptyResolution,
            authorizeContainerDue: eventProduct.authorizeContainerDue
          });
          ({ acceptedGoodEmptyQty, containerCreditQty, containerDueQty, excessEmptyQty, suggestedFullQty } = calculated);
        }

        if (eventProduct.damagedEmptyQty > 0 && eventProduct.damageResolution === undefined) {
          throw new ApiError(HttpStatus.BAD_REQUEST, "DAMAGE_RESOLUTION_REQUIRED", "Damaged returns require an explicit resolution");
        }
        if (eventProduct.damagedEmptyQty === 0 && eventProduct.damageResolution !== undefined) {
          throw new ApiError(HttpStatus.BAD_REQUEST, "DAMAGE_QUANTITY_REQUIRED", "A damage resolution requires a damaged quantity");
        }

        const customerPrice = eventProduct.fullQtyDelivered === 0 ? null : await this.repository.findCustomerPrice(
          transaction, context.tenantId, source.party_id, sourceProduct.product_id, eventTime
        );
        const productPrice = customerPrice !== null || eventProduct.fullQtyDelivered === 0 ? null : await this.repository.findProductPrice(
          transaction, context.tenantId, sourceProduct.product_id, eventTime
        );
        const standardPrice = customerPrice?.price.toNumber() ?? productPrice?.price.toNumber();
        const standardSource = customerPrice !== null ? "CUSTOMER_PRICE" : productPrice !== null ? "PRODUCT_DEFAULT" : undefined;
        const overrideApproved = eventProduct.priceOverride !== undefined && administrative;
        if (eventProduct.fullQtyDelivered > 0 && standardPrice === undefined && !overrideApproved) {
          throw new ApiError(HttpStatus.CONFLICT, "PRICE_NOT_CONFIGURED", "No active approved price is configured for this product");
        }
        const priceApplied = eventProduct.fullQtyDelivered === 0
          ? undefined
          : overrideApproved ? eventProduct.priceOverride!.requestedPrice : standardPrice;
        const priceSource = eventProduct.fullQtyDelivered === 0
          ? undefined
          : overrideApproved ? "STAFF_OVERRIDE" : standardSource;
        const lineCharge = priceApplied === undefined ? 0 : this.posting.lineCharge(priceApplied, eventProduct.fullQtyDelivered);

        let damageCharge = 0;
        if (eventProduct.damageResolution === "CHARGE_DAMAGE") {
          const damageRate = await this.repository.findDamageRate(
            transaction, context.tenantId, sourceProduct.product_id, eventTime
          );
          if (damageRate === null) {
            throw new ApiError(HttpStatus.CONFLICT, "DAMAGE_RATE_NOT_CONFIGURED", "No active damaged-container rate is configured");
          }
          damageCharge = this.posting.damageCharge(damageRate.rate.toNumber(), eventProduct.damagedEmptyQty);
        }

        if (!lateAfterReconciliation && eventProduct.fullQtyDelivered > 0) {
          const available = await this.repository.availableStock(
            transaction,
            context.tenantId,
            vehicleLocationId!,
            sourceProduct.product_id,
            states.FULL!
          );
          if (eventProduct.fullQtyDelivered > available) {
            throw new ApiError(HttpStatus.CONFLICT, "INSUFFICIENT_VEHICLE_STOCK", "The trip vehicle does not have enough FULL stock", {
              productId: eventProduct.productId,
              requestedQty: eventProduct.fullQtyDelivered,
              availableQty: available
            });
          }
        }

        const deliveredPreviously = sourceProduct.stop_event_product.reduce(
          (total, product) => total + product.full_qty_delivered.toNumber(),
          0
        );
        const planned = sourceProduct.planned_qty?.toNumber();
        const partial = planned !== undefined && deliveredPreviously + eventProduct.fullQtyDelivered < planned;
        prepared.push({
          source: sourceProduct,
          input: eventProduct,
          suggestedFullQty,
          acceptedGoodEmptyQty,
          containerCreditQty,
          containerDueQty,
          excessEmptyQty,
          standardPrice,
          priceApplied,
          priceSource,
          overrideApproved,
          lineCharge,
          damageCharge,
          partial
        });
      }

      const created = await this.repository.createEvent(
        transaction,
        context.tenantId,
        context.userId,
        actorStaffId,
        source,
        { ...input, eventTime }
      );

      for (const product of prepared) {
        const eventProduct = await this.repository.createEventProduct(
          transaction,
          context.tenantId,
          created.stopEventId,
          {
            ...product.source,
            exchangeRatio: product.source.product.exchangeRatio?.toNumber()
          },
          product.input,
          product
        );

        if (product.excessEmptyQty > 0) {
          await this.repository.createExchangeException(
            transaction,
            context.tenantId,
            eventProduct.stop_event_product_id,
            context.userId,
            actorStaffId,
            {
              type: "EXCESS_EMPTY",
              quantity: product.excessEmptyQty,
              resolution: product.input.excessEmptyResolution!,
              notes: product.input.notes
            }
          );
        }
        if (product.containerDueQty > 0) {
          await this.repository.createExchangeException(
            transaction,
            context.tenantId,
            eventProduct.stop_event_product_id,
            context.userId,
            actorStaffId,
            {
              type: "CONTAINER_DUE",
              quantity: product.containerDueQty,
              resolution: "DELIVER_WITH_CONTAINER_DUE",
              notes: product.input.notes
            }
          );
        }
        if (product.input.damagedEmptyQty > 0) {
          await this.repository.createExchangeException(
            transaction,
            context.tenantId,
            eventProduct.stop_event_product_id,
            context.userId,
            actorStaffId,
            {
              type: "DAMAGED_CONTAINER",
              quantity: product.input.damagedEmptyQty,
              resolution: product.input.damageResolution!,
              notes: product.input.notes
            }
          );
        }
        if (product.input.priceOverride !== undefined) {
          await this.repository.createPriceOverride(
            transaction,
            context.tenantId,
            eventProduct.stop_event_product_id,
            context.userId,
            actorStaffId,
            {
              standardPrice: product.standardPrice ?? 0,
              requestedPrice: product.input.priceOverride.requestedPrice,
              reason: product.input.priceOverride.reason,
              approved: product.overrideApproved
            }
          );
        }

        const ledgerBase = {
          tenantId: context.tenantId,
          productId: product.source.product_id,
          partyId: source.party_id,
          tripId: source.trip_id,
          tripStopId: source.trip_stop_id,
          stopEventId: created.stopEventId,
          occurredAt: eventTime,
          actorUserId: context.userId,
          actorStaffId
        };
        if (!lateAfterReconciliation && product.input.fullQtyDelivered > 0) {
          await this.repository.createInventoryEntry(transaction, {
            ...ledgerBase,
            fromLocationId: vehicleLocationId,
            fromStateId: states.FULL,
            quantity: product.input.fullQtyDelivered,
            eventType: "DELIVERY"
          });
        }
        if (!lateAfterReconciliation && product.acceptedGoodEmptyQty > 0) {
          await this.repository.createInventoryEntry(transaction, {
            ...ledgerBase,
            toLocationId: vehicleLocationId,
            fromStateId: states.EMPTY,
            toStateId: states.EMPTY,
            quantity: product.acceptedGoodEmptyQty,
            eventType: "EMPTY_RETURN"
          });
        }
        if (!lateAfterReconciliation && product.input.damagedEmptyQty > 0 && product.input.damageResolution !== "REJECT_DAMAGE") {
          await this.repository.createInventoryEntry(transaction, {
            ...ledgerBase,
            toLocationId: vehicleLocationId,
            fromStateId: states.DAMAGED,
            toStateId: states.DAMAGED,
            quantity: product.input.damagedEmptyQty,
            eventType: "DAMAGE_RETURN"
          });
        }
        if (!lateAfterReconciliation && product.lineCharge > 0) {
          await this.repository.createMoneyEntry(transaction, {
            ...ledgerBase,
            amount: product.lineCharge,
            transactionType: "CUSTOMER_CHARGE",
            accountType: "CUSTOMER_RECEIVABLE"
          });
        }
        if (!lateAfterReconciliation && product.damageCharge > 0) {
          await this.repository.createMoneyEntry(transaction, {
            ...ledgerBase,
            amount: product.damageCharge,
            transactionType: "DAMAGE_CHARGE",
            accountType: "CUSTOMER_RECEIVABLE"
          });
        }
      }

      if (lateAfterReconciliation) {
        const reconciliation = source.trip.trip_reconciliation;
        if (reconciliation === null || reconciliation.status !== "APPROVED") {
          throw new ApiError(HttpStatus.CONFLICT, "APPROVED_RECONCILIATION_NOT_FOUND", "The reconciled trip has no approved reconciliation");
        }
        await this.repository.createLateEventReview(
          transaction,
          context.tenantId,
          context.userId,
          actorStaffId,
          {
            reconciliationId: reconciliation.reconciliation_id,
            tripId: source.trip_id,
            tripStopId: source.trip_stop_id,
            stopEventId: created.stopEventId,
            clientUuid: input.clientUuid
          }
        );
        return mapEvent((await this.repository.findResult(transaction, context.tenantId, created.stopEventId))!, false);
      }

      for (const payment of input.payments) {
        const paymentEntry = await this.repository.createMoneyEntry(transaction, {
          tenantId: context.tenantId,
          partyId: source.party_id,
          staffId: payment.paymentMethod === "CASH" ? actorStaffId : undefined,
          amount: payment.amount,
          transactionType: "CUSTOMER_PAYMENT",
          paymentMethod: payment.paymentMethod,
          accountType: payment.paymentMethod === "CASH"
            ? actorStaffId === undefined ? "TENANT_CASH" : "STAFF_CASH"
            : "BANK",
          tripId: source.trip_id,
          tripStopId: source.trip_stop_id,
          stopEventId: created.stopEventId,
          occurredAt: eventTime,
          actorUserId: context.userId,
          actorStaffId
        });
        let remainingPayment = payment.amount;
        for (const charge of await this.repository.findOpenCharges(transaction, context.tenantId, source.party_id)) {
          if (remainingPayment <= 0) break;
          const allocated = Math.min(remainingPayment, charge.remaining_amount.toNumber());
          if (allocated <= 0) continue;
          await this.repository.createAllocation(
            transaction,
            context.tenantId,
            paymentEntry.moneyLedgerId,
            charge.money_ledger_id,
            Math.round(allocated * 100) / 100,
            context.userId,
            actorStaffId
          );
          remainingPayment = Math.round((remainingPayment - allocated) * 100) / 100;
        }
      }

      const submittedIds = new Set(prepared.map((product) => product.source.trip_stop_product_id.toString()));
      const partial = prepared.some((product) => product.partial) || source.trip_stop_product.some((product) =>
        !submittedIds.has(product.trip_stop_product_id.toString()) && product.status !== "COMPLETED"
      );
      await this.repository.updateExecutionStatus(
        transaction,
        context.tenantId,
        source.trip_stop_id,
        prepared.map((product) => ({ tripStopProductId: product.source.trip_stop_product_id, partial: product.partial })),
        partial,
        eventTime
      );

      return mapEvent((await this.repository.findResult(transaction, context.tenantId, created.stopEventId))!, false);
    });
  }

  createFollowUp(context: AuthenticatedTenantContext, tripStopId: number, input: CreateFollowUpDto) {
    if (input.resolutionType === "CANCELLED" && input.reason === undefined) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "FOLLOW_UP_REASON_REQUIRED", "Cancelling remaining demand requires a reason");
    }
    return this.transactions.run(context, async (transaction) => {
      const product = await this.repository.findPartialProduct(
        transaction, context.tenantId, tripStopId, input.productId
      );
      if (product === null || product.trip_stop.status !== "PARTIAL") {
        throw new ApiError(HttpStatus.NOT_FOUND, "PARTIAL_STOP_PRODUCT_NOT_FOUND", "The partial trip-stop product was not found");
      }
      if (product.planned_qty === null || product.trip_stop.stop_event[0] === undefined) {
        throw new ApiError(HttpStatus.CONFLICT, "FOLLOW_UP_NOT_ALLOWED", "This stop product has no planned remaining demand");
      }
      const delivered = product.stop_event_product.reduce(
        (total, eventProduct) => total + eventProduct.full_qty_delivered.toNumber(),
        0
      );
      const remaining = Math.max(product.planned_qty.toNumber() - delivered, 0);
      if (remaining <= 0 || !closeEnough(remaining, input.remainingQty)) {
        throw new ApiError(HttpStatus.BAD_REQUEST, "FOLLOW_UP_QUANTITY_MISMATCH", "remainingQty must equal the unfulfilled planned quantity", {
          expectedRemainingQty: remaining
        });
      }
      const actorStaff = await this.repository.findActorStaff(transaction, context.tenantId, context.userId);
      const created = await this.repository.createFollowUp(
        transaction,
        context.tenantId,
        context.userId,
        actorStaff?.staff_id,
        {
          tripStopId: product.trip_stop.trip_stop_id,
          stopEventId: product.trip_stop.stop_event[0]!.stopEventId,
          partyId: product.trip_stop.party_id,
          productId: product.product_id
        },
        input
      );
      return {
        followUpId: created.follow_up_id.toString(),
        sourceTripStopId: created.source_trip_stop_id.toString(),
        sourceStopEventId: created.source_stop_event_id?.toString() ?? null,
        productId: created.product_id.toString(),
        remainingQty: created.remaining_qty?.toString() ?? null,
        resolutionType: created.resolution_type,
        status: created.status,
        reason: created.reason,
        createdAt: created.created_at.toISOString()
      };
    });
  }
}
