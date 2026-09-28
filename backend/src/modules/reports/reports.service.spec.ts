import { describe, expect, it } from 'vitest';
import { UserRole } from '../../generated/prisma/enums.js';
import {
  RELIABILITY_CEILING,
  resolveReliabilityWeight,
} from './reports.service.js';

describe('resolveReliabilityWeight', () => {
  it('keeps a citizen at unit weight', () => {
    expect(resolveReliabilityWeight(UserRole.CITIZEN, 1)).toBe(1);
  });

  it('clamps a citizen attempting to inflate their weight', () => {
    expect(resolveReliabilityWeight(UserRole.CITIZEN, 5)).toBe(
      RELIABILITY_CEILING[UserRole.CITIZEN],
    );
  });

  it('allows operators a higher ceiling than citizens', () => {
    expect(RELIABILITY_CEILING[UserRole.STANDPIPE_OPERATOR]).toBeGreaterThan(
      RELIABILITY_CEILING[UserRole.CITIZEN],
    );
  });

  it('gives dispatchers and admins the highest ceilings', () => {
    expect(resolveReliabilityWeight(UserRole.ADMIN, 5)).toBe(5);
    expect(RELIABILITY_CEILING[UserRole.DISPATCHER]).toBeGreaterThan(
      RELIABILITY_CEILING[UserRole.STANDPIPE_OPERATOR],
    );
  });

  it('treats a system actor as fully trusted', () => {
    expect(resolveReliabilityWeight(null, 5)).toBe(5);
  });

  it('never returns less than the minimum weight', () => {
    expect(resolveReliabilityWeight(UserRole.ADMIN, 0)).toBe(0.1);
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
