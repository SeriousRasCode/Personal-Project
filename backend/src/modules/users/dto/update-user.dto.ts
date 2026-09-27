import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../../generated/prisma/enums.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_PATTERN,
} from '../../../common/auth/password.service.js';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: '+251900000002' })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: 'Updated Name' })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({ minLength: PASSWORD_MIN_LENGTH, writeOnly: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_POLICY_PATTERN)
  password?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ maxLength: 10 })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(10)
  locale?: string;
}
