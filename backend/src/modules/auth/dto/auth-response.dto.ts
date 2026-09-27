import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto.js';

export class RegistrationResponseDto {
  @ApiProperty({ example: true })
  verificationRequired!: boolean;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ writeOnly: true })
  refreshToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({ example: 900 })
  expiresIn!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  refreshTokenExpiresAt!: Date;

  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}

export class OtpRequestResponseDto {
  @ApiProperty({ format: 'uuid' })
  challengeId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;
}

export class OtpVerifyResponseDto {
  @ApiProperty()
  verified!: boolean;

  @ApiPropertyOptional({ type: String })
  purpose?: string;

  @ApiPropertyOptional({ type: UserResponseDto })
  user?: UserResponseDto;

  @ApiPropertyOptional({ type: AuthResponseDto })
  tokens?: AuthResponseDto;
}
