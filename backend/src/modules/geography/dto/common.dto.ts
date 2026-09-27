import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

export function transformBooleanQuery(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return value;
}

export class CoordinateDto {
  @ApiProperty({ example: 36.8319, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiProperty({ example: 7.6667, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  latitude!: number;
}

export class GeoJsonGeometryDto {
  @ApiProperty({ enum: ['LineString', 'MultiPolygon'] })
  @IsString()
  @IsIn(['LineString', 'MultiPolygon'])
  type!: 'LineString' | 'MultiPolygon';

  @ApiProperty({ type: [Array] })
  @IsArray()
  coordinates!: unknown;
}

export class LineStringGeometryDto extends GeoJsonGeometryDto {
  @ApiProperty({ enum: ['LineString'], default: 'LineString' })
  @IsString()
  @IsIn(['LineString'])
  declare type: 'LineString';
}

export class MultiPolygonGeometryDto extends GeoJsonGeometryDto {
  @ApiProperty({ enum: ['MultiPolygon'], default: 'MultiPolygon' })
  @IsString()
  @IsIn(['MultiPolygon'])
  declare type: 'MultiPolygon';
}

export class ExpectedUpdatedAtDto {
  @ApiPropertyOptional({
    description: 'The updatedAt value returned by the previous read',
    format: 'date-time',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsDateString()
  expectedUpdatedAt?: string;

  @ApiPropertyOptional({
    description: 'Compatibility alias for expectedUpdatedAt',
    format: 'date-time',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsDateString()
  updatedAt?: string;
}

export class ActiveSearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ type: Boolean })
  @Transform(({ value }: { value: unknown }) => transformBooleanQuery(value))
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 120)
  search?: string;
}

export class NeighborhoodQueryDto extends ActiveSearchQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID('4')
  kebeleId?: string;
}

export class PipelineQueryDto extends ActiveSearchQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID('4')
  kebeleId?: string;
}

export class ValveQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID('4')
  kebeleId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @Transform(({ value }: { value: unknown }) => transformBooleanQuery(value))
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isOpen?: boolean;

  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 120)
  search?: string;
}

export class GeoPointResponseDto extends CoordinateDto {
  @ApiProperty({ example: 36.8319 })
  declare longitude: number;

  @ApiProperty({ example: 7.6667 })
  declare latitude: number;
}

export class GeoJsonResponseDto {
  @ApiProperty({ enum: ['LineString', 'MultiPolygon'] })
  type!: string;

  @ApiProperty({ type: [Array] })
  coordinates!: unknown;
}
