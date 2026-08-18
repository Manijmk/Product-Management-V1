import { Body, Controller, Get, Param, ParseIntPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth, RequireRoles } from "../auth/auth.decorators.js";
import { ADMINISTRATIVE_ROLES, MASTER_DATA_ROLES } from "../auth/roles.js";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { CreateDamageRateDto } from "./dto/create-damage-rate.dto.js";
import { CreateProductPriceDto } from "./dto/create-product-price.dto.js";
import { CreateProductDto } from "./dto/create-product.dto.js";
import { ProductsService } from "./products.service.js";

@ApiTags("products")
@ApiBearerAuth()
@Controller("products")
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  list(@CurrentAuth() context: AuthenticatedTenantContext) {
    return this.service.list(context);
  }

  @Post()
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiCreatedResponse()
  create(@CurrentAuth() context: AuthenticatedTenantContext, @Body() input: CreateProductDto) {
    return this.service.create(context, input);
  }

  @Get(":productId")
  @RequireRoles(...MASTER_DATA_ROLES)
  @ApiOkResponse()
  get(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("productId", ParseIntPipe) productId: number
  ) {
    return this.service.get(context, productId);
  }

  @Post(":productId/prices")
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiCreatedResponse()
  createPrice(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("productId", ParseIntPipe) productId: number,
    @Body() input: CreateProductPriceDto
  ) {
    return this.service.createPrice(context, productId, input);
  }

  @Post(":productId/damage-rates")
  @RequireRoles(...ADMINISTRATIVE_ROLES)
  @ApiCreatedResponse()
  createDamageRate(
    @CurrentAuth() context: AuthenticatedTenantContext,
    @Param("productId", ParseIntPipe) productId: number,
    @Body() input: CreateDamageRateDto
  ) {
    return this.service.createDamageRate(context, productId, input);
  }
}
