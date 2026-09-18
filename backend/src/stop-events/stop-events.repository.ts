import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { TenantPrismaTransaction } from "../tenancy/prisma-tenant-transaction.service.js";
import type {
  DamageResolution,
  PaymentMethod,
  StopEventProductDto,
  StopEventType
} from "./dto/create-stop-event.dto.js";

const eventSelection = {
  stopEventId: true,
  tripId: true,
  tripStopId: true,
  partyId: true,
  eventType: true,
  eventStatus: true,
  eventTime: true,
  server_received_at: true,
  clientUuid: true,
  stop_event_product: {
    orderBy: { stop_event_product_id: "asc" as const },
    select: {
      stop_event_product_id: true,
      trip_stop_product_id: true,
      product_id: true,
      quantity_mode_snapshot: true,
      exchange_ratio_snapshot: true,
      full_qty_delivered: true,
      empty_qty_received_good: true,
      empty_qty_received_damaged: true,
      empty_qty_rejected: true,
      container_credit_qty: true,
      container_due_qty: true,
      price_applied: true,
      price_source: true,
      line_charge_amount: true,
      damage_charge_amount: true,
      exchange_exception: {
        orderBy: { exchange_exception_id: "asc" as const },
        select: {
          exchange_exception_id: true,
          exception_type: true,
          quantity: true,
          resolution: true
        }
      },
      price_override: {
        select: {
          price_override_id: true,
          standard_price: true,
          requested_price: true,
          approval_status: true,
          reason: true
        }
      }
    }
  },
  inventory_ledger_entry: {
    orderBy: { inventoryLedgerId: "asc" as const },
    select: {
      inventoryLedgerId: true,
      productId: true,
      quantity: true,
      eventType: true,
      from_location_id: true,
      to_location_id: true,
      from_state_id: true,
      to_state_id: true
    }
  },
  money_ledger_entry: {
    orderBy: { moneyLedgerId: "asc" as const },
    select: {
      moneyLedgerId: true,
      amount: true,
      direction: true,
      transactionType: true,
      payment_method: true,
      account_type: true
    }
  },
  reconciliation_exception: {
    orderBy: { reconciliation_exception_id: "asc" as const },
    select: { reconciliation_exception_id: true, status: true }
  },
  post_reconciliation_adjustment: {
    orderBy: { post_recon_adjustment_id: "asc" as const },
    select: { post_recon_adjustment_id: true, approval_status: true }
  }
} as const;

interface OpenChargeRow {
  money_ledger_id: bigint;
  remaining_amount: Prisma.Decimal;
}

@Injectable()
export class StopEventsRepository {
  async lockClientUuid(transaction: TenantPrismaTransaction, tenantId: number, clientUuid: string): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT 1 AS acquired FROM pg_advisory_xact_lock(hashtextextended(${`stop-event:${tenantId}:${clientUuid}`}, 0))`
    );
  }

  async lockVehicleInventory(transaction: TenantPrismaTransaction, tenantId: number, vehicleId: bigint): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT 1 AS acquired FROM pg_advisory_xact_lock(hashtextextended(${`vehicle-inventory:${tenantId}:${vehicleId}`}, 0))`
    );
  }

  findByClientUuid(transaction: TenantPrismaTransaction, tenantId: number, clientUuid: string) {
    return transaction.stopEvent.findFirst({
      where: { tenantId: BigInt(tenantId), clientUuid },
      select: eventSelection
    });
  }

  findResult(transaction: TenantPrismaTransaction, tenantId: number, stopEventId: bigint) {
    return transaction.stopEvent.findFirst({
      where: { tenantId: BigInt(tenantId), stopEventId },
      select: eventSelection
    });
  }

  findExecutionSource(transaction: TenantPrismaTransaction, tenantId: number, tripStopId: number) {
    return transaction.trip_stop.findFirst({
      where: { tenant_id: BigInt(tenantId), trip_stop_id: BigInt(tripStopId) },
      select: {
        trip_stop_id: true,
        trip_id: true,
        party_id: true,
        status: true,
        trip: {
          select: {
            status: true,
            vehicleId: true,
            trip_reconciliation: { select: { reconciliation_id: true, status: true } }
          }
        },
        trip_stop_product: {
          orderBy: { trip_stop_product_id: "asc" },
          select: {
            trip_stop_product_id: true,
            product_id: true,
            quantity_mode: true,
            planned_qty: true,
            forecast_qty: true,
            status: true,
            product: {
              select: { unitType: true, exchangeRatio: true, activeStatus: true }
            },
            stop_event_product: { select: { full_qty_delivered: true } }
          }
        }
      }
    });
  }

  findActorStaff(transaction: TenantPrismaTransaction, tenantId: number, userId: number) {
    return transaction.staff.findFirst({
      where: { tenant_id: BigInt(tenantId), user_id: BigInt(userId), status: "ACTIVE" },
      select: { staff_id: true }
    });
  }

  findVehicleLocation(transaction: TenantPrismaTransaction, tenantId: number, vehicleId: bigint) {
    return transaction.inventory_location.findFirst({
      where: { tenant_id: BigInt(tenantId), vehicle_id: vehicleId, location_type: "VEHICLE", status: "ACTIVE" },
      select: { inventory_location_id: true }
    });
  }

  async findInventoryStates(transaction: TenantPrismaTransaction): Promise<Record<string, bigint>> {
    const states = await transaction.inventory_state.findMany({
      where: { code: { in: ["FULL", "EMPTY", "DAMAGED"] } },
      select: { inventory_state_id: true, code: true }
    });
    return Object.fromEntries(states.map((state) => [state.code, state.inventory_state_id]));
  }

  async availableStock(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    locationId: bigint,
    productId: bigint,
    fullStateId: bigint
  ): Promise<number> {
    const [incoming, outgoing] = await Promise.all([
      transaction.inventoryLedgerEntry.aggregate({
        where: {
          tenantId: BigInt(tenantId),
          productId,
          to_location_id: locationId,
          to_state_id: fullStateId
        },
        _sum: { quantity: true }
      }),
      transaction.inventoryLedgerEntry.aggregate({
        where: {
          tenantId: BigInt(tenantId),
          productId,
          from_location_id: locationId,
          from_state_id: fullStateId
        },
        _sum: { quantity: true }
      })
    ]);
    return (incoming._sum.quantity?.toNumber() ?? 0) - (outgoing._sum.quantity?.toNumber() ?? 0);
  }

  findCustomerPrice(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    partyId: bigint,
    productId: bigint,
    at: Date
  ) {
    return transaction.party_product_price.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        party_id: partyId,
        product_id: productId,
        approval_status: "APPROVED",
        effective_from: { lte: at },
        OR: [{ effective_to: null }, { effective_to: { gt: at } }]
      },
      orderBy: { effective_from: "desc" },
      select: { price: true }
    });
  }

  findProductPrice(transaction: TenantPrismaTransaction, tenantId: number, productId: bigint, at: Date) {
    return transaction.product_price.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        product_id: productId,
        status: "ACTIVE",
        effective_from: { lte: at },
        OR: [{ effective_to: null }, { effective_to: { gt: at } }]
      },
      orderBy: { effective_from: "desc" },
      select: { price: true }
    });
  }

  findDamageRate(transaction: TenantPrismaTransaction, tenantId: number, productId: bigint, at: Date) {
    return transaction.product_damage_rate.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        product_id: productId,
        damage_type: "DAMAGED",
        status: "ACTIVE",
        effective_from: { lte: at },
        OR: [{ effective_to: null }, { effective_to: { gt: at } }]
      },
      orderBy: { effective_from: "desc" },
      select: { rate: true }
    });
  }

  createEvent(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    actorUserId: number,
    actorStaffId: bigint | undefined,
    source: { trip_id: bigint; trip_stop_id: bigint; party_id: bigint },
    input: {
      clientUuid: string;
      eventTime: Date;
      eventType: StopEventType;
      deviceId?: string;
      latitude?: number;
      longitude?: number;
      notes?: string;
    }
  ) {
    return transaction.stopEvent.create({
      data: {
        tenantId: BigInt(tenantId),
        tripId: source.trip_id,
        tripStopId: source.trip_stop_id,
        partyId: source.party_id,
        eventType: input.eventType,
        performed_by_staff_id: actorStaffId,
        performed_by_user_id: BigInt(actorUserId),
        eventTime: input.eventTime,
        clientUuid: input.clientUuid,
        device_id: input.deviceId,
        latitude: input.latitude,
        longitude: input.longitude,
        notes: input.notes
      },
      select: { stopEventId: true }
    });
  }

  createEventProduct(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    stopEventId: bigint,
    source: { trip_stop_product_id: bigint; product_id: bigint; quantity_mode: string; exchangeRatio?: number },
    input: StopEventProductDto,
    calculated: {
      acceptedGoodEmptyQty: number;
      containerCreditQty: number;
      containerDueQty: number;
      priceApplied?: number;
      priceSource?: string;
      lineCharge: number;
      damageCharge: number;
    }
  ) {
    return transaction.stop_event_product.create({
      data: {
        tenant_id: BigInt(tenantId),
        stop_event_id: stopEventId,
        trip_stop_product_id: source.trip_stop_product_id,
        product_id: source.product_id,
        quantity_mode_snapshot: source.quantity_mode,
        exchange_ratio_snapshot: source.exchangeRatio,
        full_qty_delivered: input.fullQtyDelivered,
        empty_qty_received_good: calculated.acceptedGoodEmptyQty,
        empty_qty_received_damaged: input.damagedEmptyQty,
        empty_qty_rejected: input.rejectedEmptyQty,
        container_credit_qty: calculated.containerCreditQty,
        container_due_qty: calculated.containerDueQty,
        price_applied: calculated.priceApplied,
        price_source: calculated.priceSource,
        line_charge_amount: calculated.lineCharge,
        damage_charge_amount: calculated.damageCharge,
        notes: input.notes
      },
      select: { stop_event_product_id: true }
    });
  }

  createExchangeException(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    stopEventProductId: bigint,
    actorUserId: number,
    actorStaffId: bigint | undefined,
    input: { type: string; quantity: number; resolution: string; notes?: string }
  ) {
    return transaction.exchange_exception.create({
      data: {
        tenant_id: BigInt(tenantId),
        stop_event_product_id: stopEventProductId,
        exception_type: input.type,
        quantity: input.quantity,
        resolution: input.resolution,
        authorized_by_staff_id: actorStaffId,
        approved_by_user_id: actorStaffId === undefined ? BigInt(actorUserId) : undefined,
        approved_at: actorStaffId === undefined ? new Date() : undefined,
        notes: input.notes
      }
    });
  }

  createPriceOverride(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    stopEventProductId: bigint,
    actorUserId: number,
    actorStaffId: bigint | undefined,
    input: { standardPrice: number; requestedPrice: number; reason: string; approved: boolean }
  ) {
    return transaction.price_override.create({
      data: {
        tenant_id: BigInt(tenantId),
        stop_event_product_id: stopEventProductId,
        standard_price: input.standardPrice,
        requested_price: input.requestedPrice,
        requested_by_staff_id: actorStaffId,
        requested_by_user_id: actorStaffId === undefined ? BigInt(actorUserId) : undefined,
        approval_status: input.approved ? "APPROVED" : "PENDING",
        approved_by_user_id: input.approved ? BigInt(actorUserId) : undefined,
        approved_at: input.approved ? new Date() : undefined,
        reason: input.reason
      }
    });
  }

  createInventoryEntry(
    transaction: TenantPrismaTransaction,
    input: {
      tenantId: number;
      productId: bigint;
      fromLocationId?: bigint;
      toLocationId?: bigint;
      fromStateId?: bigint;
      toStateId?: bigint;
      partyId: bigint;
      quantity: number;
      eventType: "DELIVERY" | "EMPTY_RETURN" | "DAMAGE_RETURN";
      tripId: bigint;
      tripStopId: bigint;
      stopEventId: bigint;
      occurredAt: Date;
      actorUserId: number;
      actorStaffId?: bigint;
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
        party_id: input.partyId,
        quantity: input.quantity,
        eventType: input.eventType,
        tripId: input.tripId,
        trip_stop_id: input.tripStopId,
        stopEventId: input.stopEventId,
        reference_type: "STOP_EVENT",
        reference_id: input.stopEventId,
        occurredAt: input.occurredAt,
        created_by_user_id: BigInt(input.actorUserId),
        created_by_staff_id: input.actorStaffId
      }
    });
  }

  createMoneyEntry(
    transaction: TenantPrismaTransaction,
    input: {
      tenantId: number;
      partyId: bigint;
      staffId?: bigint;
      amount: number;
      transactionType: "CUSTOMER_CHARGE" | "DAMAGE_CHARGE" | "CUSTOMER_PAYMENT";
      paymentMethod?: PaymentMethod;
      accountType: "CUSTOMER_RECEIVABLE" | "STAFF_CASH" | "TENANT_CASH" | "BANK";
      tripId: bigint;
      tripStopId: bigint;
      stopEventId: bigint;
      occurredAt: Date;
      actorUserId: number;
      actorStaffId?: bigint;
    }
  ) {
    return transaction.moneyLedgerEntry.create({
      data: {
        tenantId: BigInt(input.tenantId),
        partyId: input.partyId,
        staffId: input.staffId,
        amount: input.amount,
        direction: "IN",
        transactionType: input.transactionType,
        payment_method: input.paymentMethod,
        account_type: input.accountType,
        tripId: input.tripId,
        trip_stop_id: input.tripStopId,
        stopEventId: input.stopEventId,
        reference_type: "STOP_EVENT",
        reference_id: input.stopEventId,
        occurredAt: input.occurredAt,
        created_by_user_id: BigInt(input.actorUserId),
        created_by_staff_id: input.actorStaffId
      },
      select: { moneyLedgerId: true }
    });
  }

  findOpenCharges(transaction: TenantPrismaTransaction, tenantId: number, partyId: bigint) {
    return transaction.$queryRaw<OpenChargeRow[]>(Prisma.sql`
      SELECT ml.money_ledger_id,
             ml.amount - COALESCE(SUM(pa.allocated_amount), 0) AS remaining_amount
        FROM pms.money_ledger_entry ml
        LEFT JOIN pms.payment_allocation pa
          ON pa.tenant_id = ml.tenant_id
         AND pa.charge_money_ledger_id = ml.money_ledger_id
       WHERE ml.tenant_id = ${BigInt(tenantId)}
         AND ml.party_id = ${partyId}
         AND ml.transaction_type IN ('CUSTOMER_CHARGE', 'DAMAGE_CHARGE')
       GROUP BY ml.money_ledger_id, ml.amount, ml.occurred_at
      HAVING ml.amount - COALESCE(SUM(pa.allocated_amount), 0) > 0
       ORDER BY ml.occurred_at, ml.money_ledger_id
    `);
  }

  createAllocation(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    paymentLedgerId: bigint,
    chargeLedgerId: bigint,
    amount: number,
    actorUserId: number,
    actorStaffId?: bigint
  ) {
    return transaction.payment_allocation.create({
      data: {
        tenant_id: BigInt(tenantId),
        payment_money_ledger_id: paymentLedgerId,
        charge_money_ledger_id: chargeLedgerId,
        allocated_amount: amount,
        created_by_user_id: BigInt(actorUserId),
        created_by_staff_id: actorStaffId
      }
    });
  }

  updateExecutionStatus(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    tripStopId: bigint,
    products: readonly { tripStopProductId: bigint; partial: boolean }[],
    partial: boolean,
    at: Date
  ) {
    return Promise.all([
      ...products.map((product) => transaction.trip_stop_product.update({
        where: {
          tenant_id_trip_stop_product_id: {
            tenant_id: BigInt(tenantId),
            trip_stop_product_id: product.tripStopProductId
          }
        },
        data: { status: product.partial ? "PARTIAL" : "COMPLETED" }
      })),
      transaction.trip_stop.update({
        where: {
          tenant_id_trip_stop_id: { tenant_id: BigInt(tenantId), trip_stop_id: tripStopId }
        },
        data: { status: partial ? "PARTIAL" : "COMPLETED", attempted_at: at, completed_at: at }
      })
    ]);
  }

  findPartialProduct(transaction: TenantPrismaTransaction, tenantId: number, tripStopId: number, productId: number) {
    return transaction.trip_stop_product.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        trip_stop_id: BigInt(tripStopId),
        product_id: BigInt(productId)
      },
      select: {
        product_id: true,
        planned_qty: true,
        trip_stop: {
          select: {
            trip_stop_id: true,
            party_id: true,
            status: true,
            stop_event: {
              orderBy: { eventTime: "desc" },
              take: 1,
              select: { stopEventId: true }
            }
          }
        },
        stop_event_product: {
          select: { full_qty_delivered: true }
        }
      }
    });
  }

  createFollowUp(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    actorUserId: number,
    actorStaffId: bigint | undefined,
    source: { tripStopId: bigint; stopEventId: bigint; partyId: bigint; productId: bigint },
    input: { remainingQty: number; resolutionType: "FOLLOW_UP" | "CANCELLED"; reason?: string }
  ) {
    return transaction.stop_follow_up.create({
      data: {
        tenant_id: BigInt(tenantId),
        source_trip_stop_id: source.tripStopId,
        source_stop_event_id: source.stopEventId,
        party_id: source.partyId,
        product_id: source.productId,
        remaining_qty: input.remainingQty,
        resolution_type: input.resolutionType,
        status: input.resolutionType === "CANCELLED" ? "CANCELLED" : "OPEN",
        reason: input.reason,
        created_by_user_id: BigInt(actorUserId),
        created_by_staff_id: actorStaffId
      },
      select: {
        follow_up_id: true,
        source_trip_stop_id: true,
        source_stop_event_id: true,
        product_id: true,
        remaining_qty: true,
        resolution_type: true,
        status: true,
        reason: true,
        created_at: true
      }
    });
  }

  async createLateEventReview(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    actorUserId: number,
    actorStaffId: bigint | undefined,
    input: {
      reconciliationId: bigint;
      tripId: bigint;
      tripStopId: bigint;
      stopEventId: bigint;
      clientUuid: string;
    }
  ) {
    const exception = await transaction.reconciliation_exception.create({
      data: {
        tenant_id: BigInt(tenantId),
        reconciliation_id: input.reconciliationId,
        exception_type: "LATE_STOP_EVENT",
        severity: "CRITICAL",
        trip_id: input.tripId,
        trip_stop_id: input.tripStopId,
        stop_event_id: input.stopEventId,
        detected_source: "SYNC_ENGINE",
        description: `Late offline StopEvent ${input.clientUuid} received after reconciliation`
      },
      select: { reconciliation_exception_id: true, status: true }
    });
    const adjustment = await transaction.post_reconciliation_adjustment.create({
      data: {
        tenant_id: BigInt(tenantId),
        reconciliation_id: input.reconciliationId,
        trip_id: input.tripId,
        reconciliation_exception_id: exception.reconciliation_exception_id,
        adjustment_type: "STOP_EVENT_CORRECTION",
        reason_code: "LATE_OFFLINE_EVENT",
        reason_notes: `Quarantined client UUID ${input.clientUuid}`,
        requested_by_staff_id: actorStaffId,
        requested_by_user_id: BigInt(actorUserId),
        stop_event_id: input.stopEventId
      },
      select: { post_recon_adjustment_id: true, approval_status: true }
    });
    return { exception, adjustment };
  }
}
