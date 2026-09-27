import { randomInt, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import { OtpPurpose, UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../database/prisma.service.js';
import { EncryptionService } from '../../common/auth/encryption.service.js';
import { PasswordService } from '../../common/auth/password.service.js';
import { invalidOtpError } from '../../common/auth/auth-errors.js';
import { normalizePhone } from '../../common/auth/phone.util.js';
import { PUBLIC_USER_SELECT, type PublicUser } from '../users/users.service.js';
import type { OtpRequestDto } from './dto/otp-request.dto.js';
import type { OtpVerifyDto } from './dto/otp-verify.dto.js';

export const OTP_REQUESTED_EVENT = 'identity.otp.requested';

type OtpTransactionClient = Prisma.TransactionClient;

export interface OtpRequestResult {
  challengeId: string;
  expiresAt: Date;
}

export interface OtpVerificationResult {
  verified: true;
  purpose: OtpPurpose;
  user: PublicUser | null;
}

@Injectable()
export class OtpService {
  private readonly defaultOtpTtlSeconds = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
  ) {}

  async request(input: OtpRequestDto): Promise<OtpRequestResult> {
    const phone = normalizePhone(input.phone);
    const purpose = input.purpose ?? OtpPurpose.LOGIN;
    const now = new Date();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await this.passwordService.hashOtp(code);
    const expiresAt = new Date(now.getTime() + this.otpTtlSeconds() * 1_000);
    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, status: true },
    });

    if (!user || !this.isEligible(user.status, purpose)) {
      return {
        challengeId: randomUUID(),
        expiresAt,
      };
    }

    const createChallenge = async (client: OtpTransactionClient) => {
      await client.otpChallenge.updateMany({
        where: {
          phone,
          purpose,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });

      const challenge = await client.otpChallenge.create({
        data: {
          userId: user.id,
          phone,
          codeHash,
          codeCiphertext: this.encryptionService.encrypt(code),
          purpose,
          expiresAt,
        },
        select: { id: true, expiresAt: true },
      });

      await client.outboxEvent.create({
        data: {
          aggregateType: 'OtpChallenge',
          aggregateId: challenge.id,
          eventType: OTP_REQUESTED_EVENT,
          payload: {
            challengeId: challenge.id,
            phone,
            purpose,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });

      return challenge;
    };

    const challenge = await this.runTransaction(createChallenge);

    return {
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
    };
  }

  async verify(input: OtpVerifyDto): Promise<OtpVerificationResult> {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: input.challengeId },
      select: {
        id: true,
        userId: true,
        codeHash: true,
        purpose: true,
        attempts: true,
        maxAttempts: true,
        expiresAt: true,
        consumedAt: true,
        user: {
          select: PUBLIC_USER_SELECT,
        },
      },
    });
    const now = new Date();

    if (
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= now ||
      challenge.attempts >= challenge.maxAttempts ||
      (input.purpose !== undefined && input.purpose !== challenge.purpose) ||
      (challenge.purpose === OtpPurpose.LOGIN && !challenge.user) ||
      (challenge.purpose === OtpPurpose.PHONE_VERIFICATION && !challenge.userId)
    ) {
      throw invalidOtpError();
    }

    const validCode = await this.passwordService.verifyOtp(
      challenge.codeHash,
      input.code,
    );
    if (!validCode) {
      const attempted = await this.prisma.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          purpose: challenge.purpose,
          consumedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: challenge.maxAttempts },
        },
        data: { attempts: { increment: 1 } },
      });
      if (attempted.count !== 1) {
        throw invalidOtpError();
      }
      throw invalidOtpError();
    }

    const consumeChallenge = async (client: OtpTransactionClient) => {
      const consumedAt = new Date();
      const consumed = await client.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          purpose: challenge.purpose,
          consumedAt: null,
          expiresAt: { gt: consumedAt },
          attempts: { lt: challenge.maxAttempts },
        },
        data: {
          consumedAt,
          attempts: { increment: 1 },
        },
      });
      if (consumed.count !== 1) {
        throw invalidOtpError();
      }

      if (
        challenge.purpose === OtpPurpose.PHONE_VERIFICATION &&
        challenge.userId
      ) {
        const activated = await client.user.updateMany({
          where: {
            id: challenge.userId,
            status: UserStatus.PENDING_VERIFICATION,
          },
          data: { status: UserStatus.ACTIVE },
        });
        if (activated.count !== 1) {
          throw invalidOtpError();
        }
      }

      let user = challenge.user;
      if (challenge.userId) {
        user = await client.user.findUnique({
          where: { id: challenge.userId },
          select: PUBLIC_USER_SELECT,
        });
      }

      if (
        (challenge.purpose === OtpPurpose.LOGIN ||
          challenge.purpose === OtpPurpose.PHONE_VERIFICATION) &&
        user?.status !== UserStatus.ACTIVE
      ) {
        throw invalidOtpError();
      }

      return user;
    };

    const user = await this.runTransaction(consumeChallenge);

    return {
      verified: true,
      purpose: challenge.purpose,
      user,
    };
  }

  private isEligible(
    status: UserStatus | undefined,
    purpose: OtpPurpose,
  ): boolean {
    if (purpose === OtpPurpose.LOGIN) {
      return status === UserStatus.ACTIVE;
    }
    if (purpose === OtpPurpose.PHONE_VERIFICATION) {
      return status === UserStatus.PENDING_VERIFICATION;
    }
    return false;
  }

  private runTransaction<T>(
    callback: (client: OtpTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  private otpTtlSeconds(): number {
    const value =
      this.configService.get<number>('otpTtlSeconds') ??
      this.configService.get<number>('OTP_TTL_SECONDS');
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : this.defaultOtpTtlSeconds;
  }
}
