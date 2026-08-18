import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsEnum, IsNumber, IsOptional, Min } from "class-validator";

export const DAMAGE_TYPES = ["DAMAGED", "BROKEN", "LOST"] as const;
export type DamageType = typeof DAMAGE_TYPES[number];

export class CreateDamageRateDto {
  @ApiProperty({ enum: DAMAGE_TYPES, example: "BROKEN" })
  @IsEnum(DAMAGE_TYPES)
  damageType!: DamageType;

  @ApiProperty({ example: 350 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rate!: number;

  @ApiProperty({ example: "2026-08-18T00:00:00+05:30" })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}
