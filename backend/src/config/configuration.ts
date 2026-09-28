function toPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeNumber(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function toBoolean(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export default () => ({
  port: toPositiveInteger(process.env.PORT, 3000),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  appTimezone: process.env.APP_TIMEZONE ?? 'Africa/Addis_Ababa',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  trustProxy: toBoolean(process.env.TRUST_PROXY, false),
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTtlSeconds: toPositiveInteger(
      process.env.JWT_ACCESS_TTL_SECONDS,
      900,
    ),
    refreshTtlSeconds: toPositiveInteger(
      process.env.JWT_REFRESH_TTL_SECONDS,
      2_592_000,
    ),
  },
  otpTtlSeconds: toPositiveInteger(process.env.OTP_TTL_SECONDS, 300),
  consensus: {
    windowHours: toPositiveInteger(process.env.CONSENSUS_WINDOW_HOURS, 24),
    halfLifeHours: toPositiveNumber(process.env.CONSENSUS_HALF_LIFE_HOURS, 6),
    saturationWeight: toPositiveNumber(
      process.env.CONSENSUS_SATURATION_WEIGHT,
      4,
    ),
    priorWeight: toPositiveNumber(process.env.CONSENSUS_PRIOR_WEIGHT, 0.25),
    queue: {
      windowHours: toPositiveInteger(process.env.QUEUE_WINDOW_HOURS, 6),
      minSamples: toPositiveInteger(process.env.QUEUE_MIN_SAMPLES, 2),
      saturationSamples: toPositiveInteger(
        process.env.QUEUE_SATURATION_SAMPLES,
        5,
      ),
      minRelativeDelta: toNonNegativeNumber(
        process.env.QUEUE_MIN_RELATIVE_DELTA,
        0.15,
      ),
      minAbsoluteDeltaMinutes: toNonNegativeNumber(
        process.env.QUEUE_MIN_ABSOLUTE_DELTA_MINUTES,
        2,
      ),
      snapshotMinIntervalMinutes: toPositiveInteger(
        process.env.QUEUE_SNAPSHOT_MIN_INTERVAL_MINUTES,
        15,
      ),
    },
  },
  leaks: {
    clusterRadiusMeters: toPositiveInteger(
      process.env.LEAK_CLUSTER_RADIUS_METERS,
      150,
    ),
    clusterMaxRadiusMeters: toPositiveInteger(
      process.env.LEAK_CLUSTER_MAX_RADIUS_METERS,
      400,
    ),
    clusterConfidenceBase: toPositiveNumber(
      process.env.LEAK_CLUSTER_CONFIDENCE_BASE,
      0.4,
    ),
    clusterConfidenceStep: toPositiveNumber(
      process.env.LEAK_CLUSTER_CONFIDENCE_STEP,
      0.2,
    ),
  },
  encryption: {
    key: process.env.DATA_ENCRYPTION_KEY,
  },
  outbox: {
    pollerEnabled: toBoolean(process.env.OUTBOX_POLLER_ENABLED, true),
    pollIntervalMs: toPositiveInteger(
      process.env.OUTBOX_POLL_INTERVAL_MS,
      5_000,
    ),
    batchSize: toPositiveInteger(process.env.OUTBOX_BATCH_SIZE, 50),
    maxAttempts: toPositiveInteger(process.env.OUTBOX_MAX_ATTEMPTS, 5),
    lockTimeoutMs: toPositiveInteger(
      process.env.OUTBOX_LOCK_TIMEOUT_MS,
      60_000,
    ),
    retryBaseMs: toPositiveInteger(process.env.OUTBOX_RETRY_BASE_MS, 1_000),
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: toPositiveInteger(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD,
  },
  storage: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:4566',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'hydrojimma',
    accessKey: process.env.S3_ACCESS_KEY ?? 'test',
    secretKey: process.env.S3_SECRET_KEY ?? 'test',
    forcePathStyle: toBoolean(process.env.S3_FORCE_PATH_STYLE, true),
  },
  sms: {
    provider: process.env.SMS_PROVIDER ?? 'log',
    apiUrl: process.env.SMS_API_URL,
    apiKey: process.env.SMS_API_KEY,
  },
  ussdCallbackSecret: process.env.USSD_CALLBACK_SECRET,
});
