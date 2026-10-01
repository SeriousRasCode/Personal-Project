export interface AggregateWindow {
  windowStart: Date;
  windowEnd: Date;
}

export interface AggregateBucket {
  sensorId: string | null;
  windowStart: Date;
  windowEnd: Date;
  averagePressureBar: number;
  minimumPressureBar: number;
  maximumPressureBar: number;
  sampleCount: number;
  cellLongitude: number | null;
  cellLatitude: number | null;
}

const MINUTES_PER_WINDOW = 60;

export function assertWindowMinutes(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 60;
  }
  const minutes = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    throw new RangeError('windowMinutes must be a whole number of minutes');
  }
  if (minutes < 1 || minutes > 10_080) {
    throw new RangeError('windowMinutes must be between 1 and 10080');
  }
  return minutes;
}

export function windowRange(now: Date, windowMinutes: number): AggregateWindow {
  const minutes = assertWindowMinutes(windowMinutes);
  const windowEnd = new Date(now.getTime());
  const windowStart = new Date(
    now.getTime() - minutes * MINUTES_PER_WINDOW * 1_000,
  );
  return { windowStart, windowEnd };
}

export function bucketBoundaries(
  observedAt: Date,
  windowMinutes: number,
): AggregateWindow {
  const minutes = assertWindowMinutes(windowMinutes);
  const widthMs = minutes * MINUTES_PER_WINDOW * 1_000;
  const startMs = Math.floor(observedAt.getTime() / widthMs) * widthMs;
  return {
    windowStart: new Date(startMs),
    windowEnd: new Date(startMs + widthMs),
  };
}

export function averageOf(values: number[]): number {
  if (values.length === 0) {
    throw new RangeError('averageOf requires at least one value');
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return roundToThree(total / values.length);
}

export function roundToThree(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}
