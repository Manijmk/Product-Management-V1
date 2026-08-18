import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateStaffDto {
  @ApiPropertyOptional({ description: "Optional AppUser login linkage" })
  @IsOptional()
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  employeeCode?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  mobile?: string;

  @ApiProperty({ example: "DELIVERY_STAFF" })
  @IsString()
  @MaxLength(50)
  staffType!: string;

  @ApiPropertyOptional({ example: "2026-08-18" })
  @IsOptional()
  @IsDateString({ strict: true })
  joinedOn?: string;
}
