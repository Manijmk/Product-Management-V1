import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";

export const VEHICLE_STATUSES = ["ACTIVE", "IN_SERVICE", "BREAKDOWN", "RETIRED", "INACTIVE"] as const;
export const OWNERSHIP_TYPES = ["OWNED", "RENTED", "LEASED", "THIRD_PARTY"] as const;

export class CreateVehicleDto {
  @ApiProperty()
  @IsString()
  @MaxLength(50)
  registrationNo!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  vehicleType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  capacityUnit?: string;

  @ApiPropertyOptional({ enum: OWNERSHIP_TYPES, default: "OWNED" })
  @IsOptional()
  @IsEnum(OWNERSHIP_TYPES)
  ownershipType?: typeof OWNERSHIP_TYPES[number];

  @ApiPropertyOptional({ enum: VEHICLE_STATUSES, default: "ACTIVE" })
  @IsOptional()
  @IsEnum(VEHICLE_STATUSES)
  status?: typeof VEHICLE_STATUSES[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
