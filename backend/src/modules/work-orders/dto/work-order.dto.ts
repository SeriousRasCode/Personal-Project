import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import {
  UserRole,
  WorkOrderPriority,
  WorkOrderStatus,
} from '../../../generated/prisma/enums.js';

const notUndefined = (_object: unknown, value: unknown): boolean =>
  value !== undefined;

export class CreateWorkOrderDto {
  @ApiProperty({ minLength: 5, maxLength: 180 })
  @IsString()
  @MinLength(5)
  @MaxLength(180)
  title: string;

  @ApiProperty({ minLength: 10, maxLength: 4000 })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  leakClusterId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  assignedToId?: string | null;

  @ApiPropertyOptional({
    enum: WorkOrderPriority,
    default: WorkOrderPriority.NORMAL,
  })
  @ValidateIf(notUndefined)
  @IsEnum(WorkOrderPriority)
  priority: WorkOrderPriority = WorkOrderPriority.NORMAL;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledFor?: Date | null;
}

export class UpdateWorkOrderDto {
  @ApiPropertyOptional({ minLength: 5, maxLength: 180 })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(180)
  title?: string;

  @ApiPropertyOptional({ minLength: 10, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  assignedToId?: string | null;

  @ApiPropertyOptional({ enum: WorkOrderPriority })
  @ValidateIf(notUndefined)
  @IsEnum(WorkOrderPriority)
  priority?: WorkOrderPriority;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledFor?: Date | null;

  @ApiProperty({ format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  expectedUpdatedAt: Date;
}

export class UpdateWorkOrderStatusDto {
  @ApiProperty({ enum: WorkOrderStatus })
  @IsEnum(WorkOrderStatus)
  status: WorkOrderStatus;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  assignedToId?: string | null;

  @ApiProperty({ format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  expectedUpdatedAt: Date;
}

export class ListWorkOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WorkOrderStatus })
  @ValidateIf(notUndefined)
  @IsEnum(WorkOrderStatus)
  status?: WorkOrderStatus;

  @ApiPropertyOptional({ enum: WorkOrderPriority })
  @ValidateIf(notUndefined)
  @IsEnum(WorkOrderPriority)
  priority?: WorkOrderPriority;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(notUndefined)
  @IsUUID('4')
  leakClusterId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(notUndefined)
  @IsUUID('4')
  assignedToId?: string;
}

export class ListWorkOrderActivitiesQueryDto extends PaginationQueryDto {}

export class WorkOrderAssigneeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;
}
