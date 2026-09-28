import { ConflictException } from '@nestjs/common';
import { LeakSeverity, LeakStatus } from '../../generated/prisma/enums.js';

const SEVERITY_RANK: Record<LeakSeverity, number> = {
  [LeakSeverity.LOW]: 0,
  [LeakSeverity.MEDIUM]: 1,
  [LeakSeverity.HIGH]: 2,
  [LeakSeverity.CRITICAL]: 3,
};

const SEVERITY_BY_RANK = [
  LeakSeverity.LOW,
  LeakSeverity.MEDIUM,
  LeakSeverity.HIGH,
  LeakSeverity.CRITICAL,
] as const;

export const LEAK_CONFIDENCE_FLOOR = 0.01;

export const LEAK_STATUS_TRANSITIONS: Record<LeakStatus, LeakStatus[]> = {
  [LeakStatus.OPEN]: [LeakStatus.TRIAGED, LeakStatus.REJECTED],
  [LeakStatus.TRIAGED]: [LeakStatus.INVESTIGATING, LeakStatus.RESOLVED],
  [LeakStatus.INVESTIGATING]: [LeakStatus.RESOLVED],
  [LeakStatus.RESOLVED]: [],
  [LeakStatus.REJECTED]: [],
};

export const TERMINAL_LEAK_STATUSES: readonly LeakStatus[] = [
  LeakStatus.RESOLVED,
  LeakStatus.REJECTED,
];

export const LEAK_CONFIDENCE_CEILING: Record<LeakSeverity, number> = {
  [LeakSeverity.LOW]: 0.4,
  [LeakSeverity.MEDIUM]: 0.6,
  [LeakSeverity.HIGH]: 0.8,
  [LeakSeverity.CRITICAL]: 1,
};

export interface ClusterThresholds {
  radiusMeters: number;
  maxRadiusMeters: number;
  confidenceBase: number;
  confidenceStep: number;
}

export interface ClusterMatch {
  id: string;
  severity: LeakSeverity;
  reportCount: number;
  confidence: number;
  radiusMeters: number | null;
  distanceMeters: number;
}

export interface ClusterMerge {
  severity: LeakSeverity;
  reportCount: number;
  confidence: number;
  radiusMeters: number;
}

export function isTerminalLeakStatus(status: LeakStatus): boolean {
  return TERMINAL_LEAK_STATUSES.includes(status);
}

export function isActiveLeakStatus(status: LeakStatus): boolean {
  return !isTerminalLeakStatus(status);
}

export function rankSeverity(severity: LeakSeverity): number {
  return SEVERITY_RANK[severity];
}

export function maxSeverity(
  left: LeakSeverity,
  right: LeakSeverity,
): LeakSeverity {
  return rankSeverity(left) >= rankSeverity(right) ? left : right;
}

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return LEAK_CONFIDENCE_FLOOR;
  }
  return Math.min(Math.max(value, LEAK_CONFIDENCE_FLOOR), 1);
}

export function severityConfidenceCeiling(severity: LeakSeverity): number {
  return LEAK_CONFIDENCE_CEILING[severity];
}

export function clusterConfidence(
  reportCount: number,
  thresholds: Pick<ClusterThresholds, 'confidenceBase' | 'confidenceStep'>,
): number {
  const corroborations = Math.max(reportCount, 1) - 1;
  return clampConfidence(
    thresholds.confidenceBase + thresholds.confidenceStep * corroborations,
  );
}

export function clusterRadius(
  currentRadiusMeters: number | null,
  distanceMeters: number,
  thresholds: Pick<ClusterThresholds, 'radiusMeters' | 'maxRadiusMeters'>,
): number {
  const observed = distanceMeters + thresholds.radiusMeters;
  const widened = Math.max(currentRadiusMeters ?? 0, observed);
  return Math.min(widened, thresholds.maxRadiusMeters);
}

export function isWithinClusterRadius(
  match: Pick<ClusterMatch, 'radiusMeters' | 'distanceMeters'>,
  thresholds: Pick<ClusterThresholds, 'radiusMeters'>,
): boolean {
  const limit = Math.max(match.radiusMeters ?? 0, thresholds.radiusMeters);
  return match.distanceMeters <= limit;
}

export function mergeIntoCluster(
  match: ClusterMatch,
  severity: LeakSeverity,
  thresholds: ClusterThresholds,
): ClusterMerge {
  const reportCount = Math.max(match.reportCount, 0) + 1;
  return {
    severity: maxSeverity(match.severity, severity),
    reportCount,
    confidence: clusterConfidence(reportCount, thresholds),
    radiusMeters: clusterRadius(
      match.radiusMeters,
      match.distanceMeters,
      thresholds,
    ),
  };
}

export function seedCluster(
  severity: LeakSeverity,
  thresholds: ClusterThresholds,
): ClusterMerge {
  return {
    severity,
    reportCount: 1,
    confidence: clusterConfidence(1, thresholds),
    radiusMeters: thresholds.radiusMeters,
  };
}

export function assertLeakStatusTransition(
  from: LeakStatus,
  to: LeakStatus,
): void {
  if (from === to) {
    return;
  }
  if (!LEAK_STATUS_TRANSITIONS[from].includes(to)) {
    throw new ConflictException(`A leak cannot move from ${from} to ${to}`);
  }
}

export function highestSeverity(severities: LeakSeverity[]): LeakSeverity {
  return severities.reduce<LeakSeverity>(
    (highest, severity) => maxSeverity(highest, severity),
    LeakSeverity.LOW,
  );
}

export function severityFromRank(rank: number): LeakSeverity {
  const index = Math.min(
    Math.max(Math.trunc(rank), 0),
    SEVERITY_BY_RANK.length - 1,
  );
  return SEVERITY_BY_RANK[index];
}
