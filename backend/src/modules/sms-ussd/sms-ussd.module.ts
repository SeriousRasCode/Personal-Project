import { Module } from '@nestjs/common';
import { SmsService } from './sms/sms.service.js';
import { UssdController } from './ussd/ussd.controller.js';
import { UssdService } from './ussd/ussd.service.js';

@Module({
  controllers: [UssdController],
  providers: [SmsService, UssdService],
  exports: [SmsService, UssdService],
})
export class SmsUssdModule {}
