import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../http/api-error.js";
import { type ListQueryDto, pageResponse } from "../http/list-query.dto.js";
import { parseEffectivePeriod } from "../products/domain/product-rules.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { PrismaTenantTransactionService } from "../tenancy/prisma-tenant-transaction.service.js";
import { customerCreationState, validatePartyProduct } from "./domain/customer-rules.js";
import type { CreateCustomerDto } from "./dto/create-customer.dto.js";
import type { CreateCustomerPriceDto } from "./dto/create-customer-price.dto.js";
import type { CreatePartyProductDto } from "./dto/create-party-product.dto.js";
import { CustomersRepository } from "./customers.repository.js";

type CustomerSummary = Awaited<ReturnType<CustomersRepository["list"]>>[number];
type CustomerDetail = NonNullable<Awaited<ReturnType<CustomersRepository["find"]>>>;

function mapCustomer(customer: CustomerSummary) {
  return {
    partyId: customer.partyId.toString(),
    partyCode: customer.party_code,
    name: customer.name,
    relationshipType: customer.relationshipType,
    mobile: customer.mobile,
    customerStatus: customer.customerStatus,
    createdSource: customer.createdSource,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString()
  };
}

function mapPartyProduct(configuration: CustomerDetail["party_product"][number]) {
  return {
    partyProductId: configuration.party_product_id.toString(),
    productId: configuration.product_id.toString(),
    productCode: configuration.product.productCode,
    productName: configuration.product.name,
    quantityMode: configuration.quantity_mode,
    defaultQty: configuration.default_qty?.toString() ?? null,
    forecastQty: configuration.forecast_qty?.toString() ?? null,
    exchangePolicy: configuration.exchange_policy,
    activeStatus: configuration.active_status,
    createdAt: configuration.created_at.toISOString(),
    updatedAt: configuration.updated_at.toISOString()
  };
}

function mapCustomerPrice(price: CustomerDetail["party_product_price"][number]) {
  return {
    partyProductPriceId: price.party_product_price_id.toString(),
    productId: price.product_id.toString(),
    price: price.price.toString(),
    effectiveFrom: price.effective_from.toISOString(),
    effectiveTo: price.effective_to?.toISOString() ?? null,
    approvalStatus: price.approval_status,
    approvedByUserId: price.approved_by_user_id?.toString() ?? null,
    approvedAt: price.approved_at?.toISOString() ?? null,
    createdAt: price.created_at.toISOString()
  };
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly transactions: PrismaTenantTransactionService,
    private readonly repository: CustomersRepository
  ) {}

  list(context: AuthenticatedTenantContext, query: ListQueryDto) {
    return this.transactions.run(context, async (transaction) => pageResponse(
      (await this.repository.list(transaction, context.tenantId)).map(mapCustomer), query
    ));
  }

  get(context: AuthenticatedTenantContext, partyId: number) {
    return this.transactions.run(context, async (transaction) => {
      const customer = await this.repository.find(transaction, context.tenantId, partyId);
      if (customer === null) throw new ApiError(HttpStatus.NOT_FOUND, "CUSTOMER_NOT_FOUND", "The customer was not found");
      return {
        ...mapCustomer(customer),
        alternateMobile: customer.alternate_mobile,
        addressLine1: customer.address_line1,
        addressLine2: customer.address_line2,
        locality: customer.locality,
        city: customer.city,
        postalCode: customer.postal_code,
        latitude: customer.latitude?.toString() ?? null,
        longitude: customer.longitude?.toString() ?? null,
        createdByUserId: customer.createdByUserId?.toString() ?? null,
        approvedByUserId: customer.approvedByUserId?.toString() ?? null,
        approvedAt: customer.approvedAt?.toISOString() ?? null,
        products: customer.party_product.map(mapPartyProduct),
        prices: customer.party_product_price.map(mapCustomerPrice)
      };
    });
  }

  create(context: AuthenticatedTenantContext, input: CreateCustomerDto) {
    const state = customerCreationState(context, input.creationMode);
    return this.transactions.run(context, async (transaction) => mapCustomer(
      await this.repository.create(transaction, context.tenantId, context.userId, { ...input, ...state })
    ));
  }

  approve(context: AuthenticatedTenantContext, partyId: number) {
    return this.transactions.run(context, async (transaction) => {
      const customer = await this.repository.find(transaction, context.tenantId, partyId);
      if (customer === null) throw new ApiError(HttpStatus.NOT_FOUND, "CUSTOMER_NOT_FOUND", "The customer was not found");
      if (customer.customerStatus !== "PENDING_APPROVAL") {
        throw new ApiError(HttpStatus.CONFLICT, "CUSTOMER_NOT_PENDING_APPROVAL", "Only a pending customer can be approved");
      }
      if (customer.createdByUserId === BigInt(context.userId)) {
        throw new ApiError(HttpStatus.FORBIDDEN, "SELF_APPROVAL_NOT_ALLOWED", "A user cannot approve their own permanent customer creation");
      }
      return mapCustomer(await this.repository.approve(transaction, context.tenantId, partyId, context.userId));
    });
  }

  addProduct(context: AuthenticatedTenantContext, partyId: number, input: CreatePartyProductDto) {
    validatePartyProduct(input.quantityMode, input.defaultQty, input.forecastQty);
    return this.transactions.run(context, async (transaction) => {
      const [customer, product] = await Promise.all([
        this.repository.find(transaction, context.tenantId, partyId),
        this.repository.findProduct(transaction, context.tenantId, input.productId)
      ]);
      if (customer === null) throw new ApiError(HttpStatus.NOT_FOUND, "CUSTOMER_NOT_FOUND", "The customer was not found");
      if (product === null) throw new ApiError(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "The product was not found");
      return mapPartyProduct(await this.repository.createPartyProduct(
        transaction,
        context.tenantId,
        partyId,
        context.userId,
        input
      ));
    });
  }

  createPrice(
    context: AuthenticatedTenantContext,
    partyId: number,
    productId: number,
    input: CreateCustomerPriceDto
  ) {
    const period = parseEffectivePeriod(input.effectiveFrom, input.effectiveTo);
    return this.transactions.run(context, async (transaction) => {
      const [customer, product, configuration] = await Promise.all([
        this.repository.find(transaction, context.tenantId, partyId),
        this.repository.findProduct(transaction, context.tenantId, productId),
        this.repository.findPartyProduct(transaction, context.tenantId, partyId, productId)
      ]);
      if (customer === null) throw new ApiError(HttpStatus.NOT_FOUND, "CUSTOMER_NOT_FOUND", "The customer was not found");
      if (product === null) throw new ApiError(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "The product was not found");
      if (configuration === null) {
        throw new ApiError(HttpStatus.CONFLICT, "PARTY_PRODUCT_NOT_CONFIGURED", "Configure this product for the customer before adding a customer-specific price");
      }
      await this.repository.lockPriceHistory(
        transaction,
        `customer-price:${context.tenantId}:${partyId}:${productId}`
      );
      if (await this.repository.hasPriceOverlap(
        transaction,
        context.tenantId,
        partyId,
        productId,
        period.effectiveFrom,
        period.effectiveTo
      ) !== null) {
        throw new ApiError(HttpStatus.CONFLICT, "CUSTOMER_PRICE_PERIOD_OVERLAP", "The customer already has an approved price for this product in this period");
      }
      return mapCustomerPrice(await this.repository.createPrice(
        transaction,
        context.tenantId,
        partyId,
        productId,
        context.userId,
        input.price,
        period.effectiveFrom,
        period.effectiveTo
      ));
    });
  }
}
