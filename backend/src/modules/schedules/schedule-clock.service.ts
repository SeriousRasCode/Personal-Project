import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { SchedulesService } from './schedules.service.js';
@Injectable()
export class ScheduleClock implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(ScheduleClock.name);
  constructor(private readonly schedules: SchedulesService) {}
  onModuleInit() {
    if (process.env.SCHEDULE_CLOCK_ENABLED === 'false') return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 10_000);
    this.timer.unref();
    void this.tick();
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.schedules.reconcileDueWindows();
    } catch (error) {
      this.logger.error(
        `Schedule clock will retry: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
