import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import {
  PHONE_VALIDATION_MESSAGE,
  isValidPhone,
} from '../../../common/auth/phone.util.js';
import { transformBooleanQuery } from '../../geography/dto/common.dto.js';

export class UssdCallbackDto {
  @ApiProperty({
    description: 'Session key assigned by the USSD provider',
    maxLength: 160,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  sessionKey!: string;

  @ApiProperty({
    description: 'Caller number in E.164 format',
    example: '+251911000000',
  })
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$|^00[1-9]\d{7,14}$/, {
    message: PHONE_VALIDATION_MESSAGE,
  })
  phone!: string;

  @ApiProperty({
    description: 'Digits the caller entered, for example *1#',
    example: '*1#',
    default: '',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  input?: string;
}

export class UssdSessionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by caller number in E.164 format',
    example: '+251911000000',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && isValidPhone(value) ? value.trim() : value,
  )
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: PHONE_VALIDATION_MESSAGE })
  phone?: string;

  @ApiPropertyOptional({
    description: 'Only return sessions that have not expired',
  })
  @Transform(({ value }: { value: unknown }) => transformBooleanQuery(value))
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  activeOnly?: boolean;
}
