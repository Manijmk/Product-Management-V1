import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class CreateRouteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(50)
  routeCode!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  routeName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
