import { QueueTrend } from '../../generated/prisma/enums.js';
import { roundTo } from './tap-consensus.js';

export interface QueueObservation {
  waitMinutes: number;
  queueSize: number | null;
  observedAt: Date;
}

export interface QueueTrendOptions {
  now: Date;
  recentHours: number;
  minSamples: number;
  saturationSamples: number;
  minRelativeDelta: number;
  minAbsoluteDeltaMinutes: number;
}

export interface QueueSnapshotResult {
  waitMinutes: number;
  queueSize: number | null;
  trend: QueueTrend;
  confidence: number;
  sampleCount: number;
}

const HOUR_MS = 3_600_000;
const MINUTES_DECIMALS = 2;
const CONFIDENCE_DECIMALS = 4;

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function calculateQueueSnapshot(
  observations: QueueObservation[],
  options: QueueTrendOptions,
): QueueSnapshotResult | null {
  const {
    now,
    recentHours,
    minSamples,
    saturationSamples,
    minRelativeDelta,
    minAbsoluteDeltaMinutes,
  } = options;
  const nowMs = now.getTime();
  const recentStartMs = nowMs - recentHours * HOUR_MS;
  const baselineStartMs = recentStartMs - recentHours * HOUR_MS;

  const recentWaits: number[] = [];
  const recentQueueSizes: number[] = [];
  const baselineWaits: number[] = [];

  for (const observation of observations) {
    const observedMs = observation.observedAt.getTime();
    if (Number.isNaN(observedMs) || observedMs > nowMs) {
      continue;
    }
    if (
      !Number.isFinite(observation.waitMinutes) ||
      observation.waitMinutes < 0
    ) {
      continue;
    }
    if (observedMs >= recentStartMs) {
      recentWaits.push(observation.waitMinutes);
      if (
        observation.queueSize !== null &&
        Number.isFinite(observation.queueSize) &&
        observation.queueSize >= 0
      ) {
        recentQueueSizes.push(observation.queueSize);
      }
      continue;
    }
    if (observedMs >= baselineStartMs) {
      baselineWaits.push(observation.waitMinutes);
    }
  }

  if (recentWaits.length < minSamples) {
    return null;
  }

  const recentMedian = median(recentWaits);
  if (recentMedian === null) {
    return null;
  }

  const baselineMedian =
    baselineWaits.length >= minSamples ? median(baselineWaits) : null;
  const threshold =
    baselineMedian === null
      ? minAbsoluteDeltaMinutes
      : Math.max(minAbsoluteDeltaMinutes, minRelativeDelta * baselineMedian);
  const delta = baselineMedian === null ? 0 : baselineMedian - recentMedian;

  let trend: QueueTrend = QueueTrend.STABLE;
  if (baselineMedian !== null && delta > threshold) {
    trend = QueueTrend.IMPROVING;
  } else if (baselineMedian !== null && delta < -threshold) {
    trend = QueueTrend.WORSE;
  }

  const queueSizeMedian = median(recentQueueSizes);

  return {
    waitMinutes: roundTo(recentMedian, MINUTES_DECIMALS),
    queueSize: queueSizeMedian === null ? null : Math.round(queueSizeMedian),
    trend,
    confidence: roundTo(
      Math.min(1, recentWaits.length / Math.max(1, saturationSamples)),
      CONFIDENCE_DECIMALS,
    ),
    sampleCount: recentWaits.length,
  };
}
