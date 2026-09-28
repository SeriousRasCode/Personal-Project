import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../database/prisma.service.js';
import {
  NotificationChannel,
  NotificationStatus,
  UserRole,
} from '../../generated/prisma/enums.js';
import { NOTIFICATION_TEMPLATES } from './notification-targeting.js';
import { NotificationsService } from './notifications.service.js';

const dispatcherId = '00000000-0000-0000-0000-000000000001';
const reporterId = '00000000-0000-0000-0000-000000000002';
const eventId = '00000000-0000-0000-0000-0000000000ff';

interface StubOptions {
  users?: { id: string; role: UserRole }[];
  preferences?: { userId: string; enabled: boolean }[];
  createThrows?: Error;
}

function createService(options: StubOptions = {}) {
  const users = options.users ?? [
    { id: dispatcherId, role: UserRole.DISPATCHER },
  ];
  const notifications: { userId: string; template: string }[] = [];
  const claims: string[] = [];

  const prisma = {
    user: {
      findMany: vi.fn().mockResolvedValue(users),
    },
    notificationPreference: {
      findMany: vi.fn().mockResolvedValue(
        (options.preferences ?? []).map((preference) => ({
          ...preference,
          channel: NotificationChannel.IN_APP,
        })),
      ),
    },
    idempotencyRecord: {
      create: vi.fn((args: { data: { key: string } }) => {
        if (options.createThrows !== undefined) {
          throw options.createThrows;
        }
        claims.push(args.data.key);
        return Promise.resolve(args.data);
      }),
    },
    notification: {
      create: vi.fn((args: { data: { userId: string; template: string } }) => {
        notifications.push({
          userId: args.data.userId,
          template: args.data.template,
        });
        return Promise.resolve(args.data);
      }),
    },
  } as unknown as PrismaService;

  return {
    service: new NotificationsService(prisma),
    notifications,
    claims,
  };
}

const leakReported = {
  id: eventId,
  eventType: NOTIFICATION_TEMPLATES.leakReported,
  payload: { severity: 'HIGH', clusterCode: 'LEAK-ABC' },
};

describe('NotificationsService.handleOutboxEvent', () => {
  let harness: ReturnType<typeof createService>;

  beforeEach(() => {
    harness = createService();
  });

  it('ignores an event it does not own', async () => {
    const created = await harness.service.handleOutboxEvent({
      id: eventId,
      eventType: 'unknown.event',
      payload: {},
    });

    expect(created).toBe(0);
    expect(harness.notifications).toHaveLength(0);
  });

  it('notifies every active dispatcher of a new leak', async () => {
    const created = await harness.service.handleOutboxEvent(leakReported);

    expect(created).toBe(1);
    expect(harness.notifications).toEqual([
      { userId: dispatcherId, template: NOTIFICATION_TEMPLATES.leakReported },
    ]);
  });

  it('does nothing when nobody matches the audience', async () => {
    harness = createService({ users: [] });

    const created = await harness.service.handleOutboxEvent(leakReported);

    expect(created).toBe(0);
    expect(harness.claims).toHaveLength(0);
  });

  it('honours a disabled in app preference', async () => {
    harness = createService({
      users: [{ id: dispatcherId, role: UserRole.DISPATCHER }],
      preferences: [{ userId: dispatcherId, enabled: false }],
    });

    const created = await harness.service.handleOutboxEvent(leakReported);

    expect(created).toBe(0);
    expect(harness.claims).toHaveLength(0);
  });

  it('skips a duplicate claim for the same event and recipient', async () => {
    harness = createService({
      createThrows: Object.assign(new Error('unique'), { code: 'P2002' }),
    });

    const created = await harness.service.handleOutboxEvent(leakReported);

    expect(created).toBe(0);
  });

  it('propagates an unexpected database failure so the event retries', async () => {
    harness = createService({ createThrows: new Error('connection lost') });

    await expect(
      harness.service.handleOutboxEvent(leakReported),
    ).rejects.toThrow('connection lost');
  });

  it('keys the idempotency record per event and recipient', async () => {
    await harness.service.handleOutboxEvent(leakReported);

    expect(harness.claims[0]).toBe(
      `${eventId}:${dispatcherId}:${NotificationChannel.IN_APP}`,
    );
  });

  it('notifies the reporter when a leak is resolved', async () => {
    harness = createService({
      users: [{ id: reporterId, role: UserRole.CITIZEN }],
    });

    const created = await harness.service.handleOutboxEvent({
      id: eventId,
      eventType: NOTIFICATION_TEMPLATES.leakStatusChanged,
      payload: { to: 'RESOLVED', reporterId, note: 'Pipe replaced' },
    });

    expect(created).toBe(1);
    expect(harness.notifications[0]?.userId).toBe(reporterId);
  });

  it('tolerates a malformed payload', async () => {
    const created = await harness.service.handleOutboxEvent({
      id: eventId,
      eventType: NOTIFICATION_TEMPLATES.leakReported,
      payload: 'not-an-object',
    });

    expect(created).toBe(1);
  });
});

describe('NotificationsService.markRead', () => {
  it('marks an unread notification as read', async () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({
      id: eventId,
      channel: NotificationChannel.IN_APP,
      template: NOTIFICATION_TEMPLATES.leakReported,
      title: 'New leak reported',
      body: 'body',
      payload: null,
      status: NotificationStatus.READ,
      createdAt: now,
      readAt: now,
    });

    const prisma = {
      notification: { updateMany, findUnique },
    } as unknown as PrismaService;
    const service = new NotificationsService(prisma);

    const result = await service.markRead(dispatcherId, eventId);

    expect(result.status).toBe(NotificationStatus.READ);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: eventId, userId: dispatcherId, readAt: null },
      }),
    );
  });

  it('returns the existing notification when it was already read', async () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const prisma = {
      notification: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue({
          id: eventId,
          channel: NotificationChannel.IN_APP,
          template: NOTIFICATION_TEMPLATES.leakReported,
          title: 'New leak reported',
          body: 'body',
          payload: null,
          status: NotificationStatus.READ,
          createdAt: now,
          readAt: now,
        }),
      },
    } as unknown as PrismaService;
    const service = new NotificationsService(prisma);

    const result = await service.markRead(dispatcherId, eventId);

    expect(result.readAt).toEqual(now);
  });

  it('throws when the notification belongs to someone else', async () => {
    const prisma = {
      notification: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;
    const service = new NotificationsService(prisma);

    await expect(service.markRead(dispatcherId, eventId)).rejects.toThrow(
      'Notification not found',
    );
  });
});
