import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators.js";
import { ADMINISTRATIVE_ROLES, MASTER_DATA_ROLES } from "../auth/roles.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { ListQueryDto } from "../http/list-query.dto.js";
import { CreateCustomerDto } from "./dto/create-customer.dto.js";
import { CreateCustomerPriceDto } from "./dto/create-customer-price.dto.js";
import { CreatePartyProductDto } from "./dto/create-party-product.dto.js";
import { CustomersService } from "./customers.service.js";

@ApiTags("customers")
@ApiBearerAuth()
@Controller("customers")
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  list(@CurrentAuth() context: AuthenticatedTenantContext, @Query() query: ListQueryDto) {
    return this.service.list(context, query);
  }

  @Post()
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiCreatedResponse()
  create(@CurrentAuth() context: AuthenticatedTenantContext, @Body() input: CreateCustomerDto) {
    return this.service.create(context, input);
  }

  @Get(":partyId")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  get(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("partyId", ParseIntPipe) partyId: number
  ) {
    return this.service.get(context, partyId);
  }

  @Post(":partyId/approve")
  @HttpCode(200)
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiOkResponse()
  approve(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("partyId", ParseIntPipe) partyId: number
  ) {
    return this.service.approve(context, partyId);
  }

  @Post(":partyId/products")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiCreatedResponse()
  addProduct(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("partyId", ParseIntPipe) partyId: number,
    @Body() input: CreatePartyProductDto
  ) {
    return this.service.addProduct(context, partyId, input);
  }

  @Post(":partyId/products/:productId/prices")
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiCreatedResponse()
  createPrice(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("partyId", ParseIntPipe) partyId: number,
    @Param("productId", ParseIntPipe) productId: number,
    @Body() input: CreateCustomerPriceDto
  ) {
    return this.service.createPrice(context, partyId, productId, input);
  }
}
