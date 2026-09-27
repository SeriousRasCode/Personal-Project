import { describe, expect, it, vi } from 'vitest';
import { UserRole, UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordService } from '../../common/auth/password.service.js';
import { UsersService } from './users.service.js';

const publicUser = {
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

function createPasswordService(): PasswordService {
  return {
    hash: vi.fn().mockResolvedValue('password-hash'),
  } as unknown as PasswordService;
}

describe('UsersService', () => {
  it('creates citizen accounts as pending verification', async () => {
    const create = vi.fn().mockResolvedValue({
      ...publicUser,
      status: UserStatus.PENDING_VERIFICATION,
    });
    const prisma = {
      user: { create },
    } as unknown as PrismaService;
    const passwordService = createPasswordService();
    const service = new UsersService(prisma, passwordService);

    const result = await service.createCitizen({
      phone: publicUser.phone,
      displayName: publicUser.displayName,
      password: 'HydroJimma!2026',
    });

    expect(result.status).toBe(UserStatus.PENDING_VERIFICATION);
    const createCall = create.mock.calls[0]?.[0] as
      { data?: { status?: UserStatus } } | undefined;
    expect(createCall?.data?.status).toBe(UserStatus.PENDING_VERIFICATION);
  });

  it('transactionally revokes sessions and consumes active OTPs on phone changes', async () => {
    const update = vi.fn().mockResolvedValue({
      ...publicUser,
      phone: '+251900000002',
    });
    const revokeSessions = vi.fn().mockResolvedValue({ count: 2 });
    const consumeChallenges = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = vi.fn(
      async (callback: (client: unknown) => Promise<unknown>) =>
        callback({
          user: { update },
          refreshSession: { updateMany: revokeSessions },
          otpChallenge: { updateMany: consumeChallenges },
        }),
    );
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;
    const passwordService = createPasswordService();
    const service = new UsersService(prisma, passwordService);

    await service.update('user-1', { phone: '+251900000002' });

    expect(transaction).toHaveBeenCalledTimes(1);
    const revokeCall = revokeSessions.mock.calls[0]?.[0] as
      | {
          where?: { userId?: string; revokedAt?: null };
          data?: { revokedAt?: Date };
        }
      | undefined;
    expect(revokeCall?.where).toEqual({ userId: 'user-1', revokedAt: null });
    expect(revokeCall?.data?.revokedAt).toBeInstanceOf(Date);

    const consumeCall = consumeChallenges.mock.calls[0]?.[0] as
      | {
          where?: {
            userId?: string;
            consumedAt?: null;
            expiresAt?: { gt?: Date };
          };
          data?: { consumedAt?: Date };
        }
      | undefined;
    expect(consumeCall?.where?.userId).toBe('user-1');
    expect(consumeCall?.where?.consumedAt).toBeNull();
    expect(consumeCall?.where?.expiresAt?.gt).toBeInstanceOf(Date);
    expect(consumeCall?.data?.consumedAt).toBeInstanceOf(Date);
  });

  it('transactionally revokes all sessions on password changes without consuming OTPs', async () => {
    const update = vi.fn().mockResolvedValue(publicUser);
    const revokeSessions = vi.fn().mockResolvedValue({ count: 1 });
    const consumeChallenges = vi.fn();
    const transaction = vi.fn(
      async (callback: (client: unknown) => Promise<unknown>) =>
        callback({
          user: { update },
          refreshSession: { updateMany: revokeSessions },
          otpChallenge: { updateMany: consumeChallenges },
        }),
    );
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;
    const passwordService = createPasswordService();
    const service = new UsersService(prisma, passwordService);

    await service.update('user-1', { password: 'HydroJimma!2026' });

    expect(passwordService.hash).toHaveBeenCalledWith('HydroJimma!2026');
    const revokeCall = revokeSessions.mock.calls[0]?.[0] as
      | {
          where?: { userId?: string; revokedAt?: null };
          data?: { revokedAt?: Date };
        }
      | undefined;
    expect(revokeCall?.where).toEqual({ userId: 'user-1', revokedAt: null });
    expect(revokeCall?.data?.revokedAt).toBeInstanceOf(Date);
    expect(consumeChallenges).not.toHaveBeenCalled();
  });

  it('transactionally revokes sessions and consumes OTPs on status changes', async () => {
    const update = vi.fn().mockResolvedValue({
      ...publicUser,
      status: UserStatus.SUSPENDED,
    });
    const revokeSessions = vi.fn().mockResolvedValue({ count: 1 });
    const consumeChallenges = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = vi.fn(
      async (callback: (client: unknown) => Promise<unknown>) =>
        callback({
          user: { update },
          refreshSession: { updateMany: revokeSessions },
          otpChallenge: { updateMany: consumeChallenges },
        }),
    );
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new UsersService(prisma, createPasswordService());

    await service.updateStatus('user-1', {
      status: UserStatus.SUSPENDED,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    const revokeCall = revokeSessions.mock.calls[0]?.[0] as
      | {
          where?: { userId?: string; revokedAt?: null };
          data?: { revokedAt?: Date };
        }
      | undefined;
    expect(revokeCall?.where).toEqual({ userId: 'user-1', revokedAt: null });
    expect(revokeCall?.data?.revokedAt).toBeInstanceOf(Date);

    const consumeCall = consumeChallenges.mock.calls[0]?.[0] as
      | {
          where?: {
            userId?: string;
            consumedAt?: null;
            expiresAt?: { gt?: Date };
          };
          data?: { consumedAt?: Date };
        }
      | undefined;
    expect(consumeCall?.where?.userId).toBe('user-1');
    expect(consumeCall?.where?.consumedAt).toBeNull();
    expect(consumeCall?.where?.expiresAt?.gt).toBeInstanceOf(Date);
    expect(consumeCall?.data?.consumedAt).toBeInstanceOf(Date);
  });
});
