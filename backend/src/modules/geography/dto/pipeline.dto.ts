import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ExpectedUpdatedAtDto,
  GeoJsonResponseDto,
  LineStringGeometryDto,
} from './common.dto.js';

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export class CreatePipelineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  kebeleId!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 60, nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  material?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 5000, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  diameterMillimeters?: number | null;

  @ApiProperty({ type: LineStringGeometryDto })
  @ValidateNested()
  @Type(() => LineStringGeometryDto)
  path!: LineStringGeometryDto;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(dateOnlyPattern)
  installedAt?: string | null;

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePipelineDto extends ExpectedUpdatedAtDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID('4')
  kebeleId?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 60, nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  material?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 5000, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  diameterMillimeters?: number | null;

  @ApiPropertyOptional({ type: LineStringGeometryDto })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @ValidateNested()
  @Type(() => LineStringGeometryDto)
  path?: LineStringGeometryDto;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(dateOnlyPattern)
  installedAt?: string | null;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class PipelineResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  kebeleId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  material!: string | null;

  @ApiProperty({ nullable: true, minimum: 1 })
  diameterMillimeters!: number | null;

  @ApiProperty({ type: GeoJsonResponseDto })
  path!: GeoJsonResponseDto;

  @ApiProperty({ format: 'date', nullable: true })
  installedAt!: Date | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class PublicPipelineResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  kebeleId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: GeoJsonResponseDto })
  path!: GeoJsonResponseDto;

  @ApiProperty({ format: 'date', nullable: true })
  installedAt!: Date | null;
}

export { GeoJsonResponseDto };
