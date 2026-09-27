import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OtpPurpose } from '../../../generated/prisma/enums.js';

export class OtpRequestDto {
  @ApiProperty({ example: '+251900000000' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;

  @ApiPropertyOptional({ enum: OtpPurpose, default: OtpPurpose.LOGIN })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(OtpPurpose)
  purpose: OtpPurpose = OtpPurpose.LOGIN;
}
