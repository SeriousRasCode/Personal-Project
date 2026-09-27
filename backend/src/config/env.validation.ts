import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
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

  if (config.CORS_ORIGINS.split(',').some((origin) => origin.trim() === '*')) {
    throw new Error(
      'CORS_ORIGINS cannot contain a wildcard when credentials are enabled',
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
