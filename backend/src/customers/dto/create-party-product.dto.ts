import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsInt, IsNumber, IsOptional, Min } from "class-validator";
import {
  EXCHANGE_POLICIES,
  QUANTITY_MODES,
  type ExchangePolicy,
  type QuantityMode
} from "../domain/customer-rules.js";

export class CreatePartyProductDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(1)
  productId!: number;

  @ApiProperty({ enum: QUANTITY_MODES })
  @IsEnum(QUANTITY_MODES)
  quantityMode!: QuantityMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  defaultQty?: number;

  @ApiPropertyOptional({ description: "Planning-only quantity; never an execution actual" })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  forecastQty?: number;

  @ApiPropertyOptional({ enum: EXCHANGE_POLICIES })
  @IsOptional()
  @IsEnum(EXCHANGE_POLICIES)
  exchangePolicy?: ExchangePolicy;
}
