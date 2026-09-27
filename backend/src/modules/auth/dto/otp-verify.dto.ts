import { IsEnum, IsString, IsUUID, Matches, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OtpPurpose } from '../../../generated/prisma/enums.js';
import { OTP_CODE_PATTERN } from '../../../common/auth/password.service.js';

export class OtpVerifyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  challengeId!: string;

  @ApiProperty({ example: '123456', writeOnly: true })
  @IsString()
  @Matches(OTP_CODE_PATTERN)
  code!: string;

  @ApiPropertyOptional({ enum: OtpPurpose })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(OtpPurpose)
  purpose?: OtpPurpose;
}
