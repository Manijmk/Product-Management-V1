import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";
import { QUANTITY_MODES, type QuantityMode } from "../../operations/planning-rules.js";

export class CreateRouteStopProductDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  partyProductId!: number;

  @ApiProperty({ enum: QUANTITY_MODES })
  @IsEnum(QUANTITY_MODES)
  quantityMode!: QuantityMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  plannedQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  forecastQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateRouteStopDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  partyId!: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  defaultSequence!: number;

  @ApiPropertyOptional({ example: "09:00" })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  preferredTimeFrom?: string;

  @ApiPropertyOptional({ example: "11:00" })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  preferredTimeTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [CreateRouteStopProductDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateRouteStopProductDto)
  products!: CreateRouteStopProductDto[];
}
