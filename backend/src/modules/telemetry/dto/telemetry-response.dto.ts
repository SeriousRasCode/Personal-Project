import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SensorStatus,
  SensorType,
  TelemetrySource,
} from '../../../generated/prisma/enums.js';

export class SensorResponseDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) standpipeId!: string | null;
  @ApiPropertyOptional({ nullable: true }) externalId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: SensorType }) type!: SensorType;
  @ApiProperty({ enum: SensorStatus }) status!: SensorStatus;
  @ApiPropertyOptional({ nullable: true }) locationLongitude!: number | null;
  @ApiPropertyOptional({ nullable: true }) locationLatitude!: number | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  metadata!: Record<string, unknown> | null;
  @ApiPropertyOptional({ nullable: true }) lastSeenAt!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class PressureReadingResponseDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) sensorId!: string | null;
  @ApiProperty() pressureBar!: number;
  @ApiPropertyOptional({ nullable: true })
  flowLitersPerSecond!: number | null;
  @ApiPropertyOptional({ nullable: true }) locationLongitude!: number | null;
  @ApiPropertyOptional({ nullable: true }) locationLatitude!: number | null;
  @ApiProperty({ enum: TelemetrySource }) source!: TelemetrySource;
  @ApiPropertyOptional({ nullable: true }) externalId!: string | null;
  @ApiProperty() observedAt!: string;
  @ApiProperty() receivedAt!: string;
  @ApiPropertyOptional({ nullable: true }) createdById!: string | null;
}

export class RecordReadingResultDto {
  @ApiProperty() created!: boolean;
  @ApiProperty({ description: 'Rows accepted by the ingest call' })
  accepted!: number;
  @ApiProperty({
    description: 'Rows skipped because externalId already existed',
  })
  duplicates!: number;
  @ApiProperty({ type: [PressureReadingResponseDto] })
  readings!: PressureReadingResponseDto[];
}

export class PressureAggregateResponseDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) sensorId!: string | null;
  @ApiProperty() windowStart!: string;
  @ApiProperty() windowEnd!: string;
  @ApiProperty() averagePressureBar!: number;
  @ApiProperty() minimumPressureBar!: number;
  @ApiProperty() maximumPressureBar!: number;
  @ApiProperty() sampleCount!: number;
  @ApiPropertyOptional({ nullable: true }) cellLongitude!: number | null;
  @ApiPropertyOptional({ nullable: true }) cellLatitude!: number | null;
}

export class RebuildAggregatesResultDto {
  @ApiProperty() windowMinutes!: number;
  @ApiProperty() windowStart!: string;
  @ApiProperty() windowEnd!: string;
  @ApiProperty() bucketsWritten!: number;
  @ApiProperty() readingsScanned!: number;
}

export class PressureStatsResponseDto {
  @ApiPropertyOptional({ nullable: true }) standpipeId!: string | null;
  @ApiPropertyOptional({ nullable: true }) sensorId!: string | null;
  @ApiProperty() windowStart!: string;
  @ApiProperty() windowEnd!: string;
  @ApiProperty({ nullable: true }) averagePressureBar!: number | null;
  @ApiProperty({ nullable: true }) minimumPressureBar!: number | null;
  @ApiProperty({ nullable: true }) maximumPressureBar!: number | null;
  @ApiProperty() sampleCount!: number;
  @ApiProperty({ nullable: true })
  lowPressureSampleCount!: number | null;
  @ApiProperty({ nullable: true }) lowPressureThresholdBar!: number;
}
