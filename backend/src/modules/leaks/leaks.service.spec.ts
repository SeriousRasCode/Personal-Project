import { describe, expect, it } from 'vitest';
import { LeakSeverity, UserRole } from '../../generated/prisma/enums.js';
import {
  LEAK_CONFIDENCE_CEILING,
  resolveLeakConfidence,
} from './leaks.service.js';

describe('resolveLeakConfidence', () => {
  it('keeps a citizen at a modest confidence', () => {
    expect(
      resolveLeakConfidence(UserRole.CITIZEN, LeakSeverity.MEDIUM, 0.5),
    ).toBeCloseTo(0.5, 5);
  });

  it('clamps a citizen who claims full confidence', () => {
    expect(
      resolveLeakConfidence(UserRole.CITIZEN, LeakSeverity.CRITICAL, 1),
    ).toBeCloseTo(LEAK_CONFIDENCE_CEILING[UserRole.CITIZEN], 5);
  });

  it('never lets confidence exceed the severity ceiling', () => {
    expect(
      resolveLeakConfidence(UserRole.ADMIN, LeakSeverity.LOW, 1),
    ).toBeLessThanOrEqual(0.4);
  });

  it('lets trusted roles report a critical leak at full confidence', () => {
    expect(
      resolveLeakConfidence(UserRole.ADMIN, LeakSeverity.CRITICAL, 1),
    ).toBe(1);
  });

  it('treats a system actor as fully trusted', () => {
    expect(resolveLeakConfidence(null, LeakSeverity.CRITICAL, 1)).toBe(1);
  });

  it('falls back to a positive confidence for a non finite request', () => {
    const resolved = resolveLeakConfidence(
      UserRole.CITIZEN,
      LeakSeverity.MEDIUM,
      Number.NaN,
    );

    expect(resolved).toBeGreaterThan(0);
  });

  it('exposes a ceiling for every role', () => {
    for (const role of Object.values(UserRole)) {
      expect(LEAK_CONFIDENCE_CEILING[role]).toBeGreaterThan(0);
      expect(LEAK_CONFIDENCE_CEILING[role]).toBeLessThanOrEqual(1);
    }
  });
});
