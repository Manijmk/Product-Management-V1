import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

export const FOLLOW_UP_RESOLUTIONS = ["FOLLOW_UP", "CANCELLED"] as const;
export type FollowUpResolution = (typeof FOLLOW_UP_RESOLUTIONS)[number];

export class CreateFollowUpDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  productId!: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  remainingQty!: number;

  @ApiProperty({ enum: FOLLOW_UP_RESOLUTIONS })
  @IsEnum(FOLLOW_UP_RESOLUTIONS)
  resolutionType!: FollowUpResolution;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
