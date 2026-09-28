import { describe, expect, it } from 'vitest';
import { LeakSeverity, LeakStatus } from '../../generated/prisma/enums.js';
import {
  assertLeakStatusTransition,
  clampConfidence,
  clusterConfidence,
  clusterRadius,
  highestSeverity,
  isActiveLeakStatus,
  isTerminalLeakStatus,
  isWithinClusterRadius,
  maxSeverity,
  mergeIntoCluster,
  rankSeverity,
  seedCluster,
  severityConfidenceCeiling,
  severityFromRank,
  type ClusterMatch,
  type ClusterThresholds,
} from './leak-clustering.js';

const THRESHOLDS: ClusterThresholds = {
  radiusMeters: 150,
  maxRadiusMeters: 400,
  confidenceBase: 0.4,
  confidenceStep: 0.2,
};

function match(overrides: Partial<ClusterMatch> = {}): ClusterMatch {
  return {
    id: 'cluster-1',
    severity: LeakSeverity.MEDIUM,
    reportCount: 1,
    confidence: 0.4,
    radiusMeters: 150,
    distanceMeters: 40,
    ...overrides,
  };
}

describe('severity ranking', () => {
  it('orders severities from low to critical', () => {
    expect(rankSeverity(LeakSeverity.LOW)).toBeLessThan(
      rankSeverity(LeakSeverity.MEDIUM),
    );
    expect(rankSeverity(LeakSeverity.MEDIUM)).toBeLessThan(
      rankSeverity(LeakSeverity.HIGH),
    );
    expect(rankSeverity(LeakSeverity.HIGH)).toBeLessThan(
      rankSeverity(LeakSeverity.CRITICAL),
    );
  });

  it('keeps the higher of two severities', () => {
    expect(maxSeverity(LeakSeverity.LOW, LeakSeverity.CRITICAL)).toBe(
      LeakSeverity.CRITICAL,
    );
    expect(maxSeverity(LeakSeverity.HIGH, LeakSeverity.MEDIUM)).toBe(
      LeakSeverity.HIGH,
    );
    expect(maxSeverity(LeakSeverity.MEDIUM, LeakSeverity.MEDIUM)).toBe(
      LeakSeverity.MEDIUM,
    );
  });

  it('finds the highest severity in a list', () => {
    expect(
      highestSeverity([
        LeakSeverity.LOW,
        LeakSeverity.CRITICAL,
        LeakSeverity.MEDIUM,
      ]),
    ).toBe(LeakSeverity.CRITICAL);
    expect(highestSeverity([])).toBe(LeakSeverity.LOW);
  });

  it('converts a rank back to a severity', () => {
    expect(severityFromRank(0)).toBe(LeakSeverity.LOW);
    expect(severityFromRank(3)).toBe(LeakSeverity.CRITICAL);
    expect(severityFromRank(99)).toBe(LeakSeverity.CRITICAL);
    expect(severityFromRank(-5)).toBe(LeakSeverity.LOW);
  });

  it('gives a higher severity a higher confidence ceiling', () => {
    expect(severityConfidenceCeiling(LeakSeverity.LOW)).toBeLessThan(
      severityConfidenceCeiling(LeakSeverity.CRITICAL),
    );
  });
});

describe('leak status lifecycle', () => {
  it('treats resolved and rejected as terminal', () => {
    expect(isTerminalLeakStatus(LeakStatus.RESOLVED)).toBe(true);
    expect(isTerminalLeakStatus(LeakStatus.REJECTED)).toBe(true);
    expect(isTerminalLeakStatus(LeakStatus.OPEN)).toBe(false);
  });

  it('treats unresolved work as active', () => {
    expect(isActiveLeakStatus(LeakStatus.OPEN)).toBe(true);
    expect(isActiveLeakStatus(LeakStatus.INVESTIGATING)).toBe(true);
    expect(isActiveLeakStatus(LeakStatus.RESOLVED)).toBe(false);
  });

  it('allows triage to progress a leak forward', () => {
    expect(() =>
      assertLeakStatusTransition(LeakStatus.OPEN, LeakStatus.TRIAGED),
    ).not.toThrow();
    expect(() =>
      assertLeakStatusTransition(LeakStatus.TRIAGED, LeakStatus.INVESTIGATING),
    ).not.toThrow();
    expect(() =>
      assertLeakStatusTransition(LeakStatus.INVESTIGATING, LeakStatus.RESOLVED),
    ).not.toThrow();
  });

  it('allows an unreviewed leak to be rejected', () => {
    expect(() =>
      assertLeakStatusTransition(LeakStatus.OPEN, LeakStatus.REJECTED),
    ).not.toThrow();
  });

  it('refuses to skip triage', () => {
    expect(() =>
      assertLeakStatusTransition(LeakStatus.OPEN, LeakStatus.RESOLVED),
    ).toThrow(/cannot move from OPEN to RESOLVED/);
  });

  it('refuses to move backwards', () => {
    expect(() =>
      assertLeakStatusTransition(LeakStatus.INVESTIGATING, LeakStatus.OPEN),
    ).toThrow();
  });

  it('refuses to revive a terminal leak', () => {
    expect(() =>
      assertLeakStatusTransition(LeakStatus.RESOLVED, LeakStatus.OPEN),
    ).toThrow();
    expect(() =>
      assertLeakStatusTransition(LeakStatus.REJECTED, LeakStatus.TRIAGED),
    ).toThrow();
  });

  it('treats a no-op transition as valid', () => {
    expect(() =>
      assertLeakStatusTransition(LeakStatus.OPEN, LeakStatus.OPEN),
    ).not.toThrow();
  });
});

describe('cluster confidence', () => {
  it('starts a single report at the base confidence', () => {
    expect(clusterConfidence(1, THRESHOLDS)).toBeCloseTo(0.4, 5);
  });

  it('grows confidence with corroborating reports', () => {
    expect(clusterConfidence(2, THRESHOLDS)).toBeCloseTo(0.6, 5);
    expect(clusterConfidence(3, THRESHOLDS)).toBeCloseTo(0.8, 5);
  });

  it('saturates at one rather than exceeding it', () => {
    expect(clusterConfidence(4, THRESHOLDS)).toBe(1);
    expect(clusterConfidence(50, THRESHOLDS)).toBe(1);
  });

  it('never returns a confidence below the floor', () => {
    expect(clampConfidence(0)).toBeGreaterThan(0);
    expect(clampConfidence(Number.NaN)).toBeGreaterThan(0);
  });
});

describe('cluster radius', () => {
  it('starts at the configured radius', () => {
    expect(clusterRadius(null, 0, THRESHOLDS)).toBe(150);
  });

  it('grows to cover a report near the edge of the cluster', () => {
    expect(clusterRadius(150, 100, THRESHOLDS)).toBe(250);
  });

  it('never shrinks an existing cluster', () => {
    expect(clusterRadius(300, 10, THRESHOLDS)).toBe(300);
  });

  it('caps growth at the maximum radius', () => {
    expect(clusterRadius(150, 900, THRESHOLDS)).toBe(400);
  });

  it('attaches reports inside the wider of the two radii', () => {
    expect(
      isWithinClusterRadius(
        { radiusMeters: 300, distanceMeters: 280 },
        THRESHOLDS,
      ),
    ).toBe(true);
    expect(
      isWithinClusterRadius(
        { radiusMeters: 300, distanceMeters: 320 },
        THRESHOLDS,
      ),
    ).toBe(false);
  });

  it('uses the configured radius when a cluster has none', () => {
    expect(
      isWithinClusterRadius(
        { radiusMeters: null, distanceMeters: 150 },
        THRESHOLDS,
      ),
    ).toBe(true);
    expect(
      isWithinClusterRadius(
        { radiusMeters: null, distanceMeters: 151 },
        THRESHOLDS,
      ),
    ).toBe(false);
  });
});

describe('cluster merging', () => {
  it('counts the new report and raises severity', () => {
    const merged = mergeIntoCluster(
      match({ severity: LeakSeverity.LOW, reportCount: 2 }),
      LeakSeverity.CRITICAL,
      THRESHOLDS,
    );

    expect(merged.reportCount).toBe(3);
    expect(merged.severity).toBe(LeakSeverity.CRITICAL);
    expect(merged.confidence).toBeCloseTo(0.8, 5);
  });

  it('never lowers an existing severity', () => {
    const merged = mergeIntoCluster(
      match({ severity: LeakSeverity.CRITICAL }),
      LeakSeverity.LOW,
      THRESHOLDS,
    );

    expect(merged.severity).toBe(LeakSeverity.CRITICAL);
  });

  it('widens the cluster when the report sits outside it', () => {
    const merged = mergeIntoCluster(
      match({ radiusMeters: 150, distanceMeters: 200 }),
      LeakSeverity.MEDIUM,
      THRESHOLDS,
    );

    expect(merged.radiusMeters).toBe(350);
  });

  it('seeds a brand new cluster at unit count', () => {
    const seeded = seedCluster(LeakSeverity.HIGH, THRESHOLDS);

    expect(seeded.reportCount).toBe(1);
    expect(seeded.severity).toBe(LeakSeverity.HIGH);
    expect(seeded.radiusMeters).toBe(150);
    expect(seeded.confidence).toBeCloseTo(0.4, 5);
  });
});
