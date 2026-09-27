import { BadRequestException } from '@nestjs/common';
import { GeoJsonResponseDto } from './dto/common.dto.js';
import { isValidGeometry, isValidPoint } from './geometry.js';
import { parseJsonValue, RawRow, rowValue } from './raw.js';

export function mapPoint(
  row: RawRow,
  prefix: string,
): { longitude: number; latitude: number } | null {
  let longitude = rowValue(row, `${prefix}Longitude`);
  let latitude = rowValue(row, `${prefix}Latitude`);
  if (longitude === undefined || latitude === undefined) {
    const parsed = parseJsonValue(
      rowValue(row, `${prefix}GeoJson`),
      `${prefix} geometry`,
    );
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'coordinates' in parsed &&
      Array.isArray(parsed.coordinates)
    ) {
      longitude = parsed.coordinates[0];
      latitude = parsed.coordinates[1];
    }
  }
  if (longitude === null || latitude === null) {
    return null;
  }
  const point = {
    longitude: Number(longitude),
    latitude: Number(latitude),
  };
  if (!isValidPoint(point)) {
    return null;
  }
  return point;
}

export function mapGeoJson(
  row: RawRow,
  prefix: string,
  expectedType?: 'LineString' | 'MultiPolygon',
): GeoJsonResponseDto | null {
  const value = rowValue(row, `${prefix}GeoJson`);
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = parseJsonValue(value, `${prefix} geometry`);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    !('coordinates' in parsed) ||
    typeof parsed.type !== 'string'
  ) {
    throw new BadRequestException(`${prefix} geometry is invalid`);
  }
  const geometry = { type: parsed.type, coordinates: parsed.coordinates };
  if (expectedType && !isValidGeometry(geometry, expectedType)) {
    throw new BadRequestException(`${prefix} geometry is invalid`);
  }
  return geometry;
}
