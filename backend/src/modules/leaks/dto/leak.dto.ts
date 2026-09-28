import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { GeoPointDto } from '../../../common/dto/geo.dto.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import {
  LeakSeverity,
  LeakStatus,
  ReportSource,
} from '../../../generated/prisma/enums.js';

const notUndefined = (_object: unknown, value: unknown): boolean =>
  value !== undefined;

export class CreateLeakReportDto {
  @ApiProperty({ type: GeoPointDto })
  @ValidateNested()
  @Type(() => GeoPointDto)
  location: GeoPointDto;

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({ enum: LeakSeverity, default: LeakSeverity.MEDIUM })
  @ValidateIf(notUndefined)
  @IsEnum(LeakSeverity)
  severity: LeakSeverity = LeakSeverity.MEDIUM;

  @ApiPropertyOptional({
    enum: ReportSource,
    default: ReportSource.CITIZEN_APP,
  })
  @ValidateIf(notUndefined)
  @IsEnum(ReportSource)
  source: ReportSource = ReportSource.CITIZEN_APP;

  @ApiPropertyOptional({ minimum: 0.01, maximum: 1, default: 0.5 })
  @ValidateIf(notUndefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.01)
  @Max(1)
  confidence: number = 0.5;

  @ApiPropertyOptional({ maxLength: 512, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  photoObjectKey?: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf(notUndefined)
  @Type(() => Date)
  @IsDate()
  observedAt?: Date;
}

export class UpdateLeakStatusDto {
  @ApiProperty({ enum: LeakStatus })
  @IsEnum(LeakStatus)
  status: LeakStatus;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class ListLeakReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LeakStatus })
  @ValidateIf(notUndefined)
  @IsEnum(LeakStatus)
  status?: LeakStatus;

  @ApiPropertyOptional({ enum: LeakSeverity })
  @ValidateIf(notUndefined)
  @IsEnum(LeakSeverity)
  severity?: LeakSeverity;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(notUndefined)
  @IsUUID('4')
  clusterId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(notUndefined)
  @IsUUID('4')
  kebeleId?: string;

  @ApiPropertyOptional({ enum: ReportSource })
  @ValidateIf(notUndefined)
  @IsEnum(ReportSource)
  source?: ReportSource;
}

export class ListLeakClustersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LeakStatus })
  @ValidateIf(notUndefined)
  @IsEnum(LeakStatus)
  status?: LeakStatus;

  @ApiPropertyOptional({ enum: LeakSeverity })
  @ValidateIf(notUndefined)
  @IsEnum(LeakSeverity)
  severity?: LeakSeverity;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(notUndefined)
  @IsUUID('4')
  kebeleId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(notUndefined)
  @IsUUID('4')
  neighborhoodId?: string;
}

export class ListPublicLeakClustersQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(notUndefined)
  @IsUUID('4')
  kebeleId?: string;
}
