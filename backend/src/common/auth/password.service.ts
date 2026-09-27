import { BadRequestException, Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_POLICY_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])[\s\S]{12,128}$/;
export const PASSWORD_POLICY_MESSAGE =
  'Password must be 12-128 characters and include upper, lower, number, and special characters';
export const OTP_CODE_PATTERN = /^\d{6}$/;
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$H0UWO9aLvw5qI1ohhnFz3w$iEemYRN5YUG0Y7nPcknmor5ARhI+cTSztI1i5Mt1gmE';

const passwordOptions = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const otpOptions = {
  type: argon2id,
  memoryCost: 4_096,
  timeCost: 1,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    if (!this.isStrongPassword(password)) {
      throw new BadRequestException(PASSWORD_POLICY_MESSAGE);
    }

    return hash(password, passwordOptions);
  }

  async verify(
    passwordHash: string | null | undefined,
    password: string,
  ): Promise<boolean> {
    if (!passwordHash || typeof password !== 'string') {
      return false;
    }

    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  async hashOtp(code: string): Promise<string> {
    if (!OTP_CODE_PATTERN.test(code)) {
      throw new BadRequestException('OTP must contain six digits');
    }

    return hash(code, otpOptions);
  }

  async verifyOtp(codeHash: string, code: string): Promise<boolean> {
    if (!codeHash || !OTP_CODE_PATTERN.test(code)) {
      return false;
    }

    try {
      return await verify(codeHash, code);
    } catch {
      return false;
    }
  }

  isStrongPassword(password: string): boolean {
    return (
      typeof password === 'string' &&
      password.length >= PASSWORD_MIN_LENGTH &&
      password.length <= PASSWORD_MAX_LENGTH &&
      PASSWORD_POLICY_PATTERN.test(password)
    );
  }
}
