import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './env.validation.js';

const validEnvironment: Record<string, unknown> = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/hydrojimma',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  USSD_CALLBACK_SECRET: 'c'.repeat(32),
  DATA_ENCRYPTION_KEY: 'd'.repeat(64),
};

describe('validateEnvironment', () => {
  it('coerces string environment values used as numbers and booleans', () => {
    const result = validateEnvironment({
      ...validEnvironment,
      PORT: '4100',
      REDIS_PORT: '6380',
      JWT_ACCESS_TTL_SECONDS: '600',
      JWT_REFRESH_TTL_SECONDS: '1209600',
      OTP_TTL_SECONDS: '600',
      S3_FORCE_PATH_STYLE: 'false',
      TRUST_PROXY: 'true',
    });

    expect(result.PORT).toBe(4100);
    expect(result.REDIS_PORT).toBe(6380);
    expect(result.JWT_ACCESS_TTL_SECONDS).toBe(600);
    expect(result.JWT_REFRESH_TTL_SECONDS).toBe(1_209_600);
    expect(result.OTP_TTL_SECONDS).toBe(600);
    expect(result.S3_FORCE_PATH_STYLE).toBe(false);
    expect(result.TRUST_PROXY).toBe(true);
  });

  it('applies documented defaults', () => {
    const result = validateEnvironment(validEnvironment);

    expect(result.PORT).toBe(3000);
    expect(result.REDIS_PORT).toBe(6379);
    expect(result.S3_FORCE_PATH_STYLE).toBe(true);
    expect(result.TRUST_PROXY).toBe(false);
  });

  it('rejects malformed numeric and boolean values', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, PORT: 'not-a-port' }),
    ).toThrow('Environment validation failed');
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        S3_FORCE_PATH_STYLE: 'sometimes',
      }),
    ).toThrow('Environment validation failed');
  });

  it('rejects an invalid timezone and wildcard CORS origin', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        APP_TIMEZONE: 'Mars/Olympus',
      }),
    ).toThrow('APP_TIMEZONE must be a valid IANA timezone');
    expect(() =>
      validateEnvironment({ ...validEnvironment, CORS_ORIGINS: '*' }),
    ).toThrow('CORS_ORIGINS cannot contain a wildcard');
  });

  it('rejects a malformed data encryption key', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, DATA_ENCRYPTION_KEY: 'abc' }),
    ).toThrow('Environment validation failed');
  });
});
