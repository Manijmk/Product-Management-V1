import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../http/api-error.js";
import { type ListQueryDto, pageResponse } from "../http/list-query.dto.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";
import { parseEffectivePeriod, validateProductConfiguration } from "./domain/product-rules.js";
import type { CreateDamageRateDto } from "./dto/create-damage-rate.dto.js";
import type { CreateProductPriceDto } from "./dto/create-product-price.dto.js";
import type { CreateProductDto } from "./dto/create-product.dto.js";
import { ProductsRepository } from "./products.repository.js";

type ProductSummary = Awaited<ReturnType<ProductsRepository["list"]>>[number];
type ProductDetail = NonNullable<Awaited<ReturnType<ProductsRepository["find"]>>>;

function mapProduct(product: ProductSummary) {
  return {
    productId: product.productId.toString(),
    productCode: product.productCode,
    name: product.name,
    unitType: product.unitType,
    exchangeRatio: product.exchangeRatio?.toString() ?? null,
    activeStatus: product.activeStatus,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString()
  };
}

function mapPrice(price: ProductDetail["product_price"][number]) {
  return {
    productPriceId: price.product_price_id.toString(),
    price: price.price.toString(),
    effectiveFrom: price.effective_from.toISOString(),
    effectiveTo: price.effective_to?.toISOString() ?? null,
    status: price.status,
    createdAt: price.created_at.toISOString()
  };
}

function mapDamageRate(rate: ProductDetail["product_damage_rate"][number]) {
  return {
    damageRateId: rate.damage_rate_id.toString(),
    damageType: rate.damage_type,
    rate: rate.rate.toString(),
    effectiveFrom: rate.effective_from.toISOString(),
    effectiveTo: rate.effective_to?.toISOString() ?? null,
    status: rate.status,
    createdAt: rate.created_at.toISOString()
  };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly transactions: PrismaTenantTransactionService,
    private readonly repository: ProductsRepository
  ) {}

  list(context: AuthenticatedTenantContext, query: ListQueryDto) {
    return this.transactions.run(context, async (transaction) => pageResponse(
      (await this.repository.list(transaction, context.tenantId)).map(mapProduct), query
    ));
  }

  get(context: AuthenticatedTenantContext, productId: number) {
    return this.transactions.run(context, async (transaction) => {
      const product = await this.repository.find(transaction, context.tenantId, productId);
      if (product === null) throw new ApiError(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "The product was not found");
      return {
        ...mapProduct(product),
        prices: product.product_price.map(mapPrice),
        damageRates: product.product_damage_rate.map(mapDamageRate)
      };
    });
  }

  create(context: AuthenticatedTenantContext, input: CreateProductDto) {
    validateProductConfiguration(input.unitType, input.exchangeRatio);
    return this.transactions.run(context, async (transaction) => mapProduct(
      await this.repository.create(transaction, context.tenantId, context.userId, input)
    ));
  }

  createPrice(context: AuthenticatedTenantContext, productId: number, input: CreateProductPriceDto) {
    const period = parseEffectivePeriod(input.effectiveFrom, input.effectiveTo);
    return this.transactions.run(context, async (transaction) => {
      if (await this.repository.find(transaction, context.tenantId, productId) === null) {
        throw new ApiError(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "The product was not found");
      }
      await this.repository.lockHistory(transaction, `product-price:${context.tenantId}:${productId}`);
      if (await this.repository.hasPriceOverlap(
        transaction,
        context.tenantId,
        productId,
        period.effectiveFrom,
        period.effectiveTo
      ) !== null) {
        throw new ApiError(HttpStatus.CONFLICT, "PRODUCT_PRICE_PERIOD_OVERLAP", "The product already has an active price in this period");
      }
      return mapPrice(await this.repository.createPrice(
        transaction,
        context.tenantId,
        productId,
        context.userId,
        input.price,
        period.effectiveFrom,
        period.effectiveTo
      ));
    });
  }

  createDamageRate(context: AuthenticatedTenantContext, productId: number, input: CreateDamageRateDto) {
    const period = parseEffectivePeriod(input.effectiveFrom, input.effectiveTo);
    return this.transactions.run(context, async (transaction) => {
      if (await this.repository.find(transaction, context.tenantId, productId) === null) {
        throw new ApiError(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "The product was not found");
      }
      await this.repository.lockHistory(
        transaction,
        `damage-rate:${context.tenantId}:${productId}:${input.damageType}`
      );
      if (await this.repository.hasDamageRateOverlap(
        transaction,
        context.tenantId,
        productId,
        input.damageType,
        period.effectiveFrom,
        period.effectiveTo
      ) !== null) {
        throw new ApiError(HttpStatus.CONFLICT, "DAMAGE_RATE_PERIOD_OVERLAP", "The product already has an active damage rate of this type in this period");
      }
      return mapDamageRate(await this.repository.createDamageRate(transaction, context.tenantId, productId, context.userId, {
        damageType: input.damageType,
        rate: input.rate,
        ...period
      }));
    });
  }
}
