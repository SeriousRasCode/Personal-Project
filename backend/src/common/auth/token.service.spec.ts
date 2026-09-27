import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TokenService, hashOpaqueRefreshToken } from './token.service.js';

function createConfig(): ConfigService {
  const values: Record<string, string | number> = {
    'jwt.accessSecret': 'a'.repeat(32),
    'jwt.accessTtlSeconds': 900,
    'jwt.refreshTtlSeconds': 2_592_000,
  };
  return {
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function createJwt(): JwtService {
  return {
    sign: vi.fn().mockReturnValue('signed-access-token'),
  } as unknown as JwtService;
}

describe('TokenService', () => {
  it('issues an opaque refresh token and a session-bound access token', async () => {
    const sessionExpiresAt = new Date('2026-10-25T00:00:00.000Z');
    const create = vi.fn().mockResolvedValue({
      id: 'session-1',
      expiresAt: sessionExpiresAt,
    });
    const prisma = {
      refreshSession: { create },
    } as unknown as PrismaService;
    const jwt = createJwt();
    const service = new TokenService(jwt, createConfig(), prisma);

    const result = await service.issueTokens(
      { id: 'user-1', role: UserRole.CITIZEN },
      { userAgent: 'test-agent', ipAddress: '127.0.0.1' },
    );

    expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const createCall = create.mock.calls[0]?.[0] as
      { data?: Record<string, unknown> } | undefined;
    expect(createCall?.data?.userId).toBe('user-1');
    expect(createCall?.data?.tokenHash).toBe(
      hashOpaqueRefreshToken(result.refreshToken),
    );
    expect(createCall?.data?.userAgent).toBe('test-agent');
    expect(createCall?.data?.ipAddress).toBe('127.0.0.1');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'user-1',
        role: UserRole.CITIZEN,
        sid: 'session-1',
      }),
      expect.objectContaining({ expiresIn: 900 }),
    );
  });

  it('rotates a refresh token atomically and revokes the previous session', async () => {
    const nextExpiresAt = new Date('2026-10-25T00:00:00.000Z');
    const findUnique = vi.fn().mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      userAgent: 'old-agent',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        id: 'user-1',
        role: UserRole.CITIZEN,
        status: UserStatus.ACTIVE,
      },
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({
      id: 'session-2',
      expiresAt: nextExpiresAt,
    });
    const transactionClient = {
      refreshSession: { updateMany, create },
    };
    const prisma = {
      refreshSession: { findUnique },
      $transaction: vi.fn(
        async (
          callback: (client: typeof transactionClient) => Promise<unknown>,
        ) => callback(transactionClient),
      ),
    } as unknown as PrismaService;
    const jwt = createJwt();
    const service = new TokenService(jwt, createConfig(), prisma);

    const result = await service.rotateRefreshToken('old-refresh-token', {
      userAgent: 'new-agent',
    });

    expect(result.tokens.refreshToken).not.toBe('old-refresh-token');
    const updateCall = updateMany.mock.calls[0]?.[0] as
      | { where?: Record<string, unknown>; data?: Record<string, unknown> }
      | undefined;
    expect(updateCall?.where?.id).toBe('session-1');
    expect(updateCall?.where?.revokedAt).toBeNull();
    const expiresAtFilter = updateCall?.where?.expiresAt as
      { gt?: unknown } | undefined;
    expect(expiresAtFilter?.gt).toBeInstanceOf(Date);
    expect(updateCall?.data?.revokedAt).toBeInstanceOf(Date);
    const createCall = create.mock.calls[0]?.[0] as
      { data?: Record<string, unknown> } | undefined;
    expect(createCall?.data?.userId).toBe('user-1');
    expect(createCall?.data?.userAgent).toBe('new-agent');
    expect(createCall?.data?.ipAddress).toBe('127.0.0.1');
    expect(jwt.sign).toHaveBeenLastCalledWith(
      expect.objectContaining({ sid: 'session-2' }),
      expect.any(Object),
    );
  });

  it('revokes all sessions when a revoked refresh token is reused', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      refreshSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-1',
          userId: 'user-1',
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: new Date(),
          user: null,
        }),
        updateMany,
      },
    } as unknown as PrismaService;
    const service = new TokenService(createJwt(), createConfig(), prisma);

    await expect(
      service.rotateRefreshToken('revoked-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', revokedAt: null },
      }),
    );
  });
});
