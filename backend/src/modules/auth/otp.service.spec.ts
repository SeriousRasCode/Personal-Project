import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  OtpPurpose,
  UserRole,
  UserStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../database/prisma.service.js';
import { EncryptionService } from '../../common/auth/encryption.service.js';
import { PasswordService } from '../../common/auth/password.service.js';
import { OtpService } from './otp.service.js';

const activeUser = {
  id: 'user-1',
  phone: '+251900000000',
  displayName: 'Hydro User',
  role: UserRole.CITIZEN,
  status: UserStatus.ACTIVE,
  locale: 'en',
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const pendingUser = {
  ...activeUser,
  status: UserStatus.PENDING_VERIFICATION,
};

function createConfig(): ConfigService {
  return {
    get: vi.fn((key: string) => (key === 'otpTtlSeconds' ? 300 : undefined)),
  } as unknown as ConfigService;
}

function createPasswordService(): PasswordService {
  return {
    hashOtp: vi.fn().mockResolvedValue('hashed-code'),
    verifyOtp: vi.fn().mockResolvedValue(true),
  } as unknown as PasswordService;
}

function createEncryptionService(): EncryptionService {
  return {
    encrypt: vi.fn().mockReturnValue('encrypted-code'),
    decrypt: vi.fn().mockReturnValue('123456'),
  } as unknown as EncryptionService;
}

function createRequestService(
  user: { id: string; status: UserStatus } | null,
  options?: { transaction?: boolean },
) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const challengeCreate = vi.fn().mockResolvedValue({
    id: 'challenge-1',
    expiresAt: new Date('2026-09-25T00:05:00.000Z'),
  });
  const outboxCreate = vi.fn().mockResolvedValue({ id: 'outbox-1' });
  const transactionClient = {
    otpChallenge: { updateMany, create: challengeCreate },
    outboxEvent: { create: outboxCreate },
  };
  const transaction = vi.fn(
    async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
      callback(transactionClient),
  );
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
    },
    $transaction: options?.transaction === false ? undefined : transaction,
  } as unknown as PrismaService;
  const passwordService = createPasswordService();
  const encryptionService = createEncryptionService();
  const service = new OtpService(
    prisma,
    passwordService,
    encryptionService,
    createConfig(),
  );

  return {
    service,
    passwordService,
    encryptionService,
    updateMany,
    challengeCreate,
    outboxCreate,
    transaction,
  };
}

function createVerifyService(options?: {
  user?: typeof activeUser | typeof pendingUser | null;
  consumedCount?: number;
  attemptCount?: number;
  purpose?: OtpPurpose;
}) {
  const purpose = options?.purpose ?? OtpPurpose.LOGIN;
  const user = options?.user === undefined ? activeUser : options.user;
  const challenge = {
    id: 'challenge-1',
    userId: user?.id ?? null,
    codeHash: 'hashed-code',
    purpose,
    attempts: 0,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    user,
  };
  const updateMany = vi
    .fn()
    .mockResolvedValue({ count: options?.consumedCount ?? 1 });
  const findUnique = vi.fn().mockResolvedValue(challenge);
  const transactionUpdateMany = vi
    .fn()
    .mockResolvedValue({ count: options?.consumedCount ?? 1 });
  const transactionUser = {
    findUnique: vi
      .fn()
      .mockResolvedValue(
        purpose === OtpPurpose.PHONE_VERIFICATION && user
          ? { ...user, status: UserStatus.ACTIVE }
          : user,
      ),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const transactionClient = {
    otpChallenge: { updateMany: transactionUpdateMany },
    user: transactionUser,
  };
  const transaction = vi.fn(
    async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
      callback(transactionClient),
  );
  const prisma = {
    otpChallenge: { findUnique, updateMany },
    $transaction: transaction,
  } as unknown as PrismaService;
  const passwordService = createPasswordService();
  const service = new OtpService(
    prisma,
    passwordService,
    createEncryptionService(),
    createConfig(),
  );

  return {
    service,
    passwordService,
    challenge,
    findUnique,
    updateMany,
    transaction,
    transactionUpdateMany,
    transactionUser,
  };
}

describe('OtpService', () => {
  it('stores only a challenge reference in the outbox payload', async () => {
    const setup = createRequestService({
      id: activeUser.id,
      status: UserStatus.ACTIVE,
    });

    const result = await setup.service.request({
      phone: activeUser.phone,
      purpose: OtpPurpose.LOGIN,
    });

    expect(result).toEqual({
      challengeId: 'challenge-1',
      expiresAt: new Date('2026-09-25T00:05:00.000Z'),
    });
    expect(result).not.toHaveProperty('code');
    expect(setup.passwordService.hashOtp).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{6}$/),
    );
    const updateCall = setup.updateMany.mock.calls[0]?.[0] as
      | {
          where?: {
            phone?: string;
            purpose?: OtpPurpose;
            consumedAt?: null;
            expiresAt?: { gt?: Date };
          };
        }
      | undefined;
    expect(updateCall?.where?.phone).toBe(activeUser.phone);
    expect(updateCall?.where?.purpose).toBe(OtpPurpose.LOGIN);
    expect(updateCall?.where?.consumedAt).toBeNull();
    expect(updateCall?.where?.expiresAt?.gt).toBeInstanceOf(Date);
    const outboxCall = setup.outboxCreate.mock.calls[0]?.[0] as
      { data?: { payload?: Record<string, unknown> } } | undefined;
    expect(outboxCall?.data?.payload?.challengeId).toBe('challenge-1');
    expect(outboxCall?.data?.payload?.purpose).toBe(OtpPurpose.LOGIN);
    expect(outboxCall?.data?.payload).not.toHaveProperty('code');
  });

  it('stores the code encrypted on the challenge row only', async () => {
    const setup = createRequestService({
      id: activeUser.id,
      status: UserStatus.ACTIVE,
    });

    await setup.service.request({
      phone: activeUser.phone,
      purpose: OtpPurpose.LOGIN,
    });

    const createCall = setup.challengeCreate.mock.calls[0]?.[0] as
      { data?: Record<string, unknown> } | undefined;
    expect(createCall?.data?.codeCiphertext).toBe('encrypted-code');
    expect(createCall?.data?.codeCiphertext).not.toMatch(/^\d{6}$/);
    expect(createCall?.data?.codeHash).toBe('hashed-code');
  });

  it('returns a generic accepted response for an unknown login phone', async () => {
    const setup = createRequestService(null);

    const result = await setup.service.request({
      phone: '+251900000001',
      purpose: OtpPurpose.LOGIN,
    });

    expect(result.challengeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(setup.transaction).not.toHaveBeenCalled();
    expect(setup.challengeCreate).not.toHaveBeenCalled();
  });

  it('creates a phone verification challenge for a pending user', async () => {
    const setup = createRequestService({
      id: pendingUser.id,
      status: UserStatus.PENDING_VERIFICATION,
    });

    const result = await setup.service.request({
      phone: pendingUser.phone,
      purpose: OtpPurpose.PHONE_VERIFICATION,
    });

    expect(result.challengeId).toBe('challenge-1');
    const createCall = setup.challengeCreate.mock.calls[0]?.[0] as
      | {
          data?: {
            userId?: string;
            purpose?: OtpPurpose;
          };
        }
      | undefined;
    expect(createCall?.data?.userId).toBe(pendingUser.id);
    expect(createCall?.data?.purpose).toBe(OtpPurpose.PHONE_VERIFICATION);
  });

  it('uses a conditional attempt update for an invalid code', async () => {
    const setup = createVerifyService();
    vi.mocked(setup.passwordService.verifyOtp).mockResolvedValue(false);

    await expect(
      setup.service.verify({ challengeId: 'challenge-1', code: '000000' }),
    ).rejects.toThrow('Invalid or expired OTP');
    const updateCall = setup.updateMany.mock.calls[0]?.[0] as
      | {
          where?: {
            id?: string;
            purpose?: OtpPurpose;
            consumedAt?: null;
            expiresAt?: { gt?: Date };
            attempts?: { lt?: number };
          };
          data?: { attempts?: { increment?: number } };
        }
      | undefined;
    expect(updateCall?.where?.id).toBe('challenge-1');
    expect(updateCall?.where?.purpose).toBe(OtpPurpose.LOGIN);
    expect(updateCall?.where?.consumedAt).toBeNull();
    expect(updateCall?.where?.expiresAt?.gt).toBeInstanceOf(Date);
    expect(updateCall?.where?.attempts?.lt).toBe(5);
    expect(updateCall?.data?.attempts?.increment).toBe(1);
  });

  it('rejects verification when the conditional update loses the race', async () => {
    const setup = createVerifyService({ consumedCount: 0 });

    await expect(
      setup.service.verify({ challengeId: 'challenge-1', code: '123456' }),
    ).rejects.toThrow('Invalid or expired OTP');
    const updateCall = setup.transactionUpdateMany.mock.calls[0]?.[0] as
      | {
          where?: {
            id?: string;
            consumedAt?: null;
            attempts?: { lt?: number };
          };
        }
      | undefined;
    expect(updateCall?.where?.id).toBe('challenge-1');
    expect(updateCall?.where?.consumedAt).toBeNull();
    expect(updateCall?.where?.attempts?.lt).toBe(5);
  });

  it('consumes a valid challenge and rechecks the active user', async () => {
    const setup = createVerifyService();

    await expect(
      setup.service.verify({ challengeId: 'challenge-1', code: '123456' }),
    ).resolves.toEqual({
      verified: true,
      purpose: OtpPurpose.LOGIN,
      user: activeUser,
    });
    const updateCall = setup.transactionUpdateMany.mock.calls[0]?.[0] as
      | {
          where?: {
            id?: string;
            consumedAt?: null;
            attempts?: { lt?: number };
            expiresAt?: { gt?: Date };
          };
          data?: {
            consumedAt?: Date;
            attempts?: { increment?: number };
          };
        }
      | undefined;
    expect(updateCall?.where?.id).toBe('challenge-1');
    expect(updateCall?.where?.consumedAt).toBeNull();
    expect(updateCall?.where?.attempts?.lt).toBe(5);
    expect(updateCall?.where?.expiresAt?.gt).toBeInstanceOf(Date);
    expect(updateCall?.data?.consumedAt).toBeInstanceOf(Date);
    expect(updateCall?.data?.attempts?.increment).toBe(1);
  });

  it('activates a pending user in the same transaction as OTP consumption', async () => {
    const setup = createVerifyService({
      purpose: OtpPurpose.PHONE_VERIFICATION,
      user: pendingUser,
    });

    await expect(
      setup.service.verify({ challengeId: 'challenge-1', code: '123456' }),
    ).resolves.toEqual({
      verified: true,
      purpose: OtpPurpose.PHONE_VERIFICATION,
      user: { ...pendingUser, status: UserStatus.ACTIVE },
    });
    expect(setup.transactionUser.updateMany).toHaveBeenCalledWith({
      where: {
        id: pendingUser.id,
        status: UserStatus.PENDING_VERIFICATION,
      },
      data: { status: UserStatus.ACTIVE },
    });
  });
});
