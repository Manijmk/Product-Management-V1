import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";

export const STOP_EVENT_TYPES = ["DELIVERY", "COLLECTION_ONLY", "RETURN_ONLY", "DAMAGE", "REPLACEMENT"] as const;
export type StopEventType = (typeof STOP_EVENT_TYPES)[number];

export const QUANTITY_MODES = ["FIXED_PLANNED", "RETURN_MATCHED", "AD_HOC"] as const;
export type StopQuantityMode = (typeof QUANTITY_MODES)[number];

export const DAMAGE_RESOLUTIONS = [
  "CHARGE_DAMAGE",
  "ACCEPT_DAMAGE_WITHOUT_CHARGE",
  "REJECT_DAMAGE"
] as const;
export type DamageResolution = (typeof DAMAGE_RESOLUTIONS)[number];

export const EXCESS_EMPTY_RESOLUTIONS = ["ACCEPT_AS_CREDIT", "ACCEPT_ONLY_REPLACED"] as const;
export type ExcessEmptyResolution = (typeof EXCESS_EMPTY_RESOLUTIONS)[number];

export const PAYMENT_METHODS = ["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "WALLET", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class StopPriceOverrideDto {
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  requestedPrice!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class StopEventProductDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  tripStopProductId!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  productId!: number;

  @ApiPropertyOptional({ enum: QUANTITY_MODES })
  @IsOptional()
  @IsEnum(QUANTITY_MODES)
  quantityMode?: StopQuantityMode;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  goodEmptyQty = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  damagedEmptyQty = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  rejectedEmptyQty = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  fullQtyDelivered = 0;

  @ApiPropertyOptional({ enum: DAMAGE_RESOLUTIONS })
  @IsOptional()
  @IsEnum(DAMAGE_RESOLUTIONS)
  damageResolution?: DamageResolution;

  @ApiPropertyOptional({ enum: EXCESS_EMPTY_RESOLUTIONS })
  @IsOptional()
  @IsEnum(EXCESS_EMPTY_RESOLUTIONS)
  excessEmptyResolution?: ExcessEmptyResolution;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  authorizeContainerDue?: boolean;

  @ApiPropertyOptional({ type: StopPriceOverrideDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StopPriceOverrideDto)
  priceOverride?: StopPriceOverrideDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class StopPaymentDto {
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsEnum(PAYMENT_METHODS)
  paymentMethod!: PaymentMethod;
}

export class CreateStopEventDto {
  @ApiProperty()
  @IsUUID()
  clientUuid!: string;

  @ApiProperty()
  @IsDateString()
  eventTime!: string;

  @ApiPropertyOptional({ enum: STOP_EVENT_TYPES, default: "DELIVERY" })
  @IsOptional()
  @IsEnum(STOP_EVENT_TYPES)
  eventType: StopEventType = "DELIVERY";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  deviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [StopEventProductDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StopEventProductDto)
  products!: StopEventProductDto[];

  @ApiPropertyOptional({ type: [StopPaymentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StopPaymentDto)
  payments: StopPaymentDto[] = [];
}
