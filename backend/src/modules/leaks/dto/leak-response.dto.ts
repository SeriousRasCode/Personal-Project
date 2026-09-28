import { ApiProperty } from '@nestjs/swagger';
import { GeoPointDto } from '../../../common/dto/geo.dto.js';
import { PageMetaDto } from '../../../common/dto/pagination.dto.js';
import {
  LeakSeverity,
  LeakStatus,
  ReportSource,
} from '../../../generated/prisma/enums.js';

export class LeakReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  reportedById: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  clusterId: string | null;

  @ApiProperty({ format: 'uuid' })
  kebeleId: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  neighborhoodId: string | null;

  @ApiProperty({ type: GeoPointDto })
  location: GeoPointDto;

  @ApiProperty()
  description: string;

  @ApiProperty({ nullable: true })
  photoObjectKey: string | null;

  @ApiProperty({ enum: LeakSeverity })
  severity: LeakSeverity;

  @ApiProperty({ enum: LeakStatus })
  status: LeakStatus;

  @ApiProperty({ enum: ReportSource })
  source: ReportSource;

  @ApiProperty({ type: Number })
  confidence: number;

  @ApiProperty({ format: 'date-time' })
  observedAt: Date;

  @ApiProperty({ format: 'date-time', nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

export class LeakClusterResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ format: 'uuid' })
  kebeleId: string;

  @ApiProperty()
  kebeleCode: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  neighborhoodId: string | null;

  @ApiProperty({ type: Number, nullable: true })
  centroidLongitude: number | null;

  @ApiProperty({ type: Number, nullable: true })
  centroidLatitude: number | null;

  @ApiProperty({ nullable: true })
  centroidGeoJson: Record<string, unknown> | null;

  @ApiProperty({ type: Number, nullable: true })
  radiusMeters: number | null;

  @ApiProperty({ enum: LeakSeverity })
  severity: LeakSeverity;

  @ApiProperty({ enum: LeakStatus })
  status: LeakStatus;

  @ApiProperty({ type: Number })
  reportCount: number;

  @ApiProperty({ type: Number })
  confidence: number;

  @ApiProperty({ format: 'date-time' })
  firstReportedAt: Date;

  @ApiProperty({ format: 'date-time' })
  lastReportedAt: Date;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}

export class LeakReportCreatedResponseDto {
  @ApiProperty({ type: LeakReportResponseDto })
  report: LeakReportResponseDto;

  @ApiProperty({ type: LeakClusterResponseDto })
  cluster: LeakClusterResponseDto;

  @ApiProperty({
    description: 'True when the report joined an existing cluster',
  })
  attachedToExistingCluster: boolean;
}

export class LeakClusterDetailResponseDto {
  @ApiProperty({ type: LeakClusterResponseDto })
  cluster: LeakClusterResponseDto;

  @ApiProperty({ type: [LeakReportResponseDto] })
  reports: LeakReportResponseDto[];
}

export class PublicLeakClusterResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  kebeleCode: string;

  @ApiProperty({ type: Number, nullable: true })
  centroidLongitude: number | null;

  @ApiProperty({ type: Number, nullable: true })
  centroidLatitude: number | null;

  @ApiProperty({ enum: LeakSeverity })
  severity: LeakSeverity;

  @ApiProperty({ enum: LeakStatus })
  status: LeakStatus;

  @ApiProperty({ type: Number })
  reportCount: number;

  @ApiProperty({ type: Number })
  confidence: number;

  @ApiProperty({ format: 'date-time' })
  lastReportedAt: Date;
}

export class LeakReportListResponseDto {
  @ApiProperty({ type: [LeakReportResponseDto] })
  items: LeakReportResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class LeakClusterListResponseDto {
  @ApiProperty({ type: [LeakClusterResponseDto] })
  items: LeakClusterResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class PublicLeakClusterListResponseDto {
  @ApiProperty({ type: [PublicLeakClusterResponseDto] })
  items: PublicLeakClusterResponseDto[];
}
