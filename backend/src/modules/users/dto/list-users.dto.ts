import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '../../../generated/prisma/enums.js';

export class ListUsersDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ enum: UserRole })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(120)
  search?: string;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
