import { OutboxStatus } from '../../generated/prisma/enums.js';

const SECOND_MS = 1_000;

export interface OutboxRetryPolicy {
  maxAttempts: number;
  retryBaseMs: number;
}

export function outboxBackoffMs(
  attempts: number,
  policy: OutboxRetryPolicy,
): number {
  const normalized = Number.isFinite(attempts) ? Math.trunc(attempts) : 1;
  const clampedAttempts = Math.min(Math.max(normalized, 1), 20);
  return Math.min(
    policy.retryBaseMs * 2 ** (clampedAttempts - 1),
    15 * 60 * SECOND_MS,
  );
}

export function isRetryableStatus(
  attempts: number,
  maxAttempts: number,
): boolean {
  return attempts < maxAttempts;
}

export function nextOutboxStatus(
  attempts: number,
  maxAttempts: number,
): OutboxStatus {
  return isRetryableStatus(attempts, maxAttempts)
    ? OutboxStatus.PENDING
    : OutboxStatus.FAILED;
}

export function isClaimable(
  status: OutboxStatus,
  availableAt: Date,
  now: Date,
): boolean {
  return (
    status === OutboxStatus.PENDING && availableAt.getTime() <= now.getTime()
  );
}

export function isStuck(
  status: OutboxStatus,
  availableAt: Date,
  now: Date,
  lockTimeoutMs: number,
): boolean {
  if (status !== OutboxStatus.PROCESSING) {
    return false;
  }
  return now.getTime() - availableAt.getTime() >= lockTimeoutMs;
}

export function retryDelayFor(
  now: Date,
  attempts: number,
  policy: OutboxRetryPolicy,
): Date {
  return new Date(now.getTime() + outboxBackoffMs(attempts, policy));
}
