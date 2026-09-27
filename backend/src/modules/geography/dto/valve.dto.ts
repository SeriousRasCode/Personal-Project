import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CoordinateDto,
  ExpectedUpdatedAtDto,
  GeoPointResponseDto,
} from './common.dto.js';

export class CreateValveDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  kebeleId!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ maxLength: 40 })
  @IsString()
  @Length(1, 40)
  code!: string;

  @ApiProperty({ type: CoordinateDto })
  @ValidateNested()
  @Type(() => CoordinateDto)
  location!: CoordinateDto;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isOpen?: boolean;
}

export class UpdateValveDto extends ExpectedUpdatedAtDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID('4')
  kebeleId?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 40)
  code?: string;

  @ApiPropertyOptional({ type: CoordinateDto })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @ValidateNested()
  @Type(() => CoordinateDto)
  location?: CoordinateDto;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isOpen?: boolean;
}

export class ValveResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  kebeleId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ type: GeoPointResponseDto })
  location!: GeoPointResponseDto;

  @ApiProperty()
  isOpen!: boolean;

  @ApiProperty({ format: 'date-time', nullable: true })
  lastChangedAt!: Date | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  lastChangedById!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class PublicValveResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  kebeleId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ type: GeoPointResponseDto })
  location!: GeoPointResponseDto;

  @ApiProperty()
  isOpen!: boolean;
}

export { GeoPointResponseDto };
