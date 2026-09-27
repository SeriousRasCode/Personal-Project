import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime, IANAZone } from 'luxon';

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
export const defaultApplicationTimezone = 'Africa/Addis_Ababa';

export function getApplicationTimezone(configService: ConfigService): string {
  const timezone =
    configService.get<string>('appTimezone') ?? defaultApplicationTimezone;
  if (!IANAZone.isValidZone(timezone)) {
    throw new InternalServerErrorException('Application timezone is invalid');
  }
  return timezone;
}

export function parseDateOnly(
  value: unknown,
  fieldName: string,
  timezone: string,
  current: DateTime = DateTime.now(),
  disallowFuture = false,
): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (!IANAZone.isValidZone(timezone)) {
    throw new InternalServerErrorException('Application timezone is invalid');
  }

  let parsed: DateTime;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid date`);
    }
    parsed = DateTime.fromJSDate(value, { zone: 'utc' }).setZone(timezone);
  } else if (typeof value === 'string' && dateOnlyPattern.test(value)) {
    parsed = DateTime.fromISO(value, { zone: timezone }).startOf('day');
  } else {
    throw new BadRequestException(
      `${fieldName} must be a date in YYYY-MM-DD format`,
    );
  }

  const date = parsed.toISODate();
  if (!parsed.isValid || date === null) {
    throw new BadRequestException(`${fieldName} must be a valid date`);
  }
  const today = current.setZone(timezone).toISODate();
  if (disallowFuture && today !== null && date > today) {
    throw new BadRequestException(`${fieldName} cannot be in the future`);
  }
  return date;
}
