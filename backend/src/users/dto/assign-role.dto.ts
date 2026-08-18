import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Min } from "class-validator";

export class AssignRoleDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  roleId!: number;
}
