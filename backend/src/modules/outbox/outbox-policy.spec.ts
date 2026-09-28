import { describe, expect, it } from 'vitest';
import { OutboxStatus } from '../../generated/prisma/enums.js';
import {
  isClaimable,
  isRetryableStatus,
  isStuck,
  nextOutboxStatus,
  outboxBackoffMs,
  retryDelayFor,
} from './outbox-policy.js';

const policy = { maxAttempts: 5, retryBaseMs: 1_000 };
const now = new Date('2026-10-01T00:00:00.000Z');

describe('outboxBackoffMs', () => {
  it('doubles from the base delay', () => {
    expect(outboxBackoffMs(1, policy)).toBe(1_000);
    expect(outboxBackoffMs(2, policy)).toBe(2_000);
    expect(outboxBackoffMs(3, policy)).toBe(4_000);
    expect(outboxBackoffMs(4, policy)).toBe(8_000);
  });

  it('caps the delay at fifteen minutes', () => {
    expect(outboxBackoffMs(30, policy)).toBe(15 * 60 * 1_000);
  });

  it('treats a nonsensical attempt count as the first attempt', () => {
    expect(outboxBackoffMs(0, policy)).toBe(1_000);
    expect(outboxBackoffMs(-3, policy)).toBe(1_000);
    expect(outboxBackoffMs(Number.NaN, policy)).toBe(1_000);
  });
});

describe('isRetryableStatus', () => {
  it('allows retries below the maximum', () => {
    expect(isRetryableStatus(1, 5)).toBe(true);
    expect(isRetryableStatus(4, 5)).toBe(true);
  });

  it('gives up once the maximum is reached', () => {
    expect(isRetryableStatus(5, 5)).toBe(false);
    expect(isRetryableStatus(6, 5)).toBe(false);
  });
});

describe('nextOutboxStatus', () => {
  it('requeues a retryable failure', () => {
    expect(nextOutboxStatus(1, 5)).toBe(OutboxStatus.PENDING);
  });

  it('marks an exhausted failure as failed', () => {
    expect(nextOutboxStatus(5, 5)).toBe(OutboxStatus.FAILED);
  });
});

describe('isClaimable', () => {
  it('claims a pending event that is due', () => {
    expect(isClaimable(OutboxStatus.PENDING, now, now)).toBe(true);
    expect(
      isClaimable(
        OutboxStatus.PENDING,
        new Date('2026-09-30T23:00:00.000Z'),
        now,
      ),
    ).toBe(true);
  });

  it('waits for a pending event that is scheduled later', () => {
    expect(
      isClaimable(
        OutboxStatus.PENDING,
        new Date('2026-10-01T00:00:01.000Z'),
        now,
      ),
    ).toBe(false);
  });

  it('never claims a settled or in flight event', () => {
    for (const status of [
      OutboxStatus.PROCESSED,
      OutboxStatus.FAILED,
      OutboxStatus.PROCESSING,
    ]) {
      expect(isClaimable(status, now, now)).toBe(false);
    }
  });
});

describe('isStuck', () => {
  const lockTimeoutMs = 60_000;

  it('is stuck once the lock timeout has elapsed', () => {
    expect(
      isStuck(
        OutboxStatus.PROCESSING,
        new Date('2026-09-30T23:58:00.000Z'),
        now,
        lockTimeoutMs,
      ),
    ).toBe(true);
  });

  it('is still in flight before the lock timeout', () => {
    expect(
      isStuck(
        OutboxStatus.PROCESSING,
        new Date('2026-09-30T23:59:30.000Z'),
        now,
        lockTimeoutMs,
      ),
    ).toBe(false);
  });

  it('never considers a non processing event stuck', () => {
    expect(
      isStuck(
        OutboxStatus.PENDING,
        new Date('2026-09-01T00:00:00.000Z'),
        now,
        lockTimeoutMs,
      ),
    ).toBe(false);
  });
});

describe('retryDelayFor', () => {
  it('schedules the retry in the future', () => {
    const delay = retryDelayFor(now, 2, policy);

    expect(delay.toISOString()).toBe('2026-10-01T00:00:02.000Z');
  });
});
