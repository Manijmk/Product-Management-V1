import { ApiProperty } from "@nestjs/swagger";
import { API_ERROR_CODES, type ApiErrorCode } from "./error-codes.js";

export class ApiErrorDetailDto {
  @ApiProperty({ enum: API_ERROR_CODES })
  code!: ApiErrorCode;

  @ApiProperty()
  message!: string;

  @ApiProperty({ type: "object", additionalProperties: true })
  details!: Readonly<Record<string, unknown>>;
}

export class ApiErrorResponseDto {
  @ApiProperty({ type: ApiErrorDetailDto })
  error!: ApiErrorDetailDto;
}
