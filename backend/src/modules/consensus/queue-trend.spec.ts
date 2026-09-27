import { describe, expect, it } from 'vitest';
import { QueueTrend } from '../../generated/prisma/enums.js';
import {
  calculateQueueSnapshot,
  median,
  type QueueObservation,
} from './queue-trend.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function options(
  overrides: Partial<Parameters<typeof calculateQueueSnapshot>[1]> = {},
) {
  return {
    now: NOW,
    recentHours: 6,
    minSamples: 2,
    saturationSamples: 5,
    minRelativeDelta: 0.15,
    minAbsoluteDeltaMinutes: 2,
    ...overrides,
  };
}

describe('median', () => {
  it('returns null for an empty sample', () => {
    expect(median([])).toBeNull();
  });

  it('returns the middle value for odd counts', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the middle pair for even counts', () => {
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it('does not mutate the input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('calculateQueueSnapshot', () => {
  it('returns null when the recent window has too few samples', () => {
    const observations: QueueObservation[] = [
      { waitMinutes: 30, queueSize: 10, observedAt: hoursAgo(1) },
    ];

    expect(calculateQueueSnapshot(observations, options())).toBeNull();
  });

  it('publishes a stable snapshot without a baseline', () => {
    const observations: QueueObservation[] = [
      { waitMinutes: 30, queueSize: 10, observedAt: hoursAgo(1) },
      { waitMinutes: 32, queueSize: 12, observedAt: hoursAgo(2) },
    ];

    const result = calculateQueueSnapshot(observations, options());

    expect(result).not.toBeNull();
    expect(result?.trend).toBe(QueueTrend.STABLE);
    expect(result?.waitMinutes).toBe(31);
    expect(result?.queueSize).toBe(11);
    expect(result?.sampleCount).toBe(2);
  });

  it('marks a shrinking queue as improving', () => {
    const observations: QueueObservation[] = [
      { waitMinutes: 60, queueSize: 40, observedAt: hoursAgo(7) },
      { waitMinutes: 65, queueSize: 45, observedAt: hoursAgo(8) },
      { waitMinutes: 20, queueSize: 8, observedAt: hoursAgo(1) },
      { waitMinutes: 25, queueSize: 10, observedAt: hoursAgo(2) },
    ];

    expect(calculateQueueSnapshot(observations, options())?.trend).toBe(
      QueueTrend.IMPROVING,
    );
  });

  it('marks a growing queue as worse', () => {
    const observations: QueueObservation[] = [
      { waitMinutes: 15, queueSize: 5, observedAt: hoursAgo(7) },
      { waitMinutes: 18, queueSize: 6, observedAt: hoursAgo(8) },
      { waitMinutes: 55, queueSize: 30, observedAt: hoursAgo(1) },
      { waitMinutes: 60, queueSize: 35, observedAt: hoursAgo(2) },
    ];

    expect(calculateQueueSnapshot(observations, options())?.trend).toBe(
      QueueTrend.WORSE,
    );
  });

  it('keeps small movements stable', () => {
    const observations: QueueObservation[] = [
      { waitMinutes: 30, queueSize: 10, observedAt: hoursAgo(7) },
      { waitMinutes: 31, queueSize: 11, observedAt: hoursAgo(8) },
      { waitMinutes: 31, queueSize: 11, observedAt: hoursAgo(1) },
      { waitMinutes: 32, queueSize: 12, observedAt: hoursAgo(2) },
    ];

    expect(calculateQueueSnapshot(observations, options())?.trend).toBe(
      QueueTrend.STABLE,
    );
  });

  it('ignores observations older than the baseline window', () => {
    const observations: QueueObservation[] = [
      { waitMinutes: 300, queueSize: 90, observedAt: hoursAgo(30) },
      { waitMinutes: 20, queueSize: 5, observedAt: hoursAgo(1) },
      { waitMinutes: 24, queueSize: 6, observedAt: hoursAgo(2) },
    ];

    const result = calculateQueueSnapshot(observations, options());

    expect(result?.trend).toBe(QueueTrend.STABLE);
    expect(result?.waitMinutes).toBe(22);
  });

  it('ignores future observations and invalid values', () => {
    const observations: QueueObservation[] = [
      {
        waitMinutes: 5,
        queueSize: 1,
        observedAt: new Date(NOW.getTime() + 3_600_000),
      },
      { waitMinutes: -4, queueSize: 2, observedAt: hoursAgo(1) },
      {
        waitMinutes: Number.NaN,
        queueSize: null,
        observedAt: hoursAgo(1),
      },
      { waitMinutes: 40, queueSize: -3, observedAt: hoursAgo(1) },
      { waitMinutes: 44, queueSize: null, observedAt: hoursAgo(2) },
    ];

    const result = calculateQueueSnapshot(observations, options());

    expect(result?.sampleCount).toBe(2);
    expect(result?.waitMinutes).toBe(42);
    expect(result?.queueSize).toBeNull();
  });

  it('scales confidence with the sample count', () => {
    const sparse = calculateQueueSnapshot(
      [
        { waitMinutes: 20, queueSize: null, observedAt: hoursAgo(1) },
        { waitMinutes: 22, queueSize: null, observedAt: hoursAgo(2) },
      ],
      options(),
    );
    const dense = calculateQueueSnapshot(
      [
        ...Array.from({ length: 5 }, () => ({
          waitMinutes: 20,
          queueSize: null,
          observedAt: hoursAgo(1),
        })),
        { waitMinutes: 22, queueSize: null, observedAt: hoursAgo(3) },
      ],
      options(),
    );

    expect(sparse?.confidence).toBeCloseTo(0.4, 4);
    expect(dense?.confidence).toBe(1);
  });

  it('respects a custom minimum sample threshold', () => {
    const observations: QueueObservation[] = [
      { waitMinutes: 20, queueSize: null, observedAt: hoursAgo(1) },
    ];

    expect(
      calculateQueueSnapshot(observations, options({ minSamples: 1 })),
    ).not.toBeNull();
    expect(calculateQueueSnapshot(observations, options())).toBeNull();
  });
});
