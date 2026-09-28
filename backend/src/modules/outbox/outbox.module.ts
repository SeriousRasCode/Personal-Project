import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';

@Module({
  imports: [NotificationsModule],
  providers: [OutboxDispatcherService],
  exports: [OutboxDispatcherService],
})
export class OutboxModule {}
