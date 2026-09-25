function toPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
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
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: toPositiveInteger(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD,
  },
  storage: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'hydrojimma',
    accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    forcePathStyle: toBoolean(process.env.S3_FORCE_PATH_STYLE, true),
  },
  sms: {
    provider: process.env.SMS_PROVIDER ?? 'log',
    apiUrl: process.env.SMS_API_URL,
    apiKey: process.env.SMS_API_KEY,
  },
  ussdCallbackSecret: process.env.USSD_CALLBACK_SECRET,
});
