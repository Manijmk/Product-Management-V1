import { Injectable } from "@nestjs/common";
import type { TenantPrismaTransaction } from "../tenancy/prisma-tenant-transaction.service.js";
import type { ExchangePolicy, QuantityMode, RelationshipType } from "./domain/customer-rules.js";
import { Prisma } from "@prisma/client";

@Injectable()
export class CustomersRepository {
  async lockPriceHistory(transaction: TenantPrismaTransaction, historyKey: string): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT 1 AS acquired FROM pg_advisory_xact_lock(hashtextextended(${historyKey}, 0))`
    );
  }

  list(transaction: TenantPrismaTransaction, tenantId: number) {
    return transaction.party.findMany({
      where: { tenantId: BigInt(tenantId), party_type: "CUSTOMER" },
      orderBy: { partyId: "asc" },
      select: {
        partyId: true,
        party_code: true,
        name: true,
        relationshipType: true,
        mobile: true,
        customerStatus: true,
        createdSource: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  find(transaction: TenantPrismaTransaction, tenantId: number, partyId: number) {
    return transaction.party.findFirst({
      where: { tenantId: BigInt(tenantId), partyId: BigInt(partyId), party_type: "CUSTOMER" },
      select: {
        partyId: true,
        party_code: true,
        name: true,
        relationshipType: true,
        mobile: true,
        alternate_mobile: true,
        address_line1: true,
        address_line2: true,
        locality: true,
        city: true,
        postal_code: true,
        latitude: true,
        longitude: true,
        customerStatus: true,
        createdSource: true,
        createdByUserId: true,
        approvedByUserId: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true,
        party_product: {
          orderBy: { product_id: "asc" },
          select: {
            party_product_id: true,
            product_id: true,
            quantity_mode: true,
            default_qty: true,
            forecast_qty: true,
            exchange_policy: true,
            active_status: true,
            created_at: true,
            updated_at: true,
            product: { select: { productCode: true, name: true } }
          }
        },
        party_product_price: {
          orderBy: [{ product_id: "asc" }, { effective_from: "asc" }],
          select: {
            party_product_price_id: true,
            product_id: true,
            price: true,
            effective_from: true,
            effective_to: true,
            approval_status: true,
            approved_by_user_id: true,
            approved_at: true,
            created_at: true
          }
        }
      }
    });
  }

  create(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    actorUserId: number,
    input: {
      partyCode?: string;
      name: string;
      relationshipType: RelationshipType;
      mobile?: string;
      alternateMobile?: string;
      addressLine1?: string;
      addressLine2?: string;
      locality?: string;
      city?: string;
      postalCode?: string;
      latitude?: string;
      longitude?: string;
      customerStatus: "TEMPORARY" | "PENDING_APPROVAL" | "ACTIVE";
      createdSource: "ADMIN" | "STAFF";
    }
  ) {
    const active = input.customerStatus === "ACTIVE";
    return transaction.party.create({
      data: {
        tenantId: BigInt(tenantId),
        party_code: input.partyCode,
        name: input.name,
        relationshipType: input.relationshipType,
        mobile: input.mobile,
        alternate_mobile: input.alternateMobile,
        address_line1: input.addressLine1,
        address_line2: input.addressLine2,
        locality: input.locality,
        city: input.city,
        postal_code: input.postalCode,
        latitude: input.latitude,
        longitude: input.longitude,
        customerStatus: input.customerStatus,
        createdSource: input.createdSource,
        createdByUserId: BigInt(actorUserId),
        approvedByUserId: active ? BigInt(actorUserId) : undefined,
        approvedAt: active ? new Date() : undefined
      },
      select: {
        partyId: true,
        party_code: true,
        name: true,
        relationshipType: true,
        mobile: true,
        customerStatus: true,
        createdSource: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  approve(transaction: TenantPrismaTransaction, tenantId: number, partyId: number, actorUserId: number) {
    return transaction.party.update({
      where: {
        tenantId_partyId: {
          tenantId: BigInt(tenantId),
          partyId: BigInt(partyId)
        }
      },
      data: {
        customerStatus: "ACTIVE",
        approvedByUserId: BigInt(actorUserId),
        approvedAt: new Date()
      },
      select: {
        partyId: true,
        party_code: true,
        name: true,
        relationshipType: true,
        mobile: true,
        customerStatus: true,
        createdSource: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  findProduct(transaction: TenantPrismaTransaction, tenantId: number, productId: number) {
    return transaction.product.findFirst({
      where: { tenantId: BigInt(tenantId), productId: BigInt(productId), activeStatus: "ACTIVE" },
      select: { productId: true }
    });
  }

  createPartyProduct(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    partyId: number,
    actorUserId: number,
    input: {
      productId: number;
      quantityMode: QuantityMode;
      defaultQty?: number;
      forecastQty?: number;
      exchangePolicy?: ExchangePolicy;
    }
  ) {
    return transaction.party_product.create({
      data: {
        tenant_id: BigInt(tenantId),
        party_id: BigInt(partyId),
        product_id: BigInt(input.productId),
        quantity_mode: input.quantityMode,
        default_qty: input.defaultQty,
        forecast_qty: input.forecastQty,
        exchange_policy: input.exchangePolicy,
        created_by_user_id: BigInt(actorUserId)
      },
      select: {
        party_product_id: true,
        product_id: true,
        quantity_mode: true,
        default_qty: true,
        forecast_qty: true,
        exchange_policy: true,
        active_status: true,
        created_at: true,
        updated_at: true,
        product: { select: { productCode: true, name: true } }
      }
    });
  }

  findPartyProduct(transaction: TenantPrismaTransaction, tenantId: number, partyId: number, productId: number) {
    return transaction.party_product.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        party_id: BigInt(partyId),
        product_id: BigInt(productId),
        active_status: "ACTIVE"
      },
      select: { party_product_id: true }
    });
  }

  hasPriceOverlap(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    partyId: number,
    productId: number,
    effectiveFrom: Date,
    effectiveTo?: Date
  ) {
    return transaction.party_product_price.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        party_id: BigInt(partyId),
        product_id: BigInt(productId),
        approval_status: "APPROVED",
        ...(effectiveTo === undefined ? {} : { effective_from: { lt: effectiveTo } }),
        OR: [{ effective_to: null }, { effective_to: { gt: effectiveFrom } }]
      },
      select: { party_product_price_id: true }
    });
  }

  createPrice(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    partyId: number,
    productId: number,
    actorUserId: number,
    price: number,
    effectiveFrom: Date,
    effectiveTo?: Date
  ) {
    return transaction.party_product_price.create({
      data: {
        tenant_id: BigInt(tenantId),
        party_id: BigInt(partyId),
        product_id: BigInt(productId),
        price,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        approval_status: "APPROVED",
        created_by_user_id: BigInt(actorUserId),
        approved_by_user_id: BigInt(actorUserId),
        approved_at: new Date()
      },
      select: {
        party_product_price_id: true,
        product_id: true,
        price: true,
        effective_from: true,
        effective_to: true,
        approval_status: true,
        approved_by_user_id: true,
        approved_at: true,
        created_at: true
      }
    });
  }
}
