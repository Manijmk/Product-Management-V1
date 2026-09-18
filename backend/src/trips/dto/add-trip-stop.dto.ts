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
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";
import {
  QUANTITY_MODES,
  TRIP_STOP_SOURCES,
  type QuantityMode,
  type TripStopSource
} from "../../operations/planning-rules.js";

export class AddTripStopProductDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  productId!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  partyProductId?: number;

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

export class AddTripStopDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  partyId!: number;

  @ApiProperty({ enum: TRIP_STOP_SOURCES })
  @IsEnum(TRIP_STOP_SOURCES)
  source!: TripStopSource;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  sortableOrder!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [AddTripStopProductDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AddTripStopProductDto)
  products!: AddTripStopProductDto[];
}
