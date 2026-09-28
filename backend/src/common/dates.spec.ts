import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { resolveObservedAt } from './dates.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

describe('resolveObservedAt', () => {
  it('defaults to now when omitted', () => {
    expect(resolveObservedAt(undefined, NOW)).toEqual(NOW);
  });

  it('accepts a past observation', () => {
    const observed = new Date(NOW.getTime() - HOUR_MS);
    expect(resolveObservedAt(observed, NOW)).toEqual(observed);
  });

  it('accepts a small clock skew into the future', () => {
    const observed = new Date(NOW.getTime() + 2 * 60_000);
    expect(resolveObservedAt(observed, NOW)).toEqual(observed);
  });

  it('rejects an observation far in the future', () => {
    const observed = new Date(NOW.getTime() + 30 * 60_000);
    expect(() => resolveObservedAt(observed, NOW)).toThrow(BadRequestException);
  });

  it('rejects an observation older than thirty days', () => {
    const observed = new Date(NOW.getTime() - 31 * DAY_MS);
    expect(() => resolveObservedAt(observed, NOW)).toThrow(BadRequestException);
  });

  it('accepts an observation just inside the backdate limit', () => {
    const observed = new Date(NOW.getTime() - 29 * DAY_MS);
    expect(resolveObservedAt(observed, NOW)).toEqual(observed);
  });

  it('rejects an invalid date', () => {
    expect(() => resolveObservedAt(new Date('invalid'), NOW)).toThrow(
      BadRequestException,
    );
  });
});
