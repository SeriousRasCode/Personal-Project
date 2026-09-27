import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { transformBooleanQuery } from '../../geography/dto/common.dto.js';

export class ListStandpipesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ type: Boolean })
  @Transform(({ value }: { value: unknown }) => transformBooleanQuery(value))
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 120)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID('4')
  kebeleId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID('4')
  neighborhoodId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID('4')
  operatorProfileId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @Transform(({ value }: { value: unknown }) => transformBooleanQuery(value))
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  assignedToMe?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @Transform(({ value }: { value: unknown }) => transformBooleanQuery(value))
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  unassigned?: boolean;
}

export class ListOperatorsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 120)
  search?: string;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @Transform(({ value }: { value: unknown }) => transformBooleanQuery(value))
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive = true;
}
