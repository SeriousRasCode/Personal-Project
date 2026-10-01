import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
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
import {
  ExpectedUpdatedAtDto,
  LineStringGeometryDto,
} from '../../geography/dto/common.dto.js';
import { GeoPointDto } from '../../../common/dto/geo.dto.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePipelineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  kebeleId!: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  material?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  diameterMillimeters?: number;

  @ApiProperty({ type: LineStringGeometryDto })
  @ValidateNested()
  @Type(() => LineStringGeometryDto)
  path!: LineStringGeometryDto;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  installedAt?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePipelineDto extends ExpectedUpdatedAtDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 60, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
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
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  installedAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateValveDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  kebeleId!: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ maxLength: 40 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/)
  code!: string;

  @ApiProperty({ type: GeoPointDto })
  @ValidateNested()
  @Type(() => GeoPointDto)
  location!: GeoPointDto;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;
}

export class UpdateValveDto extends ExpectedUpdatedAtDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ maxLength: 40 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/)
  code!: string;

  @ApiProperty({ type: GeoPointDto })
  @ValidateNested()
  @Type(() => GeoPointDto)
  location!: GeoPointDto;
}

export class ChangeValveStateDto extends ExpectedUpdatedAtDto {
  @ApiProperty({ description: 'Requested position after the change' })
  @IsBoolean()
  isOpen!: boolean;
}

export class ValveStateChangeResultDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['OPEN', 'CLOSED'] }) position!: 'OPEN' | 'CLOSED';
  @ApiProperty({ enum: ['OPEN', 'CLOSED'] }) previousPosition!:
    'OPEN' | 'CLOSED';
  @ApiProperty() changedAt!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  changedById!: string | null;
}
