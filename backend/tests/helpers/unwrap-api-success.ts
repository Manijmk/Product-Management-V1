interface JsonResponse {
  json<T = unknown>(): T;
}

interface ApiEnvelope {
  readonly data: unknown;
  readonly meta?: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

export function unwrapApiSuccess<T extends JsonResponse>(response: T): T {
  const body = response.json<unknown>();
  if (typeof body !== "object" || body === null || !("data" in body)) return response;
  const envelope = body as ApiEnvelope;
  const value = envelope.meta === undefined || !Array.isArray(envelope.data)
    ? envelope.data
    : {
        items: envelope.data,
        page: {
          limit: envelope.meta.pageSize,
          offset: (envelope.meta.page - 1) * envelope.meta.pageSize,
          count: envelope.data.length,
          total: envelope.meta.total,
          hasMore: envelope.meta.page < envelope.meta.totalPages
        }
      };
  Object.defineProperty(response, "json", { value: () => value });
  return response;
}
