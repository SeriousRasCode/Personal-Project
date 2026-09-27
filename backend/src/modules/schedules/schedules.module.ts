import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { SchedulesController } from './schedules.controller.js';
import { SchedulesService } from './schedules.service.js';

@Module({
  imports: [ConfigModule, PassportModule, PrismaModule],
  controllers: [SchedulesController],
  providers: [SchedulesService, JwtAuthGuard, RolesGuard],
  exports: [SchedulesService],
})
export class SchedulesModule {}
