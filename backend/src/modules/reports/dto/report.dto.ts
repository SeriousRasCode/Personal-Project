import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { FlowStatus, ReportSource } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

const notUndefined = (_object: unknown, value: unknown): boolean =>
  value !== undefined;

export class CreateTapStatusReportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  standpipeId: string;

  @ApiProperty({ enum: FlowStatus })
  @IsEnum(FlowStatus)
  status: FlowStatus;

  @ApiPropertyOptional({ enum: ReportSource })
  @ValidateIf(notUndefined)
  @IsEnum(ReportSource)
  source: ReportSource = ReportSource.CITIZEN_APP;

  @ApiPropertyOptional({ minimum: 0.1, maximum: 5, default: 1 })
  @ValidateIf(notUndefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.1)
  @Max(5)
  reliabilityWeight: number = 1;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf(notUndefined)
  @Type(() => Date)
  @IsDate()
  observedAt?: Date;
}

export class CreateQueueWaitReportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  standpipeId: string;

  @ApiProperty({ minimum: 0, maximum: 1440 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  waitMinutes: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  queueSize?: number;

  @ApiPropertyOptional({ enum: ReportSource })
  @ValidateIf(notUndefined)
  @IsEnum(ReportSource)
  source: ReportSource = ReportSource.CITIZEN_APP;

  @ApiPropertyOptional({ minimum: 0.1, maximum: 5, default: 1 })
  @ValidateIf(notUndefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.1)
  @Max(5)
  reliabilityWeight: number = 1;

  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf(notUndefined)
  @Type(() => Date)
  @IsDate()
  observedAt?: Date;
}

export class ListTapReportsQueryDto extends PaginationQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  standpipeId: string;

  @ApiPropertyOptional({ enum: FlowStatus })
  @ValidateIf(notUndefined)
  @IsEnum(FlowStatus)
  status?: FlowStatus;

  @ApiPropertyOptional({ enum: ReportSource })
  @ValidateIf(notUndefined)
  @IsEnum(ReportSource)
  source?: ReportSource;
}

export class ListQueueReportsQueryDto extends PaginationQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  standpipeId: string;

  @ApiPropertyOptional({ enum: ReportSource })
  @ValidateIf(notUndefined)
  @IsEnum(ReportSource)
  source?: ReportSource;
}
