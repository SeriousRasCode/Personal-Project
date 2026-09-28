import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { OutboxStatus } from '../../generated/prisma/enums.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  nextOutboxStatus,
  retryDelayFor,
  type OutboxRetryPolicy,
} from './outbox-policy.js';

export const OUTBOX_POLLER_ENABLED = 'outbox.pollerEnabled';

export interface OutboxDispatchResult {
  claimed: number;
  processed: number;
  retried: number;
  failed: number;
}

interface ClaimedEvent {
  id: string;
  eventType: string;
  payload: unknown;
}

const MAX_ERROR_LENGTH = 2_000;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error === null || error === undefined) {
    return 'unknown error';
  }
  return JSON.stringify(error);
}

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private number(key: string, fallback: number): number {
    const value = this.configService.get<number>(key);
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private policy(): OutboxRetryPolicy {
    return {
      maxAttempts: this.number('outbox.maxAttempts', 5),
      retryBaseMs: this.number('outbox.retryBaseMs', 1_000),
    };
  }

  onModuleInit(): void {
    if (this.configService.get<boolean>(OUTBOX_POLLER_ENABLED) === false) {
      this.logger.log('Outbox poller is disabled by configuration');
      return;
    }

    const intervalMs = this.number('outbox.pollIntervalMs', 5_000);
    this.timer = setInterval(() => {
      void this.dispatchOnce();
    }, intervalMs);
    this.timer.unref();
    this.logger.log(`Outbox poller started with a ${intervalMs}ms interval`);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async releaseStuckEvents(now: Date = new Date()): Promise<number> {
    const lockTimeoutMs = this.number('outbox.lockTimeoutMs', 60_000);

    const result = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE outbox_events
      SET status = ${OutboxStatus.PENDING}::"OutboxStatus",
          available_at = ${now},
          last_error = 'Released after a stale processing lock'
      WHERE status = ${OutboxStatus.PROCESSING}::"OutboxStatus"
        AND available_at < ${new Date(now.getTime() - lockTimeoutMs)}
    `);

    return result;
  }

  private async claimBatch(now: Date, limit: number): Promise<ClaimedEvent[]> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<ClaimedEvent[]>(Prisma.sql`
        SELECT id, event_type AS "eventType", payload
        FROM outbox_events
        WHERE status = ${OutboxStatus.PENDING}::"OutboxStatus"
          AND available_at <= ${now}
        ORDER BY available_at ASC, created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);

      if (claimed.length === 0) {
        return [];
      }

      const ids = claimed.map((event) => event.id);
      await tx.$executeRaw(Prisma.sql`
        UPDATE outbox_events
        SET status = ${OutboxStatus.PROCESSING}::"OutboxStatus",
            available_at = ${now},
            attempts = attempts + 1
        WHERE id IN (${Prisma.join(ids)})
      `);

      return claimed;
    });
  }

  private isMissingRow(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2025'
    );
  }

  private async settleSuccess(id: string, now: Date): Promise<void> {
    try {
      await this.prisma.outboxEvent.update({
        where: { id },
        data: {
          status: OutboxStatus.PROCESSED,
          processedAt: now,
          lastError: null,
        },
      });
    } catch (error: unknown) {
      if (!this.isMissingRow(error)) {
        throw error;
      }
      this.logger.warn(
        `Outbox event ${id} vanished before it could be settled`,
      );
    }
  }

  private async settleFailure(
    id: string,
    error: unknown,
    now: Date,
  ): Promise<OutboxStatus> {
    const policy = this.policy();

    try {
      const event = await this.prisma.outboxEvent.findUnique({
        where: { id },
        select: { attempts: true },
      });

      const attempts = event?.attempts ?? policy.maxAttempts;
      const status = nextOutboxStatus(attempts, policy.maxAttempts);
      const message = describeError(error);

      await this.prisma.outboxEvent.update({
        where: { id },
        data: {
          status,
          availableAt: retryDelayFor(now, attempts, policy),
          lastError: message.slice(0, MAX_ERROR_LENGTH),
        },
      });

      return status;
    } catch (updateError: unknown) {
      if (!this.isMissingRow(updateError)) {
        throw updateError;
      }
      this.logger.warn(
        `Outbox event ${id} vanished before its failure could be recorded`,
      );
      return OutboxStatus.PROCESSED;
    }
  }

  async dispatchOnce(now: Date = new Date()): Promise<OutboxDispatchResult> {
    if (this.running || this.stopped) {
      return { claimed: 0, processed: 0, retried: 0, failed: 0 };
    }

    this.running = true;
    const limit = this.number('outbox.batchSize', 50);

    try {
      await this.releaseStuckEvents(now);
      const events = await this.claimBatch(now, limit);
      const result: OutboxDispatchResult = {
        claimed: events.length,
        processed: 0,
        retried: 0,
        failed: 0,
      };

      for (const event of events) {
        try {
          await this.notifications.handleOutboxEvent(event, now);
          await this.settleSuccess(event.id, now);
          result.processed += 1;
        } catch (error: unknown) {
          const status = await this.settleFailure(event.id, error, now);
          if (status === OutboxStatus.PENDING) {
            result.retried += 1;
          } else {
            result.failed += 1;
          }
          this.logger.warn(
            `Outbox event ${event.id} (${event.eventType}) failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      return result;
    } finally {
      this.running = false;
    }
  }
}
