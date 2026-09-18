import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { map, type Observable } from "rxjs";

interface PageResult {
  readonly items: readonly unknown[];
  readonly page: {
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
}

function isPageResult(value: unknown): value is PageResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PageResult>;
  return Array.isArray(candidate.items)
    && typeof candidate.page?.limit === "number"
    && typeof candidate.page.offset === "number"
    && typeof candidate.page.total === "number";
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value: unknown) => {
      if (isPageResult(value)) {
        const pageSize = value.page.limit;
        return {
          data: value.items,
          meta: {
            page: Math.floor(value.page.offset / pageSize) + 1,
            pageSize,
            total: value.page.total,
            totalPages: Math.ceil(value.page.total / pageSize)
          }
        };
      }
      return { data: value ?? null };
    }));
  }
}
