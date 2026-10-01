import { createHmac, timingSafeEqual } from 'node:crypto';

export const USSD_SIGNATURE_HEADER = 'x-ussd-signature';
export const USSD_TIMESTAMP_HEADER = 'x-ussd-timestamp';
export const DEFAULT_SIGNATURE_SKEW_SECONDS = 300;

export interface UssdSignatureInput {
  timestamp: string;
  body: string;
  signature: string;
}

/**
 * Signs `${timestamp}.${body}` with HMAC-SHA256 so a callback cannot be replayed
 * against a different payload or a rewritten timestamp.
 */
export function signCallback(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

export function isValidTimestamp(
  timestamp: string,
  now: Date = new Date(),
  skewSeconds: number = DEFAULT_SIGNATURE_SKEW_SECONDS,
): boolean {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return Math.abs(now.getTime() - parsed) <= skewSeconds * 1_000;
}

export function verifyCallback(
  secret: string,
  input: UssdSignatureInput,
  now: Date = new Date(),
  skewSeconds: number = DEFAULT_SIGNATURE_SKEW_SECONDS,
): boolean {
  if (!isValidTimestamp(input.timestamp, now, skewSeconds)) {
    return false;
  }

  const expected = signCallback(secret, input.timestamp, input.body);
  const provided = input.signature.toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(provided)) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(provided, 'hex'),
  );
}
