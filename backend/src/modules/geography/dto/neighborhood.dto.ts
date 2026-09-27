import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CoordinateDto,
  ExpectedUpdatedAtDto,
  GeoJsonResponseDto,
  GeoPointResponseDto,
  MultiPolygonGeometryDto,
} from './common.dto.js';

export class CreateNeighborhoodDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  kebeleId!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ maxLength: 40 })
  @IsString()
  @Length(1, 40)
  code!: string;

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: CoordinateDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinateDto)
  center?: CoordinateDto | null;

  @ApiPropertyOptional({ type: MultiPolygonGeometryDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => MultiPolygonGeometryDto)
  boundary?: MultiPolygonGeometryDto | null;
}

export class UpdateNeighborhoodDto extends ExpectedUpdatedAtDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID('4')
  kebeleId?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 40)
  code?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: CoordinateDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinateDto)
  center?: CoordinateDto | null;

  @ApiPropertyOptional({ type: MultiPolygonGeometryDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => MultiPolygonGeometryDto)
  boundary?: MultiPolygonGeometryDto | null;
}

export class NeighborhoodResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  kebeleId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: GeoPointResponseDto, nullable: true })
  center!: GeoPointResponseDto | null;

  @ApiProperty({ type: GeoJsonResponseDto, nullable: true })
  boundary!: GeoJsonResponseDto | null;
}

export class PublicNeighborhoodResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  kebeleId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ type: GeoPointResponseDto, nullable: true })
  center!: GeoPointResponseDto | null;

  @ApiProperty({ type: GeoJsonResponseDto, nullable: true })
  boundary!: GeoJsonResponseDto | null;
}

export { GeoJsonResponseDto, GeoPointResponseDto };
