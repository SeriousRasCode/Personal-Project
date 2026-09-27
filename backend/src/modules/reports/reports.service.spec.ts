import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UserRole } from '../../generated/prisma/enums.js';
import {
  RELIABILITY_CEILING,
  resolveObservedAt,
  resolveReliabilityWeight,
} from './reports.service.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');

describe('resolveReliabilityWeight', () => {
  it('keeps a citizen at unit weight', () => {
    expect(resolveReliabilityWeight(UserRole.CITIZEN, 1)).toBe(1);
  });

  it('clamps a citizen attempting to inflate their weight', () => {
    expect(resolveReliabilityWeight(UserRole.CITIZEN, 5)).toBe(1);
  });

  it('allows operators a higher ceiling than citizens', () => {
    expect(resolveReliabilityWeight(UserRole.STANDPIPE_OPERATOR, 2)).toBe(2);
    expect(resolveReliabilityWeight(UserRole.STANDPIPE_OPERATOR, 5)).toBe(2);
  });

  it('gives dispatchers and admins the highest ceilings', () => {
    expect(resolveReliabilityWeight(UserRole.DISPATCHER, 3)).toBe(3);
    expect(resolveReliabilityWeight(UserRole.ADMIN, 5)).toBe(5);
  });

  it('treats a system actor as fully trusted', () => {
    expect(resolveReliabilityWeight(null, 5)).toBe(5);
    expect(resolveReliabilityWeight(null, 1)).toBe(1);
  });

  it('never returns less than the minimum weight', () => {
    expect(resolveReliabilityWeight(UserRole.ADMIN, 0)).toBe(0.1);
    expect(resolveReliabilityWeight(UserRole.ADMIN, -3)).toBe(0.1);
  });

  it('falls back to unit weight for a non finite request', () => {
    expect(resolveReliabilityWeight(UserRole.ADMIN, Number.NaN)).toBe(1);
  });

  it('exposes a ceiling for every role', () => {
    for (const role of Object.values(UserRole)) {
      expect(RELIABILITY_CEILING[role]).toBeGreaterThan(0);
    }
  });
});

describe('resolveObservedAt', () => {
  it('defaults to now when omitted', () => {
    expect(resolveObservedAt(undefined, NOW)).toEqual(NOW);
  });

  it('accepts a past observation', () => {
    const observed = new Date(NOW.getTime() - 3_600_000);
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
    const observed = new Date(NOW.getTime() - 31 * 86_400_000);
    expect(() => resolveObservedAt(observed, NOW)).toThrow(BadRequestException);
  });

  it('accepts an observation just inside the backdate limit', () => {
    const observed = new Date(NOW.getTime() - 29 * 86_400_000);
    expect(resolveObservedAt(observed, NOW)).toEqual(observed);
  });

  it('rejects an invalid date', () => {
    expect(() => resolveObservedAt(new Date('invalid'), NOW)).toThrow(
      BadRequestException,
    );
  });
});
