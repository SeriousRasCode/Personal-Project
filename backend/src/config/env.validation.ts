import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const nodeEnvironments = ['development', 'test', 'production'] as const;
const smsProviders = ['log', 'http'] as const;

class EnvironmentVariables {
  @IsIn(nodeEnvironments)
  @IsOptional()
  NODE_ENV: (typeof nodeEnvironments)[number] = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT = 3000;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  API_PREFIX = 'api/v1';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  REDIS_HOST = 'localhost';

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  REDIS_PORT = 6379;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET!: string;

  @IsInt()
  @Min(60)
  @IsOptional()
  JWT_ACCESS_TTL_SECONDS = 900;

  @IsInt()
  @Min(300)
  @IsOptional()
  JWT_REFRESH_TTL_SECONDS = 2_592_000;

  @IsInt()
  @Min(60)
  @IsOptional()
  OTP_TTL_SECONDS = 300;

  @IsInt()
  @Min(1)
  @Max(720)
  @IsOptional()
  CONSENSUS_WINDOW_HOURS = 24;

  @IsNumber()
  @Min(0.1)
  @Max(720)
  @IsOptional()
  CONSENSUS_HALF_LIFE_HOURS = 6;

  @IsNumber()
  @Min(0.1)
  @Max(1000)
  @IsOptional()
  CONSENSUS_SATURATION_WEIGHT = 4;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  CONSENSUS_PRIOR_WEIGHT = 0.25;

  @IsInt()
  @Min(1)
  @Max(168)
  @IsOptional()
  QUEUE_WINDOW_HOURS = 6;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  QUEUE_MIN_SAMPLES = 2;

  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  QUEUE_SATURATION_SAMPLES = 5;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  QUEUE_MIN_RELATIVE_DELTA = 0.15;

  @IsNumber()
  @Min(0)
  @Max(600)
  @IsOptional()
  QUEUE_MIN_ABSOLUTE_DELTA_MINUTES = 2;

  @IsInt()
  @Min(1)
  @Max(1440)
  @IsOptional()
  QUEUE_SNAPSHOT_MIN_INTERVAL_MINUTES = 15;

  @IsInt()
  @Min(10)
  @Max(5000)
  @IsOptional()
  LEAK_CLUSTER_RADIUS_METERS = 150;

  @IsInt()
  @Min(10)
  @Max(20000)
  @IsOptional()
  LEAK_CLUSTER_MAX_RADIUS_METERS = 400;

  @IsNumber()
  @Min(0.01)
  @Max(1)
  @IsOptional()
  LEAK_CLUSTER_CONFIDENCE_BASE = 0.4;

  @IsNumber()
  @Min(0.01)
  @Max(1)
  @IsOptional()
  LEAK_CLUSTER_CONFIDENCE_STEP = 0.2;

  @IsInt()
  @Min(250)
  @Max(300_000)
  @IsOptional()
  OUTBOX_POLL_INTERVAL_MS = 5_000;

  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  OUTBOX_BATCH_SIZE = 50;

  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  OUTBOX_MAX_ATTEMPTS = 5;

  @IsInt()
  @Min(1_000)
  @Max(600_000)
  @IsOptional()
  OUTBOX_LOCK_TIMEOUT_MS = 60_000;

  @IsInt()
  @Min(100)
  @Max(600_000)
  @IsOptional()
  OUTBOX_RETRY_BASE_MS = 1_000;

  @IsBoolean()
  @IsOptional()
  OUTBOX_POLLER_ENABLED = true;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  APP_TIMEZONE = 'Africa/Addis_Ababa';

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  CORS_ORIGINS = 'http://localhost:3001';

  @IsBoolean()
  @IsOptional()
  TRUST_PROXY = false;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  S3_ENDPOINT = 'http://localhost:4566';

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  S3_REGION = 'us-east-1';

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  S3_BUCKET = 'hydrojimma';

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  S3_ACCESS_KEY = 'test';

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  S3_SECRET_KEY = 'test';

  @IsBoolean()
  @IsOptional()
  S3_FORCE_PATH_STYLE = true;

  @IsIn(smsProviders)
  @IsOptional()
  SMS_PROVIDER: (typeof smsProviders)[number] = 'log';

  @IsOptional()
  @IsString()
  SMS_API_URL?: string;

  @IsOptional()
  @IsString()
  SMS_API_KEY?: string;

  @IsString()
  @MinLength(32)
  USSD_CALLBACK_SECRET!: string;

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  DATA_ENCRYPTION_KEY!: string;
}

function optionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function positiveInteger(value: unknown, fallback: number): unknown {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : value;
}

function finiteNumber(value: unknown, fallback: number): unknown {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function booleanValue(value: unknown, fallback: boolean): unknown {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return value;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = {
    ...environment,
    PORT: positiveInteger(environment.PORT, 3000),
    JWT_ACCESS_TTL_SECONDS: positiveInteger(
      environment.JWT_ACCESS_TTL_SECONDS,
      900,
    ),
    JWT_REFRESH_TTL_SECONDS: positiveInteger(
      environment.JWT_REFRESH_TTL_SECONDS,
      2_592_000,
    ),
    OTP_TTL_SECONDS: positiveInteger(environment.OTP_TTL_SECONDS, 300),
    CONSENSUS_WINDOW_HOURS: positiveInteger(
      environment.CONSENSUS_WINDOW_HOURS,
      24,
    ),
    CONSENSUS_HALF_LIFE_HOURS: finiteNumber(
      environment.CONSENSUS_HALF_LIFE_HOURS,
      6,
    ),
    CONSENSUS_SATURATION_WEIGHT: finiteNumber(
      environment.CONSENSUS_SATURATION_WEIGHT,
      4,
    ),
    CONSENSUS_PRIOR_WEIGHT: finiteNumber(
      environment.CONSENSUS_PRIOR_WEIGHT,
      0.25,
    ),
    QUEUE_WINDOW_HOURS: positiveInteger(environment.QUEUE_WINDOW_HOURS, 6),
    QUEUE_MIN_SAMPLES: positiveInteger(environment.QUEUE_MIN_SAMPLES, 2),
    QUEUE_SATURATION_SAMPLES: positiveInteger(
      environment.QUEUE_SATURATION_SAMPLES,
      5,
    ),
    QUEUE_MIN_RELATIVE_DELTA: finiteNumber(
      environment.QUEUE_MIN_RELATIVE_DELTA,
      0.15,
    ),
    QUEUE_MIN_ABSOLUTE_DELTA_MINUTES: finiteNumber(
      environment.QUEUE_MIN_ABSOLUTE_DELTA_MINUTES,
      2,
    ),
    QUEUE_SNAPSHOT_MIN_INTERVAL_MINUTES: positiveInteger(
      environment.QUEUE_SNAPSHOT_MIN_INTERVAL_MINUTES,
      15,
    ),
    LEAK_CLUSTER_RADIUS_METERS: positiveInteger(
      environment.LEAK_CLUSTER_RADIUS_METERS,
      150,
    ),
    LEAK_CLUSTER_MAX_RADIUS_METERS: positiveInteger(
      environment.LEAK_CLUSTER_MAX_RADIUS_METERS,
      400,
    ),
    LEAK_CLUSTER_CONFIDENCE_BASE: finiteNumber(
      environment.LEAK_CLUSTER_CONFIDENCE_BASE,
      0.4,
    ),
    LEAK_CLUSTER_CONFIDENCE_STEP: finiteNumber(
      environment.LEAK_CLUSTER_CONFIDENCE_STEP,
      0.2,
    ),
    OUTBOX_POLL_INTERVAL_MS: positiveInteger(
      environment.OUTBOX_POLL_INTERVAL_MS,
      5_000,
    ),
    OUTBOX_BATCH_SIZE: positiveInteger(environment.OUTBOX_BATCH_SIZE, 50),
    OUTBOX_MAX_ATTEMPTS: positiveInteger(environment.OUTBOX_MAX_ATTEMPTS, 5),
    OUTBOX_LOCK_TIMEOUT_MS: positiveInteger(
      environment.OUTBOX_LOCK_TIMEOUT_MS,
      60_000,
    ),
    OUTBOX_RETRY_BASE_MS: positiveInteger(
      environment.OUTBOX_RETRY_BASE_MS,
      1_000,
    ),
    OUTBOX_POLLER_ENABLED: booleanValue(
      environment.OUTBOX_POLLER_ENABLED,
      true,
    ),
    REDIS_PORT: positiveInteger(environment.REDIS_PORT, 6379),
    S3_FORCE_PATH_STYLE: booleanValue(environment.S3_FORCE_PATH_STYLE, true),
    TRUST_PROXY: booleanValue(environment.TRUST_PROXY, false),
    REDIS_PASSWORD: optionalString(
      environment.REDIS_PASSWORD as string | undefined,
    ),
    SMS_API_URL: optionalString(environment.SMS_API_URL as string | undefined),
    SMS_API_KEY: optionalString(environment.SMS_API_KEY as string | undefined),
  };
  const config = plainToInstance(EnvironmentVariables, normalized, {
    exposeDefaultValues: true,
  });
  const errors = validateSync(config, {
    forbidUnknownValues: true,
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed: ${details}`);
  }

  if (!isTimeZone(config.APP_TIMEZONE)) {
    throw new Error('APP_TIMEZONE must be a valid IANA timezone');
  }

  if (
    config.LEAK_CLUSTER_MAX_RADIUS_METERS < config.LEAK_CLUSTER_RADIUS_METERS
  ) {
    throw new Error(
      'LEAK_CLUSTER_MAX_RADIUS_METERS must be at least LEAK_CLUSTER_RADIUS_METERS',
    );
  }

  if (config.CORS_ORIGINS.split(',').some((origin) => origin.trim() === '*')) {
    throw new Error(
      'CORS_ORIGINS cannot contain a wildcard when credentials are enabled',
    );
  }

  if (config.OUTBOX_POLL_INTERVAL_MS >= config.OUTBOX_LOCK_TIMEOUT_MS) {
    throw new Error(
      'OUTBOX_POLL_INTERVAL_MS must be shorter than OUTBOX_LOCK_TIMEOUT_MS',
    );
  }

  if (
    config.NODE_ENV === 'production' &&
    [config.JWT_ACCESS_SECRET, config.JWT_REFRESH_SECRET].some((secret) =>
      secret.startsWith('replace-with'),
    )
  ) {
    throw new Error('Production JWT secrets must be explicitly configured');
  }

  if (
    config.NODE_ENV === 'production' &&
    /^0+$/.test(config.DATA_ENCRYPTION_KEY)
  ) {
    throw new Error(
      'Production DATA_ENCRYPTION_KEY must be explicitly configured',
    );
  }

  return { ...environment, ...config };
}
