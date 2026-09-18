import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedTenantContext } from "../tenancy/authenticated-tenant-context.js";
import { CurrentAuth, Public } from "./auth.decorators.js";
import { AuthService } from "./auth.service.js";
import { LoginDto } from "./dto/login.dto.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse()
  login(@Body() input: LoginDto) {
    return this.service.login(input);
  }

  @Get("me")
  @ApiBearerAuth()
  @ApiOkResponse()
  me(@CurrentAuth() context: AuthenticatedTenantContext) {
    return this.service.me(context);
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOkResponse()
  logout() {
    return this.service.logout();
  }
}
