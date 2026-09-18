import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsNumber, IsString, MaxLength, Min } from "class-validator";

export class CreateCashHandoverDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  toUserId!: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
}

export class DisputeCashHandoverDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  reason!: string;
}
