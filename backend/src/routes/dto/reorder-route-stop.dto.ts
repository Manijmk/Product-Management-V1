import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, Min } from "class-validator";

export class ReorderRouteStopDto {
  @ApiProperty({ example: 25 })
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  sortableOrder!: number;
}
