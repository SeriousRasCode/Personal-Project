import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ScheduleStatus, UserRole } from '../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export class RotationWindowInputDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Null for a kebele-wide window',
  })
  @IsOptional()
  @IsUUID()
  standpipeId?: string | null;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  endsAt!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 9999.999, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3, allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(9999.999)
  minimumPressureBar?: number | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 9999.999, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3, allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(9999.999)
  maximumPressureBar?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class CreateRotationScheduleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  kebeleId!: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ format: 'date', example: '2026-09-25' })
  @IsDateString()
  @Matches(dateOnlyPattern)
  startsOn!: string;

  @ApiProperty({ format: 'date', example: '2026-09-30' })
  @IsDateString()
  @Matches(dateOnlyPattern)
  endsOn!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @ApiPropertyOptional({ type: () => [RotationWindowInputDto] })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RotationWindowInputDto)
  windows?: RotationWindowInputDto[];
}

export class UpdateRotationScheduleDto {
  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  updatedAt!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  kebeleId?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-09-25' })
  @ValidateIf((_, value) => value !== undefined)
  @IsDateString()
  @Matches(dateOnlyPattern)
  startsOn?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-09-30' })
  @ValidateIf((_, value) => value !== undefined)
  @IsDateString()
  @Matches(dateOnlyPattern)
  endsOn?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @ApiPropertyOptional({ type: () => [RotationWindowInputDto] })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RotationWindowInputDto)
  windows?: RotationWindowInputDto[];
}

export class ListRotationSchedulesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  kebeleId?: string;

  @ApiPropertyOptional({ enum: ScheduleStatus, enumName: 'ScheduleStatus' })
  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  @Matches(dateOnlyPattern)
  from?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  @Matches(dateOnlyPattern)
  to?: string;
}

export class ScheduleTransitionDto {
  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  updatedAt!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class WindowTransitionDto {
  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  updatedAt!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ScheduleRoleDto {
  @ApiPropertyOptional({ enum: UserRole, enumName: 'UserRole' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export type CreateScheduleDto = CreateRotationScheduleDto;
export type UpdateScheduleDto = UpdateRotationScheduleDto;
export type ScheduleWindowDto = RotationWindowInputDto;
export type ListSchedulesDto = ListRotationSchedulesDto;
export type LifecycleScheduleDto = ScheduleTransitionDto;
export type WindowActionDto = WindowTransitionDto;

export class ScheduleIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class WindowParamDto extends ScheduleIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  windowId!: string;
}

export class PaginationScheduleQueryDto extends ListRotationSchedulesDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export type { PaginationQueryDto };
