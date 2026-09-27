import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module.js';
import { PasswordService } from '../../common/auth/password.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuditModule, PassportModule],
  controllers: [UsersController],
  providers: [UsersService, PasswordService, JwtAuthGuard, RolesGuard],
  exports: [UsersService, PasswordService, JwtAuthGuard, RolesGuard],
})
export class UsersModule {}
