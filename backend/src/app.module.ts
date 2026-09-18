import { DynamicModule, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import type { Pool } from "pg";
import type { AppConfig } from "./config/env.js";
import { InfrastructureModule } from "./infrastructure/infrastructure.module.js";
import { HealthController } from "./health.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { UsersModule } from "./users/users.module.js";
import { StaffModule } from "./staff/staff.module.js";
import { ProductsModule } from "./products/products.module.js";
import { CustomersModule } from "./customers/customers.module.js";
import { RoutesModule } from "./routes/routes.module.js";
import { VehiclesModule } from "./vehicles/vehicles.module.js";
import { TripsModule } from "./trips/trips.module.js";
import { StopEventsModule } from "./stop-events/stop-events.module.js";
import { ReconciliationModule } from "./reconciliation/reconciliation.module.js";
import { ApiResponseInterceptor } from "./http/api-response.interceptor.js";

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
        CustomersModule,
        RoutesModule,
        VehiclesModule,
        TripsModule,
        StopEventsModule,
        ReconciliationModule
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor }]
    };
  }
}
