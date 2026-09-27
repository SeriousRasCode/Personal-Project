import { describe, expect, it, vi } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import {
  OtpPurpose,
  UserRole,
  UserStatus,
} from '../../generated/prisma/enums.js';
import {
  DUMMY_PASSWORD_HASH,
  PasswordService,
} from '../../common/auth/password.service.js';
import { TokenService } from '../../common/auth/token.service.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';

const publicUser = {
  id: 'user-1',
  phone: '+251900000000',
  displayName: 'Hydro User',
  role: UserRole.CITIZEN,
  status: UserStatus.ACTIVE,
  locale: 'en',
  lastLoginAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};

const pendingUser = {
  ...publicUser,
  status: UserStatus.PENDING_VERIFICATION,
};

const tokenPair = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  tokenType: 'Bearer' as const,
  expiresIn: 900,
  refreshTokenExpiresAt: new Date('2026-10-25T00:00:00.000Z'),
};

function createService(options?: {
  authenticationUser?: typeof publicUser & { passwordHash: string };
  createdUser?: typeof pendingUser;
  audit?: AuditService;
  otpService?: Partial<OtpService>;
}) {
  const usersService = {
    findForAuthentication: vi
      .fn()
      .mockResolvedValue(options?.authenticationUser ?? null),
    createCitizen: vi
      .fn()
      .mockResolvedValue(options?.createdUser ?? pendingUser),
    touchLastLogin: vi.fn().mockResolvedValue(publicUser),
  } as unknown as UsersService;
  const passwordService = {
    verify: vi.fn().mockResolvedValue(true),
  } as unknown as PasswordService;
  const tokenService = {
    issueTokens: vi.fn().mockResolvedValue(tokenPair),
  } as unknown as TokenService;
  const otpService = (options?.otpService ?? {}) as OtpService;
  const auditService = options?.audit;
  return {
    service: new AuthService(
      usersService,
      passwordService,
      tokenService,
      otpService,
      auditService,
    ),
    usersService,
    passwordService,
    tokenService,
    otpService,
  };
}

describe('AuthService', () => {
  it('registers a pending citizen without issuing tokens', async () => {
    const { service, usersService, tokenService } = createService();

    const result = await service.register({
      phone: pendingUser.phone,
      displayName: pendingUser.displayName,
      password: 'HydroJimma!2026',
    });

    expect(result).toEqual({ verificationRequired: true });
    expect(usersService.createCitizen).toHaveBeenCalled();
    expect(tokenService.issueTokens).not.toHaveBeenCalled();
  });

  it('returns the same registration result for a duplicate phone', async () => {
    const { service, usersService, tokenService } = createService();
    vi.mocked(usersService.createCitizen).mockRejectedValue(
      new ConflictException(),
    );

    await expect(
      service.register({
        phone: pendingUser.phone,
        displayName: pendingUser.displayName,
        password: 'HydroJimma!2026',
      }),
    ).resolves.toEqual({ verificationRequired: true });
    expect(tokenService.issueTokens).not.toHaveBeenCalled();
  });

  it('performs a dummy password verification for an unknown user', async () => {
    const { service, passwordService, tokenService } = createService();

    await expect(
      service.login({ phone: publicUser.phone, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwordService.verify).toHaveBeenCalledWith(
      DUMMY_PASSWORD_HASH,
      'wrong-password',
    );
    expect(tokenService.issueTokens).not.toHaveBeenCalled();
  });

  it('logs in an active user, updates last login, and issues tokens', async () => {
    const audit = {
      record: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const { service, usersService, passwordService, tokenService } =
      createService({
        authenticationUser: { ...publicUser, passwordHash: 'hash' },
        audit,
      });

    const result = await service.login({
      phone: publicUser.phone,
      password: 'HydroJimma!2026',
    });

    expect(result).toEqual({ ...tokenPair, user: publicUser });
    expect(usersService.touchLastLogin).toHaveBeenCalledWith(publicUser.id);
    expect(passwordService.verify).toHaveBeenCalledWith(
      'hash',
      'HydroJimma!2026',
    );
    expect(tokenService.issueTokens).toHaveBeenCalledWith(publicUser, {});
    expect(audit.record).toHaveBeenCalled();
  });

  it('issues tokens after phone verification activates a pending user', async () => {
    const verifiedUser = { ...publicUser };
    const otpService = {
      verify: vi.fn().mockResolvedValue({
        verified: true,
        purpose: OtpPurpose.PHONE_VERIFICATION,
        user: verifiedUser,
      }),
    } as unknown as Partial<OtpService>;
    const { service, usersService, tokenService } = createService({
      otpService,
    });

    const result = await service.verifyOtp({
      challengeId: 'challenge-1',
      code: '123456',
      purpose: OtpPurpose.PHONE_VERIFICATION,
    });

    expect(result).toEqual({
      verified: true,
      purpose: OtpPurpose.PHONE_VERIFICATION,
      user: publicUser,
      tokens: { ...tokenPair, user: publicUser },
    });
    expect(usersService.touchLastLogin).toHaveBeenCalledWith(publicUser.id);
    expect(tokenService.issueTokens).toHaveBeenCalledWith(publicUser, {});
  });
});
