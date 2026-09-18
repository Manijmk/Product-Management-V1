import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "ACME" })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  tenantCode!: string;

  @ApiProperty({ example: "owner@example.com" })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  loginIdentity!: string;

  @ApiProperty({ writeOnly: true, minLength: 8, maxLength: 256 })
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password!: string;
}
