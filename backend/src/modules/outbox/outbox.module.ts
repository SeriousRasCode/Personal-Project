import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { OutboxController } from './outbox.controller.js';

@Module({
  imports: [NotificationsModule],
  providers: [OutboxDispatcherService],
  controllers: [OutboxController],
  exports: [OutboxDispatcherService],
})
export class OutboxModule {}
