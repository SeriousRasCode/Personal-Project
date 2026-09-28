import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/dto/pagination.dto.js';
import {
  WorkOrderPriority,
  WorkOrderStatus,
} from '../../../generated/prisma/enums.js';
import { WorkOrderAssigneeDto } from './work-order.dto.js';

export class WorkOrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  leakClusterId: string | null;

  @ApiProperty({ format: 'uuid' })
  createdById: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  assignedToId: string | null;

  @ApiProperty({ type: WorkOrderAssigneeDto, nullable: true })
  assignee: WorkOrderAssigneeDto | null;

  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ enum: WorkOrderPriority })
  priority: WorkOrderPriority;

  @ApiProperty({ enum: WorkOrderStatus })
  status: WorkOrderStatus;

  @ApiProperty({ format: 'date-time', nullable: true })
  scheduledFor: Date | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  startedAt: Date | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  completedAt: Date | null;

  @ApiProperty({ nullable: true })
  resolutionNote: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}

export class WorkOrderActivityResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  workOrderId: string;

  @ApiProperty({ format: 'uuid' })
  actorId: string;

  @ApiProperty({ enum: WorkOrderStatus, nullable: true })
  fromStatus: WorkOrderStatus | null;

  @ApiProperty({ enum: WorkOrderStatus, nullable: true })
  toStatus: WorkOrderStatus | null;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

export class WorkOrderListResponseDto {
  @ApiProperty({ type: [WorkOrderResponseDto] })
  items: WorkOrderResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class WorkOrderActivityListResponseDto {
  @ApiProperty({ type: [WorkOrderActivityResponseDto] })
  items: WorkOrderActivityResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
