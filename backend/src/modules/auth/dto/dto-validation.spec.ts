import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  OtpPurpose,
  UserRole,
  UserStatus,
} from '../../../generated/prisma/enums.js';
import { RegisterDto } from './register.dto.js';
import { OtpRequestDto } from './otp-request.dto.js';
import { OtpVerifyDto } from './otp-verify.dto.js';
import { CreateStaffUserDto } from '../../users/dto/create-staff-user.dto.js';
import { ListUsersDto } from '../../users/dto/list-users.dto.js';
import { UpdateUserDto } from '../../users/dto/update-user.dto.js';

const validRegistration = {
  phone: '+251900000000',
  displayName: 'Hydro User',
  password: 'HydroJimma!2026',
};

describe('owned DTO optional fields', () => {
  it('allows omitted update fields but rejects explicit null', async () => {
    expect(await validate(plainToInstance(UpdateUserDto, {}))).toHaveLength(0);
    const errors = await validate(
      plainToInstance(UpdateUserDto, {
        phone: null,
        displayName: null,
        password: null,
        role: null,
        locale: null,
      }),
    );
    expect(errors).toHaveLength(5);
  });

  it('rejects explicit null for optional registration and staff fields', async () => {
    const registrationErrors = await validate(
      plainToInstance(RegisterDto, { ...validRegistration, locale: null }),
    );
    expect(registrationErrors).toHaveLength(1);

    const staffErrors = await validate(
      plainToInstance(CreateStaffUserDto, {
        phone: '+251900000001',
        displayName: 'Operator',
        password: 'HydroJimma!2026',
        role: UserRole.ADMIN,
        status: null,
        locale: null,
      }),
    );
    expect(staffErrors).toHaveLength(2);
  });

  it('rejects null OTP purpose values while allowing omission', async () => {
    const requestErrors = await validate(
      plainToInstance(OtpRequestDto, {
        phone: '+251900000000',
        purpose: null,
      }),
    );
    expect(requestErrors).toHaveLength(1);
    expect(
      await validate(
        plainToInstance(OtpRequestDto, { phone: '+251900000000' }),
      ),
    ).toHaveLength(0);

    const verifyErrors = await validate(
      plainToInstance(OtpVerifyDto, {
        challengeId: '00000000-0000-4000-8000-000000000000',
        code: '123456',
        purpose: null,
      }),
    );
    expect(verifyErrors).toHaveLength(1);
  });

  it('rejects null list filters but allows omitted filters', async () => {
    const errors = await validate(
      plainToInstance(ListUsersDto, {
        role: null,
        status: null,
        search: null,
      }),
    );
    expect(errors).toHaveLength(3);
    expect(await validate(plainToInstance(ListUsersDto, {}))).toHaveLength(0);
  });

  it('keeps the OTP enum validation active for supplied values', async () => {
    const errors = await validate(
      plainToInstance(OtpRequestDto, {
        phone: '+251900000000',
        purpose: 'UNKNOWN',
      }),
    );
    expect(errors).toHaveLength(1);
    expect(OtpPurpose.LOGIN).toBe('LOGIN');
    expect(UserStatus.ACTIVE).toBe('ACTIVE');
  });
});
