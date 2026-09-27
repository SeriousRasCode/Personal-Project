import { describe, expect, it } from 'vitest';
import { FlowStatus } from '../../generated/prisma/enums.js';
import {
  calculateTapConsensus,
  recencyWeight,
  roundTo,
  type TapObservation,
} from './tap-consensus.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function options(
  overrides: Partial<Parameters<typeof calculateTapConsensus>[1]> = {},
) {
  return {
    now: NOW,
    windowHours: 24,
    halfLifeHours: 6,
    saturationWeight: 4,
    priorWeight: 0.25,
    ...overrides,
  };
}

describe('roundTo', () => {
  it('rounds to the requested precision', () => {
    expect(roundTo(0.1234567, 4)).toBe(0.1235);
    expect(roundTo(1.005, 2)).toBe(1.0);
  });

  it('returns zero for non finite values', () => {
    expect(roundTo(Number.NaN, 4)).toBe(0);
    expect(roundTo(Number.POSITIVE_INFINITY, 2)).toBe(0);
  });
});

describe('recencyWeight', () => {
  it('halves at every half life', () => {
    expect(recencyWeight(hoursAgo(6), NOW, 6)).toBeCloseTo(0.5, 6);
    expect(recencyWeight(hoursAgo(12), NOW, 6)).toBeCloseTo(0.25, 6);
  });

  it('returns full weight for current or future observations', () => {
    expect(recencyWeight(NOW, NOW, 6)).toBe(1);
    expect(recencyWeight(new Date(NOW.getTime() + 60_000), NOW, 6)).toBe(1);
  });

  it('returns full weight when decay is disabled', () => {
    expect(recencyWeight(hoursAgo(48), NOW, 0)).toBe(1);
  });
});

describe('calculateTapConsensus', () => {
  it('returns unknown when there are no observations', () => {
    const result = calculateTapConsensus([], options());

    expect(result.status).toBe(FlowStatus.UNKNOWN);
    expect(result.confidence).toBe(0);
    expect(result.sampleCount).toBe(0);
    expect(result.lastObservedAt).toBeNull();
  });

  it('returns unknown when every observation is unknown', () => {
    const observations: TapObservation[] = [
      { status: FlowStatus.UNKNOWN, reliabilityWeight: 3, observedAt: NOW },
    ];

    expect(calculateTapConsensus(observations, options()).status).toBe(
      FlowStatus.UNKNOWN,
    );
  });

  it('detects a single full flow report', () => {
    const observations: TapObservation[] = [
      { status: FlowStatus.FULL_FLOW, reliabilityWeight: 1, observedAt: NOW },
    ];

    const result = calculateTapConsensus(observations, options());

    expect(result.status).toBe(FlowStatus.FULL_FLOW);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.sampleCount).toBe(1);
    expect(result.lastObservedAt).toEqual(NOW);
  });

  it('normalises scores to a probability distribution', () => {
    const observations: TapObservation[] = [
      { status: FlowStatus.FULL_FLOW, reliabilityWeight: 1, observedAt: NOW },
      { status: FlowStatus.FULL_FLOW, reliabilityWeight: 1, observedAt: NOW },
      { status: FlowStatus.DRY, reliabilityWeight: 1, observedAt: NOW },
    ];

    const result = calculateTapConsensus(observations, options());
    const total = result.fullFlowScore + result.trickleScore + result.dryScore;

    expect(total).toBeCloseTo(1, 5);
    expect(result.status).toBe(FlowStatus.FULL_FLOW);
  });

  it('weights a majority of dry reports above a minority of full flow', () => {
    const observations: TapObservation[] = [
      { status: FlowStatus.DRY, reliabilityWeight: 1, observedAt: NOW },
      { status: FlowStatus.DRY, reliabilityWeight: 1, observedAt: NOW },
      { status: FlowStatus.DRY, reliabilityWeight: 1, observedAt: NOW },
      { status: FlowStatus.FULL_FLOW, reliabilityWeight: 1, observedAt: NOW },
    ];

    expect(calculateTapConsensus(observations, options()).status).toBe(
      FlowStatus.DRY,
    );
  });

  it('lets recent evidence outweigh stale evidence', () => {
    const observations: TapObservation[] = [
      {
        status: FlowStatus.FULL_FLOW,
        reliabilityWeight: 1,
        observedAt: hoursAgo(20),
      },
      { status: FlowStatus.DRY, reliabilityWeight: 1, observedAt: NOW },
    ];

    const result = calculateTapConsensus(observations, options());

    expect(result.status).toBe(FlowStatus.DRY);
    expect(result.sampleCount).toBe(2);
  });

  it('ignores observations outside the window', () => {
    const observations: TapObservation[] = [
      {
        status: FlowStatus.FULL_FLOW,
        reliabilityWeight: 1,
        observedAt: hoursAgo(30),
      },
    ];

    expect(calculateTapConsensus(observations, options()).sampleCount).toBe(0);
  });

  it('keeps observations slightly ahead of now within tolerance', () => {
    const observations: TapObservation[] = [
      {
        status: FlowStatus.TRICKLE,
        reliabilityWeight: 1,
        observedAt: new Date(NOW.getTime() + 2 * 60_000),
      },
    ];

    expect(calculateTapConsensus(observations, options()).sampleCount).toBe(1);
  });

  it('drops observations far in the future', () => {
    const observations: TapObservation[] = [
      {
        status: FlowStatus.TRICKLE,
        reliabilityWeight: 1,
        observedAt: new Date(NOW.getTime() + 6 * 3_600_000),
      },
    ];

    expect(calculateTapConsensus(observations, options()).sampleCount).toBe(0);
  });

  it('returns unknown with zero confidence on an exact tie', () => {
    const observations: TapObservation[] = [
      { status: FlowStatus.FULL_FLOW, reliabilityWeight: 1, observedAt: NOW },
      { status: FlowStatus.DRY, reliabilityWeight: 1, observedAt: NOW },
    ];

    const result = calculateTapConsensus(observations, {
      ...options(),
      priorWeight: 0,
    });

    expect(result.status).toBe(FlowStatus.UNKNOWN);
    expect(result.confidence).toBe(0);
    expect(result.sampleCount).toBe(2);
  });

  it('scales confidence with accumulated weight', () => {
    const single = calculateTapConsensus(
      [{ status: FlowStatus.FULL_FLOW, reliabilityWeight: 1, observedAt: NOW }],
      options(),
    );
    const many = calculateTapConsensus(
      Array.from({ length: 4 }, () => ({
        status: FlowStatus.FULL_FLOW,
        reliabilityWeight: 1,
        observedAt: NOW,
      })),
      options(),
    );

    expect(many.confidence).toBeGreaterThan(single.confidence);
    expect(many.confidence).toBeLessThanOrEqual(1);
  });

  it('approaches but never reaches certainty under overwhelming evidence', () => {
    const observations: TapObservation[] = Array.from({ length: 50 }, () => ({
      status: FlowStatus.DRY,
      reliabilityWeight: 1,
      observedAt: NOW,
    }));

    const result = calculateTapConsensus(observations, options());

    expect(result.confidence).toBeGreaterThan(0.98);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.status).toBe(FlowStatus.DRY);
  });

  it('keeps confidence at one when the margin is total', () => {
    const observations: TapObservation[] = [
      { status: FlowStatus.DRY, reliabilityWeight: 10, observedAt: NOW },
    ];

    expect(
      calculateTapConsensus(observations, options({ priorWeight: 0 }))
        .confidence,
    ).toBe(1);
  });

  it('trusts a highly reliable operator report over citizen reports', () => {
    const observations: TapObservation[] = [
      { status: FlowStatus.FULL_FLOW, reliabilityWeight: 1, observedAt: NOW },
      { status: FlowStatus.FULL_FLOW, reliabilityWeight: 1, observedAt: NOW },
      {
        status: FlowStatus.DRY,
        reliabilityWeight: 3,
        observedAt: NOW,
      },
    ];

    expect(calculateTapConsensus(observations, options()).status).toBe(
      FlowStatus.DRY,
    );
  });

  it('ignores non positive and non finite weights', () => {
    const observations: TapObservation[] = [
      { status: FlowStatus.DRY, reliabilityWeight: 0, observedAt: NOW },
      {
        status: FlowStatus.DRY,
        reliabilityWeight: Number.NaN,
        observedAt: NOW,
      },
    ];

    expect(calculateTapConsensus(observations, options()).sampleCount).toBe(0);
  });

  it('reports the latest contributing observation', () => {
    const observations: TapObservation[] = [
      {
        status: FlowStatus.FULL_FLOW,
        reliabilityWeight: 1,
        observedAt: hoursAgo(3),
      },
      { status: FlowStatus.DRY, reliabilityWeight: 1, observedAt: hoursAgo(1) },
      {
        status: FlowStatus.TRICKLE,
        reliabilityWeight: 1,
        observedAt: hoursAgo(2),
      },
    ];

    expect(
      calculateTapConsensus(observations, options()).lastObservedAt,
    ).toEqual(hoursAgo(1));
  });
});
