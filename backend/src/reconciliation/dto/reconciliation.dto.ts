import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateReconciliationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class SubmitStockCountDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  inventoryLocationId!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  productId!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  inventoryStateId!: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  actualQty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  varianceReasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  varianceNotes?: string;
}

export class SubmitCashCountDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  staffId!: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  actualCash!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  varianceReasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  varianceNotes?: string;
}

export class ResolveExceptionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1500)
  resolutionNotes!: string;
}
