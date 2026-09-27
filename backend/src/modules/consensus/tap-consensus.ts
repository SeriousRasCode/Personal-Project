import { FlowStatus } from '../../generated/prisma/enums.js';

export interface TapObservation {
  status: FlowStatus;
  reliabilityWeight: number;
  observedAt: Date;
}

export interface TapConsensusOptions {
  now: Date;
  windowHours: number;
  halfLifeHours: number;
  saturationWeight: number;
  priorWeight: number;
}

export interface TapConsensusResult {
  status: FlowStatus;
  confidence: number;
  sampleCount: number;
  fullFlowScore: number;
  trickleScore: number;
  dryScore: number;
  totalWeight: number;
  lastObservedAt: Date | null;
}

const HOUR_MS = 3_600_000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const SCORE_DECIMALS = 6;
const CONFIDENCE_DECIMALS = 4;

const RATED_STATUSES = [
  FlowStatus.FULL_FLOW,
  FlowStatus.TRICKLE,
  FlowStatus.DRY,
] as const;

type RatedStatus = (typeof RATED_STATUSES)[number];

function isRatedStatus(status: FlowStatus): status is RatedStatus {
  return (
    status === FlowStatus.FULL_FLOW ||
    status === FlowStatus.TRICKLE ||
    status === FlowStatus.DRY
  );
}

export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function recencyWeight(
  observedAt: Date,
  now: Date,
  halfLifeHours: number,
): number {
  if (halfLifeHours <= 0) {
    return 1;
  }
  const ageMs = now.getTime() - observedAt.getTime();
  if (ageMs <= 0) {
    return 1;
  }
  return 0.5 ** (ageMs / (halfLifeHours * HOUR_MS));
}

export function calculateTapConsensus(
  observations: TapObservation[],
  options: TapConsensusOptions,
): TapConsensusResult {
  const { now, windowHours, halfLifeHours, saturationWeight, priorWeight } =
    options;
  const nowMs = now.getTime();
  const windowStartMs = nowMs - windowHours * HOUR_MS;

  const weights = new Map<RatedStatus, number>(
    RATED_STATUSES.map((status) => [status, 0]),
  );
  let sampleCount = 0;
  let totalWeight = 0;
  let lastObservedMs: number | null = null;

  for (const observation of observations) {
    if (!isRatedStatus(observation.status)) {
      continue;
    }
    const observedMs = observation.observedAt.getTime();
    if (Number.isNaN(observedMs)) {
      continue;
    }
    if (
      observedMs < windowStartMs ||
      observedMs > nowMs + FUTURE_TOLERANCE_MS
    ) {
      continue;
    }
    const declared = Number.isFinite(observation.reliabilityWeight)
      ? Math.max(0, observation.reliabilityWeight)
      : 0;
    const weight =
      declared * recencyWeight(observation.observedAt, now, halfLifeHours);
    if (weight <= 0) {
      continue;
    }
    weights.set(
      observation.status,
      (weights.get(observation.status) ?? 0) + weight,
    );
    totalWeight += weight;
    sampleCount += 1;
    if (lastObservedMs === null || observedMs > lastObservedMs) {
      lastObservedMs = observedMs;
    }
  }

  if (sampleCount === 0) {
    return {
      status: FlowStatus.UNKNOWN,
      confidence: 0,
      sampleCount: 0,
      fullFlowScore: 0,
      trickleScore: 0,
      dryScore: 0,
      totalWeight: 0,
      lastObservedAt: null,
    };
  }

  const denominator = totalWeight + priorWeight * RATED_STATUSES.length;
  const scores = new Map<RatedStatus, number>(
    RATED_STATUSES.map((status) => [
      status,
      (weights.get(status) ?? 0) + priorWeight,
    ]),
  );

  const ranked = RATED_STATUSES.map((status) => ({
    status,
    rawScore: (scores.get(status) ?? 0) / denominator,
  })).sort((left, right) => right.rawScore - left.rawScore);

  const top = ranked[0];
  const runnerUp = ranked[1];
  const margin = top.rawScore - runnerUp.rawScore;
  const coverage =
    saturationWeight > 0 ? Math.min(1, totalWeight / saturationWeight) : 1;
  const decisive = margin > 0;

  return {
    status: decisive ? top.status : FlowStatus.UNKNOWN,
    confidence: decisive ? roundTo(margin * coverage, CONFIDENCE_DECIMALS) : 0,
    sampleCount,
    fullFlowScore: roundTo(
      (scores.get(FlowStatus.FULL_FLOW) ?? 0) / denominator,
      SCORE_DECIMALS,
    ),
    trickleScore: roundTo(
      (scores.get(FlowStatus.TRICKLE) ?? 0) / denominator,
      SCORE_DECIMALS,
    ),
    dryScore: roundTo(
      (scores.get(FlowStatus.DRY) ?? 0) / denominator,
      SCORE_DECIMALS,
    ),
    totalWeight: roundTo(totalWeight, SCORE_DECIMALS),
    lastObservedAt: lastObservedMs === null ? null : new Date(lastObservedMs),
  };
}
