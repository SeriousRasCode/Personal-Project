import { describe, it, expect, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';
import { resolveNotificationPlan } from './notification-targeting.js';
import {
  NotificationChannel,
  UserStatus,
} from '../../generated/prisma/enums.js';
describe('water-window alerts', () => {
  const event = {
    id: 'event',
    eventType: 'rotation_window.opened',
    payload: {
      kebeleId: 'area',
      standpipeId: 'point',
      endsAt: '2026-10-20T03:00:00Z',
    },
  };
  function setup({ sms = false, inApp = true, provider = 'http' } = {}) {
    const tx = {
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
      notification: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'recipient' }]),
        findUnique: vi.fn().mockResolvedValue({
          phone: '+251900000104',
          status: UserStatus.ACTIVE,
        }),
      },
      notificationPreference: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ userId: 'recipient', enabled: inApp }]),
        findUnique: vi.fn().mockResolvedValue({ enabled: sms }),
      },
      notification: { update: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const send = vi.fn().mockResolvedValue(undefined);
    const service = new NotificationsService(
      prisma as never,
      {} as never,
      { providerName: provider, send } as never,
    );
    return { service, prisma, tx, send };
  }
  it('requires an explicit geographic audience instead of broadcasting town-wide', () => {
    expect(resolveNotificationPlan({ ...event, payload: {} })).toBeNull();
    expect(resolveNotificationPlan(event)?.audience).toEqual({
      kebeleId: 'area',
      standpipeId: 'point',
    });
  });
  it('selects active residents and assigned operators only in the affected area', async () => {
    const { service, prisma, tx } = setup();
    await service.handleOutboxEvent(event);
    const audience = prisma.user.findMany.mock.calls[0]?.[0] as {
      where: { status: string; OR: unknown[] };
    };
    expect(audience.where.status).toBe(UserStatus.ACTIVE);
    expect(audience.where.OR).toContainEqual({
      citizenProfile: { is: { kebeleId: 'area' } },
    });
    const created = tx.notification.create.mock.calls[0]?.[0] as {
      data: { channel: string; template: string };
    };
    expect(created.data).toMatchObject({
      channel: NotificationChannel.IN_APP,
      template: 'rotation_window.opened',
    });
  });
  it('delivers SMS independently when in-app notifications are disabled', async () => {
    const { service, send, tx } = setup({ sms: true, inApp: false });
    expect(await service.handleOutboxEvent(event)).toBe(1);
    expect(send).toHaveBeenCalledOnce();
    const created = tx.notification.create.mock.calls[0]?.[0] as {
      data: { channel: string };
    };
    expect(created.data.channel).toBe(NotificationChannel.SMS);
  });
  it('never sends SMS without opt-in or a real configured adapter', async () => {
    for (const options of [{ sms: false }, { sms: true, provider: 'log' }]) {
      const { service, send } = setup(options);
      await service.handleOutboxEvent(event);
      expect(send).not.toHaveBeenCalled();
    }
  });
});
