import { BadRequestException } from '@nestjs/common';

export const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
export const PHONE_VALIDATION_MESSAGE =
  'Phone number must be a valid E.164 number';

export function compactPhone(value: string): string {
  return value.trim().replace(/[()\s.-]/g, '');
}

export function isValidPhone(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const compact = compactPhone(value);
  const candidate = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  return E164_PHONE_PATTERN.test(candidate);
}

export function normalizePhone(value: string): string {
  if (!isValidPhone(value)) {
    throw new BadRequestException(PHONE_VALIDATION_MESSAGE);
  }

  const compact = compactPhone(value);
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}
