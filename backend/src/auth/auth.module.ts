import { DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import type { AppConfig } from "../config/env.js";
import { AuthenticationGuard } from "./authentication.guard.js";
import { AuthorizationGuard } from "./authorization.guard.js";
import { AuthController } from "./auth.controller.js";
import { AuthRepository } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";

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
          expiresIn: "30m"
        },
        verifyOptions: {
          issuer: config.AUTH_JWT_ISSUER,
          audience: config.AUTH_JWT_AUDIENCE
        }
      })],
      controllers: [AuthController],
      providers: [
        AuthRepository,
        AuthService,
        { provide: APP_GUARD, useClass: AuthenticationGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard }
      ]
    };
  }
}
