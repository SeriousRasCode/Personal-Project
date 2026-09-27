import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

const geoJsonTypes = [
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
] as const;

export class GeoPointDto {
  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @Type(() => Number)
  @IsLatitude()
  latitude: number;
}

export class GeoJsonDto {
  @IsIn(geoJsonTypes)
  type: (typeof geoJsonTypes)[number];

  @IsArray()
  coordinates: unknown[];
}

export class GeoPointInputDto {
  @ValidateNested()
  @Type(() => GeoPointDto)
  point: GeoPointDto;

  @IsOptional()
  @IsString()
  label?: string;
}
