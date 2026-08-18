import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";
import { PRODUCT_UNIT_TYPES, type ProductUnitType } from "../domain/product-rules.js";

export class CreateProductDto {
  @ApiProperty({ example: "CAN20" })
  @IsString()
  @MaxLength(50)
  productCode!: string;

  @ApiProperty({ example: "20L Water Can" })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: PRODUCT_UNIT_TYPES })
  @IsEnum(PRODUCT_UNIT_TYPES)
  unitType!: ProductUnitType;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  exchangeRatio?: number;
}
