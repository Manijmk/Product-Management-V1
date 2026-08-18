import { Module } from "@nestjs/common";
import { UsersRepository } from "../users/users.repository.js";
import { StaffController } from "./staff.controller.js";
import { StaffRepository } from "./staff.repository.js";
import { StaffService } from "./staff.service.js";

@Module({
  controllers: [StaffController],
  providers: [StaffRepository, StaffService, UsersRepository]
})
export class StaffModule {}
