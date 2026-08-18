import { DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import type { AppConfig } from "../config/env.js";
import { AuthenticationGuard } from "./authentication.guard.js";
import { AuthorizationGuard } from "./authorization.guard.js";

@Module({})
export class AuthModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AuthModule,
      imports: [JwtModule.register({
        global: true,
        secret: config.AUTH_JWT_SECRET,
        signOptions: {
          issuer: config.AUTH_JWT_ISSUER,
          audience: config.AUTH_JWT_AUDIENCE,
          expiresIn: "1h"
        },
        verifyOptions: {
          issuer: config.AUTH_JWT_ISSUER,
          audience: config.AUTH_JWT_AUDIENCE
        }
      })],
      providers: [
        { provide: APP_GUARD, useClass: AuthenticationGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard }
      ]
    };
  }
}
