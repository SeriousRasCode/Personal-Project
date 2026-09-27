import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { GeoPointDto } from '../../../common/dto/geo.dto.js';

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export class CreateStandpipeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  kebeleId: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  neighborhoodId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  operatorProfileId?: string | null;

  @ApiProperty({ maxLength: 40 })
  @IsString()
  @Length(1, 40)
  code: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiProperty({ type: GeoPointDto })
  @ValidateNested()
  @Type(() => GeoPointDto)
  location: GeoPointDto;

  @ApiPropertyOptional({
    minimum: -9999999.99,
    maximum: 9999999.99,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-9999999.99)
  @Max(9999999.99)
  elevationMeters?: number | null;

  @ApiPropertyOptional({ minimum: 0.01, maximum: 99999999.99, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  capacityLitersPerMinute?: number | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(dateOnlyPattern)
  installedAt?: string | null;

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateStandpipeDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID('4')
  kebeleId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  neighborhoodId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  operatorProfileId?: string | null;

  @ApiPropertyOptional({ maxLength: 40 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 40)
  code?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ type: GeoPointDto })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @ValidateNested()
  @Type(() => GeoPointDto)
  location?: GeoPointDto;

  @ApiPropertyOptional({
    minimum: -9999999.99,
    maximum: 9999999.99,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-9999999.99)
  @Max(9999999.99)
  elevationMeters?: number | null;

  @ApiPropertyOptional({ minimum: 0.01, maximum: 99999999.99, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  capacityLitersPerMinute?: number | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(dateOnlyPattern)
  installedAt?: string | null;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsDateString()
  expectedUpdatedAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsDateString()
  updatedAt?: string;
}

export class DeactivateStandpipeDto {
  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsDateString()
  expectedUpdatedAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsDateString()
  updatedAt?: string;
}
