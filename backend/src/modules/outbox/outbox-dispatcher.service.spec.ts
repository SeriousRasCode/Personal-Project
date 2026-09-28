import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../database/prisma.service.js';
import { OutboxStatus } from '../../generated/prisma/enums.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  OUTBOX_POLLER_ENABLED,
  OutboxDispatcherService,
} from './outbox-dispatcher.service.js';

const eventId = '00000000-0000-0000-0000-0000000000aa';

interface HarnessOptions {
  pollerEnabled?: boolean;
  config?: Record<string, unknown>;
  claimed?: { id: string; eventType: string; payload: unknown }[];
  attempts?: number;
  updateErrors?: Record<string, Error>;
}

function createHarness(options: HarnessOptions = {}) {
  const claimed = options.claimed ?? [];
  const attempts = options.attempts ?? 1;
  const values: Record<string, unknown> = {
    [OUTBOX_POLLER_ENABLED]: options.pollerEnabled ?? true,
    'outbox.pollIntervalMs': 5_000,
    'outbox.batchSize': 50,
    'outbox.maxAttempts': 5,
    'outbox.retryBaseMs': 1_000,
    'outbox.lockTimeoutMs': 60_000,
    ...options.config,
  };

  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const executeRaw = vi.fn(() => 0);
  const transaction = vi.fn((fn: (tx: PrismaService) => Promise<unknown>) =>
    fn(prisma),
  );

  const prisma = {
    $executeRaw: executeRaw,
    $transaction: transaction,
    outboxEvent: {
      update: vi.fn((args: { id: string; data: Record<string, unknown> }) => {
        const failure = options.updateErrors?.[args.id];
        if (failure !== undefined) {
          return Promise.reject(failure);
        }
        updates.push({ id: args.id, data: args.data });
        return Promise.resolve(args.data);
      }),
      findUnique: vi.fn(() => ({ attempts })),
    },
  } as unknown as PrismaService;

  const notifications = {
    handleOutboxEvent: vi.fn(() => 1),
  } as unknown as NotificationsService;

  const configService = {
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService;

  const dispatcher = new OutboxDispatcherService(
    prisma,
    configService,
    notifications,
  );

  transaction.mockImplementation(
    (fn: (tx: PrismaService) => Promise<unknown>) =>
      fn({
        $queryRaw: vi.fn(() => claimed),
        $executeRaw: executeRaw,
      } as unknown as PrismaService),
  );

  return { dispatcher, notifications, prisma, updates, executeRaw };
}

describe('OutboxDispatcherService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start a timer when the poller is disabled', () => {
    const harness = createHarness({ pollerEnabled: false });
    const setInterval = vi.spyOn(globalThis, 'setInterval');

    harness.dispatcher.onModuleInit();

    expect(setInterval).not.toHaveBeenCalled();
    setInterval.mockRestore();
  });

  it("polls on an unref'd interval when enabled", () => {
    const harness = createHarness({ pollerEnabled: true });
    const setInterval = vi.spyOn(globalThis, 'setInterval');

    harness.dispatcher.onModuleInit();

    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 5_000);
    const timer = setInterval.mock.results[0]?.value as { unref?: () => void };
    expect(timer?.unref).toBeDefined();
    setInterval.mockRestore();
  });

  it('stops polling after shutdown', () => {
    const harness = createHarness();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    harness.dispatcher.onModuleInit();
    harness.dispatcher.onModuleDestroy();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('does nothing once the module has been destroyed', async () => {
    const harness = createHarness();
    harness.dispatcher.onModuleDestroy();

    await expect(harness.dispatcher.dispatchOnce()).resolves.toEqual({
      claimed: 0,
      processed: 0,
      retried: 0,
      failed: 0,
    });
    expect(harness.notifications.handleOutboxEvent).not.toHaveBeenCalled();
  });

  it('returns an empty result when the queue is empty', async () => {
    const harness = createHarness({ claimed: [] });

    await expect(harness.dispatcher.dispatchOnce()).resolves.toEqual({
      claimed: 0,
      processed: 0,
      retried: 0,
      failed: 0,
    });
  });

  it('marks a handled event as processed', async () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const harness = createHarness({
      claimed: [{ id: eventId, eventType: 'leak.reported', payload: {} }],
    });

    const result = await harness.dispatcher.dispatchOnce(now);

    expect(result).toEqual({
      claimed: 1,
      processed: 1,
      retried: 0,
      failed: 0,
    });
    expect(harness.notifications.handleOutboxEvent).toHaveBeenCalledWith(
      { id: eventId, eventType: 'leak.reported', payload: {} },
      now,
    );
    expect(harness.updates[0]?.data).toEqual({
      status: OutboxStatus.PROCESSED,
      processedAt: now,
      lastError: null,
    });
  });

  it('reschedules a failing event with backoff', async () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const harness = createHarness({
      claimed: [{ id: eventId, eventType: 'leak.reported', payload: {} }],
      attempts: 1,
    });
    (
      harness.notifications.handleOutboxEvent as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error('nope'));

    const result = await harness.dispatcher.dispatchOnce(now);

    expect(result).toEqual({
      claimed: 1,
      processed: 0,
      retried: 1,
      failed: 0,
    });
    const data = harness.updates[0]?.data as {
      status: OutboxStatus;
      availableAt: Date;
      lastError: string;
    };
    expect(data.status).toBe(OutboxStatus.PENDING);
    expect(data.lastError).toBe('nope');
    expect(data.availableAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('fails an event that exhausts its attempts', async () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const harness = createHarness({
      claimed: [{ id: eventId, eventType: 'leak.reported', payload: {} }],
      attempts: 5,
    });
    (
      harness.notifications.handleOutboxEvent as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce('a string failure');

    const result = await harness.dispatcher.dispatchOnce(now);

    expect(result.failed).toBe(1);
    expect(result.retried).toBe(0);
    expect((harness.updates[0]?.data as { status: OutboxStatus }).status).toBe(
      OutboxStatus.FAILED,
    );
    expect((harness.updates[0]?.data as { lastError: string }).lastError).toBe(
      'a string failure',
    );
  });

  it('skips a second concurrent dispatch', async () => {
    const harness = createHarness({
      claimed: [{ id: eventId, eventType: 'leak.reported', payload: {} }],
    });
    (
      harness.notifications.handleOutboxEvent as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(async () => {
      const nested = await harness.dispatcher.dispatchOnce();
      expect(nested.claimed).toBe(0);
      return 1;
    });

    const result = await harness.dispatcher.dispatchOnce();

    expect(result.processed).toBe(1);
  });

  it('releases stale processing locks using the configured timeout', async () => {
    const harness = createHarness({ claimed: [] });

    await harness.dispatcher.releaseStuckEvents();

    expect(harness.executeRaw).toHaveBeenCalledTimes(1);
  });

  it('keeps dispatching when an event disappears mid batch', async () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const goneId = '00000000-0000-0000-0000-0000000000bb';
    const harness = createHarness({
      claimed: [
        { id: goneId, eventType: 'leak.reported', payload: {} },
        { id: eventId, eventType: 'leak.reported', payload: {} },
      ],
      updateErrors: {
        [goneId]: Object.assign(new Error('record not found'), {
          code: 'P2025',
        }),
      },
    });

    const result = await harness.dispatcher.dispatchOnce(now);

    expect(result).toEqual({
      claimed: 2,
      processed: 2,
      retried: 0,
      failed: 0,
    });
  });
});
