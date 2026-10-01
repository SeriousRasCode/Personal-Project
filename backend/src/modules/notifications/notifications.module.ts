import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SmsUssdModule } from '../sms-ussd/sms-ussd.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [AuthModule, SmsUssdModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
