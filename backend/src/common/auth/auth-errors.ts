import { UnauthorizedException } from '@nestjs/common';

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';
export const INVALID_OTP_MESSAGE = 'Invalid or expired OTP';

export function invalidCredentialsError(): UnauthorizedException {
  return new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
}

export function invalidOtpError(): UnauthorizedException {
  return new UnauthorizedException(INVALID_OTP_MESSAGE);
}
