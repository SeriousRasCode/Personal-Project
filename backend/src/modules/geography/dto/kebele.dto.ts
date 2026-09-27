import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
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

export class CreateKebeleDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ maxLength: 30 })
  @IsString()
  @Length(1, 30)
  code!: string;

  @ApiPropertyOptional({ minimum: 0, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  population?: number | null;

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

export class UpdateKebeleDto extends ExpectedUpdatedAtDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 30)
  code?: string;

  @ApiPropertyOptional({ minimum: 0, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  population?: number | null;

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

export class KebeleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ nullable: true, minimum: 0 })
  population!: number | null;

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

export class PublicKebeleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ nullable: true, minimum: 0 })
  population!: number | null;

  @ApiProperty({ type: GeoPointResponseDto, nullable: true })
  center!: GeoPointResponseDto | null;

  @ApiProperty({ type: GeoJsonResponseDto, nullable: true })
  boundary!: GeoJsonResponseDto | null;
}

export { GeoJsonResponseDto, GeoPointResponseDto };
