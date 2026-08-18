import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from "class-validator";
import {
  CUSTOMER_CREATION_MODES,
  RELATIONSHIP_TYPES,
  type CustomerCreationMode,
  type RelationshipType
} from "../domain/customer-rules.js";

export class CreateCustomerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  partyCode?: string;

  @ApiProperty({ example: "ABC Shop" })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: RELATIONSHIP_TYPES })
  @IsEnum(RELATIONSHIP_TYPES)
  relationshipType!: RelationshipType;

  @ApiProperty({ enum: CUSTOMER_CREATION_MODES })
  @IsEnum(CUSTOMER_CREATION_MODES)
  creationMode!: CustomerCreationMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  mobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  alternateMobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  locality?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: string;
}
