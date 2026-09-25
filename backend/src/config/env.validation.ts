import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  S3_ENDPOINT = 'http://localhost:9000';

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
  S3_ACCESS_KEY = 'minioadmin';

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  S3_SECRET_KEY = 'minioadmin';

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
}

function optionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = {
    ...environment,
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

  if (
    config.NODE_ENV === 'production' &&
    [config.JWT_ACCESS_SECRET, config.JWT_REFRESH_SECRET].some((secret) =>
      secret.startsWith('replace-with'),
    )
  ) {
    throw new Error('Production JWT secrets must be explicitly configured');
  }

  return { ...environment, ...config };
}
