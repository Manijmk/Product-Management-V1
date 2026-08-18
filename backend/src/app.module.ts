import { DynamicModule, Module } from "@nestjs/common";
import type { Pool } from "pg";
import type { AppConfig } from "./config/env.js";
import { InfrastructureModule } from "./infrastructure/infrastructure.module.js";
import { HealthController } from "./health.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { UsersModule } from "./users/users.module.js";
import { StaffModule } from "./staff/staff.module.js";
import { ProductsModule } from "./products/products.module.js";
import { CustomersModule } from "./customers/customers.module.js";

@Module({})
export class AppModule {
  static register(config: AppConfig, pool: Pool): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfrastructureModule.register(config, pool),
        AuthModule.register(config),
        UsersModule,
        StaffModule,
        ProductsModule,
        CustomersModule
      ],
      controllers: [HealthController]
    };
  }
}
