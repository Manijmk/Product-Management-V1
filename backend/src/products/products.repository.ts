import { Injectable } from "@nestjs/common";
import type { TenantPrismaTransaction } from "../tenancy/prisma-tenant-transaction.service.js";
import type { ProductUnitType } from "./domain/product-rules.js";
import type { DamageType } from "./dto/create-damage-rate.dto.js";
import { Prisma } from "@prisma/client";

@Injectable()
export class ProductsRepository {
  async lockHistory(transaction: TenantPrismaTransaction, historyKey: string): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT 1 AS acquired FROM pg_advisory_xact_lock(hashtextextended(${historyKey}, 0))`
    );
  }

  list(transaction: TenantPrismaTransaction, tenantId: number) {
    return transaction.product.findMany({
      where: { tenantId: BigInt(tenantId) },
      orderBy: { productCode: "asc" },
      select: {
        productId: true,
        productCode: true,
        name: true,
        unitType: true,
        exchangeRatio: true,
        activeStatus: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  find(transaction: TenantPrismaTransaction, tenantId: number, productId: number) {
    return transaction.product.findFirst({
      where: { tenantId: BigInt(tenantId), productId: BigInt(productId) },
      select: {
        productId: true,
        productCode: true,
        name: true,
        unitType: true,
        exchangeRatio: true,
        activeStatus: true,
        createdAt: true,
        updatedAt: true,
        product_price: {
          orderBy: { effective_from: "asc" },
          select: {
            product_price_id: true,
            price: true,
            effective_from: true,
            effective_to: true,
            status: true,
            created_at: true
          }
        },
        product_damage_rate: {
          orderBy: [{ damage_type: "asc" }, { effective_from: "asc" }],
          select: {
            damage_rate_id: true,
            damage_type: true,
            rate: true,
            effective_from: true,
            effective_to: true,
            status: true,
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
    input: { productCode: string; name: string; unitType: ProductUnitType; exchangeRatio?: number }
  ) {
    return transaction.product.create({
      data: {
        tenantId: BigInt(tenantId),
        productCode: input.productCode,
        name: input.name,
        unitType: input.unitType,
        exchangeRatio: input.exchangeRatio,
        createdByUserId: BigInt(actorUserId)
      },
      select: {
        productId: true,
        productCode: true,
        name: true,
        unitType: true,
        exchangeRatio: true,
        activeStatus: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  hasPriceOverlap(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    productId: number,
    effectiveFrom: Date,
    effectiveTo?: Date
  ) {
    return transaction.product_price.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        product_id: BigInt(productId),
        status: "ACTIVE",
        ...(effectiveTo === undefined ? {} : { effective_from: { lt: effectiveTo } }),
        OR: [{ effective_to: null }, { effective_to: { gt: effectiveFrom } }]
      },
      select: { product_price_id: true }
    });
  }

  createPrice(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    productId: number,
    actorUserId: number,
    price: number,
    effectiveFrom: Date,
    effectiveTo?: Date
  ) {
    return transaction.product_price.create({
      data: {
        tenant_id: BigInt(tenantId),
        product_id: BigInt(productId),
        price,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        created_by_user_id: BigInt(actorUserId)
      },
      select: {
        product_price_id: true,
        price: true,
        effective_from: true,
        effective_to: true,
        status: true,
        created_at: true
      }
    });
  }

  hasDamageRateOverlap(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    productId: number,
    damageType: DamageType,
    effectiveFrom: Date,
    effectiveTo?: Date
  ) {
    return transaction.product_damage_rate.findFirst({
      where: {
        tenant_id: BigInt(tenantId),
        product_id: BigInt(productId),
        damage_type: damageType,
        status: "ACTIVE",
        ...(effectiveTo === undefined ? {} : { effective_from: { lt: effectiveTo } }),
        OR: [{ effective_to: null }, { effective_to: { gt: effectiveFrom } }]
      },
      select: { damage_rate_id: true }
    });
  }

  createDamageRate(
    transaction: TenantPrismaTransaction,
    tenantId: number,
    productId: number,
    actorUserId: number,
    input: { damageType: DamageType; rate: number; effectiveFrom: Date; effectiveTo?: Date }
  ) {
    return transaction.product_damage_rate.create({
      data: {
        tenant_id: BigInt(tenantId),
        product_id: BigInt(productId),
        damage_type: input.damageType,
        rate: input.rate,
        effective_from: input.effectiveFrom,
        effective_to: input.effectiveTo,
        created_by_user_id: BigInt(actorUserId)
      },
      select: {
        damage_rate_id: true,
        damage_type: true,
        rate: true,
        effective_from: true,
        effective_to: true,
        status: true,
        created_at: true
      }
    });
  }
}
