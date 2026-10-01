import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import {
  SensorStatus,
  SensorType,
  TelemetrySource,
} from '../../../generated/prisma/enums.js';
import { CoordinateDto } from '../../geography/dto/common.dto.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListSensorsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  standpipeId?: string;

  @ApiPropertyOptional({ enum: SensorType })
  @IsOptional()
  @IsEnum(SensorType)
  type?: SensorType;

  @ApiPropertyOptional({ enum: SensorStatus })
  @IsOptional()
  @IsEnum(SensorStatus)
  status?: SensorStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  kebeleId?: string;
}

export class ListReadingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sensorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  standpipeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class PressureStatsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  standpipeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sensorId?: string;

  @ApiProperty({ description: 'Window length in minutes, defaults to 1440' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_080)
  windowMinutes?: number;
}

export class ListAggregatesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sensorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  standpipeId?: string;
}

export class CreateSensorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  standpipeId?: string;

  @ApiPropertyOptional({
    description: 'Stable device identifier used for dedupe',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  externalId?: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional({ enum: SensorType, default: SensorType.PRESSURE })
  @IsOptional()
  @IsEnum(SensorType)
  type?: SensorType;

  @ApiPropertyOptional({ enum: SensorStatus, default: SensorStatus.ACTIVE })
  @IsOptional()
  @IsEnum(SensorStatus)
  status?: SensorStatus;

  @ApiPropertyOptional({ type: CoordinateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinateDto)
  location?: CoordinateDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateSensorDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional({ enum: SensorType })
  @IsOptional()
  @IsEnum(SensorType)
  type?: SensorType;

  @ApiPropertyOptional({ enum: SensorStatus })
  @IsOptional()
  @IsEnum(SensorStatus)
  status?: SensorStatus;

  @ApiPropertyOptional({ type: CoordinateDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinateDto)
  location?: CoordinateDto | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;

  @ApiProperty({ description: 'Optimistic lock token from the read response' })
  @IsISO8601({ strict: true })
  expectedUpdatedAt: string;
}

export class RecordReadingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sensorId?: string;

  @ApiProperty({ example: 3.42 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9999.999)
  pressureBar: number;

  @ApiPropertyOptional({ example: 0.75 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999.999)
  flowLitersPerSecond?: number;

  @ApiPropertyOptional({ type: CoordinateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinateDto)
  location?: CoordinateDto;

  @ApiProperty({ enum: TelemetrySource, default: TelemetrySource.MANUAL })
  @IsEnum(TelemetrySource)
  source: TelemetrySource;

  @ApiPropertyOptional({
    description: 'Device reading id, used to reject replays',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  externalId?: string;

  @ApiProperty({ description: 'When the measurement was taken' })
  @IsISO8601({ strict: true })
  observedAt: string;
}

export class BatchReadingsDto {
  @ApiProperty({ type: [RecordReadingDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RecordReadingDto)
  readings: RecordReadingDto[];
}

export class RebuildAggregatesDto {
  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_080)
  windowMinutes?: number;
}

export class TelemetryIngestKeyDto {
  @ApiPropertyOptional({ description: 'Hex encoded HMAC of the request body' })
  @IsOptional()
  @Matches(/^[0-9a-f]{64}$/i)
  signature?: string;
}
