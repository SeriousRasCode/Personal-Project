import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import configuration from './config/configuration.js';
import { validateEnvironment } from './config/env.validation.js';
import { PrismaModule } from './database/prisma.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { HealthModule } from './health/health.module.js';
import { QueueModule } from './queues/queue.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ConsensusModule } from './modules/consensus/consensus.module.js';
import { GeographyModule } from './modules/geography/geography.module.js';
import { LeaksModule } from './modules/leaks/leaks.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { SchedulesModule } from './modules/schedules/schedules.module.js';
import { SmsUssdModule } from './modules/sms-ussd/sms-ussd.module.js';
import { StandpipesModule } from './modules/standpipes/standpipes.module.js';
import { TelemetryModule } from './modules/telemetry/telemetry.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { WorkOrdersModule } from './modules/work-orders/work-orders.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    PrismaModule,
    QueueModule,
    AuditModule,
    AuthModule,
    UsersModule,
    GeographyModule,
    SmsUssdModule,
    StandpipesModule,
    MaintenanceModule,
    TelemetryModule,
    SchedulesModule,
    ReportsModule,
    ConsensusModule,
    LeaksModule,
    WorkOrdersModule,
    NotificationsModule,
    OutboxModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
