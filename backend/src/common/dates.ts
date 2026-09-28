import { BadRequestException } from '@nestjs/common';

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

export const MAX_FUTURE_SKEW_MS = 5 * MINUTE_MS;
export const MAX_BACKDATE_MS = 30 * DAY_MS;

export function resolveObservedAt(
  requested: Date | undefined,
  now: Date,
): Date {
  if (!requested) {
    return now;
  }
  const observedMs = requested.getTime();
  if (Number.isNaN(observedMs)) {
    throw new BadRequestException('observedAt is not a valid date');
  }
  if (observedMs > now.getTime() + MAX_FUTURE_SKEW_MS) {
    throw new BadRequestException('observedAt cannot be in the future');
  }
  if (observedMs < now.getTime() - MAX_BACKDATE_MS) {
    throw new BadRequestException('observedAt cannot be older than 30 days');
  }
  return new Date(observedMs);
}
