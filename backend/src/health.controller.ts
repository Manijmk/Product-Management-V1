import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Pool } from "pg";
import { PG_POOL } from "./infrastructure/tokens.js";
import { Public } from "./auth/auth.decorators.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  @Public()
  @ApiOkResponse({ schema: { example: { status: "ok", database: "reachable" } } })
  async health(): Promise<{ status: "ok"; database: "reachable" }> {
    await this.pool.query("SELECT 1");
    return { status: "ok", database: "reachable" };
  }
}
