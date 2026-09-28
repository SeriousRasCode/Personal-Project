import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/dto/pagination.dto.js';
import {
  FlowStatus,
  QueueTrend,
  ReportSource,
} from '../../../generated/prisma/enums.js';

export { PageMetaDto };

export class TapStatusReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  standpipeId: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  reportedById: string | null;

  @ApiProperty({ enum: FlowStatus })
  status: FlowStatus;

  @ApiProperty({ enum: ReportSource })
  source: ReportSource;

  @ApiProperty()
  reliabilityWeight: number;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty()
  observedAt: Date;

  @ApiProperty()
  createdAt: Date;
}

export class QueueWaitReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  standpipeId: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  reportedById: string | null;

  @ApiProperty()
  waitMinutes: number;

  @ApiProperty({ nullable: true })
  queueSize: number | null;

  @ApiProperty({ enum: ReportSource })
  source: ReportSource;

  @ApiProperty()
  reliabilityWeight: number;

  @ApiProperty()
  observedAt: Date;

  @ApiProperty()
  createdAt: Date;
}

export class TapConsensusResponseDto {
  @ApiProperty({ format: 'uuid' })
  standpipeId: string;

  @ApiProperty({ enum: FlowStatus })
  status: FlowStatus;

  @ApiProperty()
  confidence: number;

  @ApiProperty()
  sampleCount: number;

  @ApiProperty()
  fullFlowScore: number;

  @ApiProperty()
  trickleScore: number;

  @ApiProperty()
  dryScore: number;

  @ApiProperty()
  lastCalculatedAt: Date;

  @ApiProperty({ nullable: true })
  lastObservedAt: Date | null;
}

export class QueueSnapshotResponseDto {
  @ApiProperty({ format: 'uuid' })
  standpipeId: string;

  @ApiProperty()
  waitMinutes: number;

  @ApiProperty({ nullable: true })
  queueSize: number | null;

  @ApiProperty({ enum: QueueTrend })
  trend: QueueTrend;

  @ApiProperty()
  confidence: number;

  @ApiProperty()
  sampleCount: number;

  @ApiProperty()
  lastCalculatedAt: Date;
}

export class TapStatusReportCreatedResponseDto {
  @ApiProperty({ type: TapStatusReportResponseDto })
  report: TapStatusReportResponseDto;

  @ApiProperty({ type: TapConsensusResponseDto })
  consensus: TapConsensusResponseDto;
}

export class QueueWaitReportCreatedResponseDto {
  @ApiProperty({ type: QueueWaitReportResponseDto })
  report: QueueWaitReportResponseDto;

  @ApiPropertyOptional({ type: QueueSnapshotResponseDto, nullable: true })
  snapshot: QueueSnapshotResponseDto | null;
}

export class TapStatusReportListResponseDto {
  @ApiProperty({ type: [TapStatusReportResponseDto] })
  items: TapStatusReportResponseDto[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  meta: PageMetaDto;
}

export class QueueWaitReportListResponseDto {
  @ApiProperty({ type: [QueueWaitReportResponseDto] })
  items: QueueWaitReportResponseDto[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  meta: PageMetaDto;
}

export class KebeleConsensusResponseDto {
  @ApiProperty({ format: 'uuid' })
  standpipeId: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  locationLongitude: number | null;

  @ApiProperty({ nullable: true })
  locationLatitude: number | null;

  @ApiProperty({ enum: FlowStatus })
  tapStatus: FlowStatus;

  @ApiProperty()
  tapConfidence: number;

  @ApiProperty()
  tapSampleCount: number;

  @ApiProperty({ nullable: true })
  tapLastObservedAt: Date | null;

  @ApiProperty({ nullable: true })
  waitMinutes: number | null;

  @ApiProperty({ nullable: true })
  queueSize: number | null;

  @ApiProperty({ enum: QueueTrend, nullable: true })
  queueTrend: QueueTrend | null;

  @ApiProperty({ nullable: true })
  queueConfidence: number | null;

  @ApiProperty({ nullable: true })
  queueLastCalculatedAt: Date | null;
}

export class KebeleConsensusListResponseDto {
  @ApiProperty({ type: [KebeleConsensusResponseDto] })
  items: KebeleConsensusResponseDto[];
}
