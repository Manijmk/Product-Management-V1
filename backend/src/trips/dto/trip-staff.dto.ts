import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsEnum, IsInt, IsOptional, Min } from "class-validator";

export const TRIP_STAFF_ROLES = ["DRIVER", "DELIVERY_STAFF", "HELPER", "RELIEVER"] as const;
export type TripStaffRole = typeof TRIP_STAFF_ROLES[number];

export class AddTripStaffDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  staffId!: number;

  @ApiProperty({ enum: TRIP_STAFF_ROLES })
  @IsEnum(TRIP_STAFF_ROLES)
  tripRole!: TripStaffRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  joinedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  leftAt?: string;
}
