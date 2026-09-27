import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

export interface PointValue {
  longitude: number;
  latitude: number;
}

export interface GeoJsonValue {
  type: string;
  coordinates: unknown;
}

export type SupportedGeometryType = 'LineString' | 'MultiPolygon';

type Position = number[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1]) &&
    value.every((coordinate) => isFiniteNumber(coordinate)) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function samePosition(left: Position, right: Position): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function orientation(
  first: Position,
  second: Position,
  third: Position,
): number {
  return (
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0])
  );
}

function onSegment(
  first: Position,
  second: Position,
  point: Position,
): boolean {
  return (
    Math.min(first[0], second[0]) <= point[0] &&
    point[0] <= Math.max(first[0], second[0]) &&
    Math.min(first[1], second[1]) <= point[1] &&
    point[1] <= Math.max(first[1], second[1])
  );
}

function segmentsIntersect(
  firstStart: Position,
  firstEnd: Position,
  secondStart: Position,
  secondEnd: Position,
): boolean {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart);
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);

  if (
    firstOrientation !== 0 &&
    secondOrientation !== 0 &&
    thirdOrientation !== 0 &&
    fourthOrientation !== 0 &&
    Math.sign(firstOrientation) !== Math.sign(secondOrientation) &&
    Math.sign(thirdOrientation) !== Math.sign(fourthOrientation)
  ) {
    return true;
  }

  return (
    (firstOrientation === 0 && onSegment(firstStart, firstEnd, secondStart)) ||
    (secondOrientation === 0 && onSegment(firstStart, firstEnd, secondEnd)) ||
    (thirdOrientation === 0 && onSegment(secondStart, secondEnd, firstStart)) ||
    (fourthOrientation === 0 && onSegment(secondStart, secondEnd, firstEnd))
  );
}

function hasSelfIntersection(ring: Position[]): boolean {
  const segmentCount = ring.length - 1;
  for (let firstIndex = 0; firstIndex < segmentCount; firstIndex += 1) {
    const firstStart = ring[firstIndex];
    const firstEnd = ring[firstIndex + 1];
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < segmentCount;
      secondIndex += 1
    ) {
      const adjacent =
        secondIndex === firstIndex + 1 ||
        (firstIndex === 0 && secondIndex === segmentCount - 1);
      if (adjacent) {
        continue;
      }
      if (
        segmentsIntersect(
          firstStart,
          firstEnd,
          ring[secondIndex],
          ring[secondIndex + 1],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function isValidLineString(coordinates: unknown): boolean {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return false;
  }
  if (!coordinates.every((position) => isPosition(position))) {
    return false;
  }
  const first = coordinates[0];
  return coordinates.some(
    (position, index) => index > 0 && !samePosition(first, position),
  );
}

function isValidMultiPolygon(coordinates: unknown): boolean {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return false;
  }
  return coordinates.every((polygon) => {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      return false;
    }
    return polygon.every((ring) => {
      if (!Array.isArray(ring) || ring.length < 4) {
        return false;
      }
      if (!ring.every((position) => isPosition(position))) {
        return false;
      }
      const positions = ring;
      return (
        samePosition(positions[0], positions[positions.length - 1]) &&
        !hasSelfIntersection(positions)
      );
    });
  });
}

export function isValidPoint(value: unknown): value is PointValue {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isFiniteNumber(value.longitude) &&
    isFiniteNumber(value.latitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180 &&
    value.latitude >= -90 &&
    value.latitude <= 90
  );
}

export function isValidGeometry(
  value: unknown,
  expectedType: SupportedGeometryType,
): value is GeoJsonValue {
  if (!isRecord(value) || value.type !== expectedType) {
    return false;
  }
  if (expectedType === 'LineString') {
    return isValidLineString(value.coordinates);
  }
  return isValidMultiPolygon(value.coordinates);
}

export function assertPoint(value: unknown, fieldName = 'point'): PointValue {
  if (!isValidPoint(value)) {
    throw new BadRequestException(
      `${fieldName} must contain valid coordinates`,
    );
  }
  return value;
}

export function assertGeometry(
  value: unknown,
  expectedType: SupportedGeometryType,
  fieldName = 'geometry',
): GeoJsonValue {
  if (!isValidGeometry(value, expectedType)) {
    throw new BadRequestException(
      `${fieldName} must be a valid GeoJSON ${expectedType}`,
    );
  }
  return value;
}

export function pointSql(value: unknown, fieldName = 'point'): Prisma.Sql {
  const point = assertPoint(value, fieldName);
  return Prisma.sql`ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326)`;
}

export function geometrySql(
  value: unknown,
  expectedType: SupportedGeometryType,
  fieldName = 'geometry',
): Prisma.Sql {
  const geometry = assertGeometry(value, expectedType, fieldName);
  const serialized = JSON.stringify(geometry);
  if (serialized === undefined) {
    throw new BadRequestException(`${fieldName} could not be serialized`);
  }
  return Prisma.sql`ST_SetSRID(ST_GeomFromGeoJSON(${serialized}), 4326)`;
}
