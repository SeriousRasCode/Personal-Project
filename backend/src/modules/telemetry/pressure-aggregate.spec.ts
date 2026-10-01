import {
  averageOf,
  bucketBoundaries,
  roundToThree,
  windowRange,
} from './pressure-aggregate.js';
import { describe, expect, it } from 'vitest';

describe('assertWindowMinutes', () => {
  it('defaults to sixty minutes', () => {
    expect(
      windowRange(
        new Date('2026-10-01T12:00:00.000Z'),
        undefined as unknown as number,
      ).windowStart.toISOString(),
    ).toBe('2026-10-01T11:00:00.000Z');
  });

  it('rejects a fractional window', () => {
    expect(() => windowRange(new Date(), 1.5)).toThrow(RangeError);
  });

  it('rejects a window outside the supported range', () => {
    expect(() => windowRange(new Date(), 0)).toThrow(RangeError);
    expect(() => windowRange(new Date(), 10_081)).toThrow(RangeError);
  });

  it('rejects a non numeric window', () => {
    expect(() => windowRange(new Date(), 'sixty' as unknown as number)).toThrow(
      RangeError,
    );
  });
});

describe('bucketBoundaries', () => {
  it('floors an observation to its window', () => {
    const bucket = bucketBoundaries(new Date('2026-10-01T12:34:56.000Z'), 60);

    expect(bucket.windowStart.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(bucket.windowEnd.toISOString()).toBe('2026-10-01T13:00:00.000Z');
  });

  it('groups observations inside the same window together', () => {
    const first = bucketBoundaries(new Date('2026-10-01T12:00:01.000Z'), 15);
    const second = bucketBoundaries(new Date('2026-10-01T12:14:59.000Z'), 15);
    const third = bucketBoundaries(new Date('2026-10-01T12:15:00.000Z'), 15);

    expect(first.windowStart.getTime()).toBe(second.windowStart.getTime());
    expect(third.windowStart.getTime()).toBeGreaterThan(
      first.windowStart.getTime(),
    );
  });

  it('handles a daily window', () => {
    const bucket = bucketBoundaries(
      new Date('2026-10-01T23:59:00.000Z'),
      1_440,
    );

    expect(bucket.windowEnd.getTime() - bucket.windowStart.getTime()).toBe(
      86_400_000,
    );
  });
});

describe('averageOf', () => {
  it('averages to three decimals', () => {
    expect(averageOf([1, 2, 2])).toBeCloseTo(1.667, 3);
  });

  it('keeps a repeating average exact', () => {
    expect(averageOf([2.5, 2.5])).toBe(2.5);
  });

  it('rejects an empty series', () => {
    expect(() => averageOf([])).toThrow(RangeError);
  });
});

describe('roundToThree', () => {
  it('rounds to the schema scale', () => {
    expect(roundToThree(1.23456)).toBe(1.235);
    expect(roundToThree(1.2)).toBe(1.2);
  });
});
