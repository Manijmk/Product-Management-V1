import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class ListQueryDto {
  @ApiPropertyOptional({ type: Number, default: 50, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional({ type: Number, default: 0, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;

  @ApiPropertyOptional({ description: "Case-insensitive code/name search" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: "Exact resource status filter" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;
}

export interface PageResponse<T> {
  readonly items: readonly T[];
  readonly page: {
    readonly limit: number;
    readonly offset: number;
    readonly count: number;
    readonly total: number;
    readonly hasMore: boolean;
  };
}

export function pageResponse<T>(items: readonly T[], query: ListQueryDto): PageResponse<T> {
  const filtered = items.filter((item) => {
    if (query.status === undefined) return true;
    if (typeof item !== "object" || item === null) return false;
    const record = item as Readonly<Record<string, unknown>>;
    return record.status === query.status || record.activeStatus === query.status || record.customerStatus === query.status;
  });
  const searched = query.q === undefined
    ? filtered
    : filtered.filter((item) => JSON.stringify(item).toLowerCase().includes(query.q!.toLowerCase()));
  const itemsPage = searched.slice(query.offset, query.offset + query.limit);
  return {
    items: itemsPage,
    page: {
      limit: query.limit,
      offset: query.offset,
      count: itemsPage.length,
      total: searched.length,
      hasMore: query.offset + itemsPage.length < searched.length
    }
  };
}
