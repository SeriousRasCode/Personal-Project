import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { paginated, type PageResult } from '../../common/dto/pagination.dto.js';
import { EncryptionService } from '../../common/auth/encryption.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { SmsService } from '../sms-ussd/sms/sms.service.js';
import { OTP_REQUESTED_EVENT } from '../auth/otp.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  NotificationChannel,
  NotificationStatus,
  UserStatus,
} from '../../generated/prisma/enums.js';
import {
  ListNotificationsQueryDto,
  UpdateNotificationPreferenceDto,
} from './dto/notification.dto.js';
import {
  NotificationPreferenceResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto.js';
import {
  resolveNotificationPlan,
  resolveRecipientIds,
  type NotificationPlan,
  type OutboxEventLike,
} from './notification-targeting.js';

export const NOTIFICATION_IDEMPOTENCY_SCOPE = 'notification';
export const OTP_SMS_TEMPLATE = 'identity.otp.sms';
const IDEMPOTENCY_TTL_DAYS = 30;

export interface OutboxEnvelope {
  id: string;
  eventType: string;
  payload: unknown;
}

interface Recipients {
  userIds: string[];
  roles: string[];
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly smsService: SmsService,
  ) {}

  private payloadRecord(payload: unknown): Record<string, unknown> {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      !Array.isArray(payload)
    ) {
      return payload as Record<string, unknown>;
    }
    return {};
  }

  private async resolveRecipients(
    userIds: string[],
    roles: string[],
  ): Promise<string[]> {
    if (userIds.length === 0 && roles.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        OR: [
          ...(userIds.length > 0 ? [{ id: { in: userIds } }] : []),
          ...(roles.length > 0 ? [{ role: { in: roles as never } }] : []),
        ],
      },
      select: { id: true },
    });

    return users.map((user) => user.id);
  }

  private async enabledChannels(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) {
      return new Set();
    }

    const preferences = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, channel: NotificationChannel.IN_APP },
      select: { userId: true, enabled: true },
    });

    const disabled = new Set(
      preferences
        .filter((preference) => !preference.enabled)
        .map((preference) => preference.userId),
    );

    return new Set(userIds.filter((userId) => !disabled.has(userId)));
  }

  private async deliver(
    event: OutboxEnvelope,
    plan: NotificationPlan,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    const key = `${event.id}:${userId}:${NotificationChannel.IN_APP}`;
    const requestHash = createHash('sha256').update(key).digest('hex');

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.idempotencyRecord.create({
          data: {
            id: randomUUID(),
            scope: NOTIFICATION_IDEMPOTENCY_SCOPE,
            key,
            requestHash,
            expiresAt: new Date(
              now.getTime() + IDEMPOTENCY_TTL_DAYS * 86_400_000,
            ),
          },
        });

        await tx.notification.create({
          data: {
            id: randomUUID(),
            userId,
            channel: NotificationChannel.IN_APP,
            template: plan.template,
            title: plan.title,
            body: plan.body,
            payload: this.payloadRecord(event.payload) as Prisma.InputJsonValue,
            status: NotificationStatus.QUEUED,
          },
        });

        return true;
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  async handleOutboxEvent(
    event: OutboxEnvelope,
    now: Date = new Date(),
  ): Promise<number> {
    if (event.eventType === OTP_REQUESTED_EVENT) {
      return this.deliverOtpSms(event, now);
    }

    const plan = resolveNotificationPlan({
      eventType: event.eventType,
      payload: this.payloadRecord(event.payload),
    } satisfies OutboxEventLike);

    if (plan === null) {
      return 0;
    }

    const audience: Recipients = {
      userIds: resolveRecipientIds(plan),
      roles: plan.audience.roles ?? [],
    };

    const recipients = await this.resolveRecipients(
      audience.userIds,
      audience.roles,
    );
    if (recipients.length === 0) {
      return 0;
    }

    const optedIn = await this.enabledChannels(recipients);
    let created = 0;

    for (const userId of recipients) {
      if (!optedIn.has(userId)) {
        continue;
      }

      if (await this.deliver(event, plan, userId, now)) {
        created += 1;
      }
    }

    return created;
  }

  async listForUser(
    userId: string,
    query: ListNotificationsQueryDto,
  ): Promise<PageResult<NotificationResponseDto>> {
    const where: Prisma.NotificationWhereInput = { userId };
    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.unreadOnly) {
      where.readAt = null;
    }

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return paginated(
      rows.map((row) => this.mapNotification(row)),
      total,
      query,
    );
  }

  async unreadCount(userId: string): Promise<UnreadCountResponseDto> {
    const unread = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });

    return { unread };
  }

  async markRead(userId: string, id: string): Promise<NotificationResponseDto> {
    const updated = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date(), status: NotificationStatus.READ },
    });

    if (updated.count === 0) {
      const existing = await this.prisma.notification.findFirst({
        where: { id, userId },
      });
      if (existing === null) {
        throw new NotFoundException('Notification not found');
      }
      return this.mapNotification(existing);
    }

    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (notification === null) {
      throw new NotFoundException('Notification not found');
    }
    return this.mapNotification(notification);
  }

  async listPreferences(
    userId: string,
  ): Promise<NotificationPreferenceResponseDto[]> {
    const preferences = await this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: { channel: 'asc' },
    });

    const configured = new Map(
      preferences.map((preference) => [preference.channel, preference.enabled]),
    );

    return Object.values(NotificationChannel).map((channel) => ({
      channel,
      enabled: configured.get(channel) ?? true,
    }));
  }

  async setPreference(
    userId: string,
    input: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceResponseDto> {
    if (input.channel === NotificationChannel.SMS) {
      throw new BadRequestException(
        'SMS notifications are not available until an SMS provider is configured',
      );
    }

    const preference = await this.prisma.notificationPreference.upsert({
      where: { userId_channel: { userId, channel: input.channel } },
      create: {
        id: randomUUID(),
        userId,
        channel: input.channel,
        enabled: input.enabled,
      },
      update: { enabled: input.enabled },
    });

    return { channel: preference.channel, enabled: preference.enabled };
  }

  private mapNotification(
    row: Prisma.NotificationGetPayload<Record<string, never>>,
  ): NotificationResponseDto {
    return {
      id: row.id,
      channel: row.channel,
      template: row.template,
      title: row.title,
      body: row.body,
      payload: this.payloadRecord(row.payload),
      status: row.status,
      createdAt: row.createdAt,
      readAt: row.readAt,
    };
  }

  /**
   * The one-time code is only ever written to the provider, never to the database:
   * the stored notification records that an SMS went out without persisting the secret.
   */
  private async deliverOtpSms(
    event: OutboxEnvelope,
    now: Date,
  ): Promise<number> {
    const payload = this.payloadRecord(event.payload);
    const challengeId = this.text(payload, 'challengeId');
    const phone = this.text(payload, 'phone');

    if (challengeId === '' || phone === '') {
      return 0;
    }

    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        userId: true,
        codeCiphertext: true,
        expiresAt: true,
        consumedAt: true,
      },
    });

    if (
      challenge === null ||
      challenge.userId === null ||
      challenge.codeCiphertext === null ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= now
    ) {
      return 0;
    }

    const code = this.encryptionService.decrypt(challenge.codeCiphertext);
    const userId = challenge.userId;
    const key = `${event.id}:${userId}:${NotificationChannel.SMS}`;
    const requestHash = createHash('sha256').update(key).digest('hex');
    const notificationId = randomUUID();

    const claimed = await this.prisma
      .$transaction(async (tx) => {
        await tx.idempotencyRecord.create({
          data: {
            id: randomUUID(),
            scope: NOTIFICATION_IDEMPOTENCY_SCOPE,
            key,
            requestHash,
            expiresAt: new Date(
              now.getTime() + IDEMPOTENCY_TTL_DAYS * 86_400_000,
            ),
          },
        });

        return tx.notification.create({
          data: {
            id: notificationId,
            userId,
            channel: NotificationChannel.SMS,
            template: OTP_SMS_TEMPLATE,
            title: 'Verification code',
            body: 'A verification code was sent to your phone by SMS.',
            payload: { challengeId: challenge.id },
            status: NotificationStatus.PROCESSING,
          },
          select: { id: true },
        });
      })
      .catch((error: unknown) => {
        if (this.isUniqueViolation(error)) {
          return null;
        }
        throw error;
      });

    if (claimed === null) {
      return 0;
    }

    try {
      await this.smsService.send({
        to: phone,
        body: `Your HydroJimma verification code is ${code}. It expires shortly.`,
      });
    } catch (error: unknown) {
      await this.releaseOtpSms(notificationId, key, error);
      throw error;
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.SENT, sentAt: now },
    });

    return 1;
  }

  private async releaseOtpSms(
    notificationId: string,
    key: string,
    error: unknown,
  ): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);

    await this.prisma.$transaction([
      this.prisma.idempotencyRecord.deleteMany({
        where: { scope: NOTIFICATION_IDEMPOTENCY_SCOPE, key },
      }),
      this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.FAILED,
          failureReason: reason.slice(0, 500),
        },
      }),
    ]);
  }

  private text(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    return typeof value === 'string' ? value.trim() : '';
  }
}
