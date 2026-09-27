import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AccessTokenPayload,
  SessionContext,
} from '../../common/types/authenticated-user.js';
import type { UserRole } from '../../generated/prisma/enums.js';

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshTokenExpiresAt: Date;
}

export interface TokenUser {
  id: string;
  role: UserRole;
}

export function createOpaqueRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashOpaqueRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

@Injectable()
export class TokenService {
  private readonly defaultAccessTtlSeconds = 900;
  private readonly defaultRefreshTtlSeconds = 2_592_000;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issueTokens(
    user: TokenUser,
    context: SessionContext = {},
  ): Promise<AuthTokenPair> {
    const refreshToken = createOpaqueRefreshToken();
    const refreshTokenExpiresAt = this.refreshExpiry();
    const session = await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: hashOpaqueRefreshToken(refreshToken),
        userAgent: context.userAgent ?? null,
        ipAddress: context.ipAddress ?? null,
        expiresAt: refreshTokenExpiresAt,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });

    const accessToken = this.jwtService.sign(
      {
        sub: user.id,
        role: user.role,
        sid: session.id,
      } satisfies AccessTokenPayload,
      {
        secret: this.accessSecret(),
        expiresIn: this.accessTtlSeconds(),
      },
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds(),
      refreshTokenExpiresAt: session.expiresAt,
    };
  }

  async rotateRefreshToken(
    refreshToken: string,
    context: SessionContext = {},
  ): Promise<{ tokens: AuthTokenPair; user: TokenUser }> {
    const now = new Date();
    const tokenHash = hashOpaqueRefreshToken(refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        userAgent: true,
        ipAddress: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            role: true,
            status: true,
          },
        },
      },
    });

    if (!session || session.expiresAt <= now) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.revokedAt !== null) {
      await this.revokeAllForUser(session.userId, now);
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!session.user || session.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const nextRefreshToken = createOpaqueRefreshToken();
    const nextExpiresAt = this.refreshExpiry();
    const transactionHost = this.prisma as unknown as {
      $transaction?: <T>(
        callback: (transaction: PrismaService) => Promise<T>,
      ) => Promise<T>;
    };

    let nextSession: { id: string; expiresAt: Date };
    if (transactionHost.$transaction) {
      nextSession = await transactionHost.$transaction(async (transaction) => {
        const revoked = await transaction.refreshSession.updateMany({
          where: {
            id: session.id,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now },
        });

        if (revoked.count !== 1) {
          throw new UnauthorizedException('Invalid refresh token');
        }

        return transaction.refreshSession.create({
          data: {
            userId: session.userId,
            tokenHash: hashOpaqueRefreshToken(nextRefreshToken),
            userAgent: context.userAgent ?? session.userAgent,
            ipAddress: context.ipAddress ?? session.ipAddress,
            expiresAt: nextExpiresAt,
          },
          select: { id: true, expiresAt: true },
        });
      });
    } else {
      const revoked = await this.prisma.refreshSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });

      if (revoked.count !== 1) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      nextSession = await this.prisma.refreshSession.create({
        data: {
          userId: session.userId,
          tokenHash: hashOpaqueRefreshToken(nextRefreshToken),
          userAgent: context.userAgent ?? session.userAgent,
          ipAddress: context.ipAddress ?? session.ipAddress,
          expiresAt: nextExpiresAt,
        },
        select: { id: true, expiresAt: true },
      });
    }

    const accessToken = this.jwtService.sign(
      {
        sub: session.user.id,
        role: session.user.role,
        sid: nextSession.id,
      } satisfies AccessTokenPayload,
      {
        secret: this.accessSecret(),
        expiresIn: this.accessTtlSeconds(),
      },
    );

    return {
      tokens: {
        accessToken,
        refreshToken: nextRefreshToken,
        tokenType: 'Bearer',
        expiresIn: this.accessTtlSeconds(),
        refreshTokenExpiresAt: nextSession.expiresAt,
      },
      user: session.user,
    };
  }

  async revokeRefreshToken(
    refreshToken: string,
    userId?: string,
  ): Promise<boolean> {
    const result = await this.prisma.refreshSession.updateMany({
      where: {
        tokenHash: hashOpaqueRefreshToken(refreshToken),
        revokedAt: null,
        ...(userId ? { userId } : {}),
      },
      data: { revokedAt: new Date() },
    });

    return result.count > 0;
  }

  async revokeAllForUser(
    userId: string,
    revokedAt = new Date(),
  ): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
  }

  async hasActiveSession(userId: string, sessionId: string): Promise<boolean> {
    const session = await this.prisma.refreshSession.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    return session !== null;
  }

  private accessSecret(): string {
    const secret =
      this.configService.get<string>('jwt.accessSecret') ??
      this.configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT access secret is not configured');
    }
    return secret;
  }

  private accessTtlSeconds(): number {
    return this.positiveInteger(
      this.configService.get<number>('jwt.accessTtlSeconds') ??
        this.configService.get<number>('JWT_ACCESS_TTL_SECONDS'),
      this.defaultAccessTtlSeconds,
    );
  }

  private refreshExpiry(): Date {
    const ttl = this.positiveInteger(
      this.configService.get<number>('jwt.refreshTtlSeconds') ??
        this.configService.get<number>('JWT_REFRESH_TTL_SECONDS'),
      this.defaultRefreshTtlSeconds,
    );
    return new Date(Date.now() + ttl * 1_000);
  }

  private positiveInteger(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : fallback;
  }
}
