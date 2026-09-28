import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { OutboxStatus } from '../src/generated/prisma/enums.js';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto.js';
import type { LeakReportCreatedResponseDto } from '../src/modules/leaks/dto/leak-response.dto.js';
import type {
  NotificationListResponseDto,
  NotificationPreferenceResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from '../src/modules/notifications/dto/notification-response.dto.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { OutboxDispatcherService } from '../src/modules/outbox/outbox-dispatcher.service.js';
import type { WorkOrderResponseDto } from '../src/modules/work-orders/dto/work-order-response.dto.js';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

process.env.OUTBOX_POLLER_ENABLED = 'false';

function jsonBody<T>(response: InjectResponse): T {
  return response.json<T>();
}

const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? '+251900000000';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'HydroJimma!2026';
const CITIZEN_PHONE = '+251933300001';
const CITIZEN_PASSWORD = 'Citizen!2026';
const TECHNICIAN_PHONE = '+251944400001';
const TECHNICIAN_PASSWORD = 'FieldTech!2026';
const DESCRIPTION = 'A dedicated e2e leak report for the outbox dispatcher.';

interface DispatchTotals {
  claimed: number;
  processed: number;
  retried: number;
  failed: number;
}

describe('Outbox dispatcher and notifications (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcherService;
  let notifications: NotificationsService;
  let adminToken: string;
  let adminId: string;
  let citizenToken: string;
  let citizenId: string;
  let clusterId: string;
  let reportId: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const login = async (phone: string, password: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone, password },
    });
    expect(response.statusCode).toBe(200);
    return jsonBody<AuthResponseDto>(response).accessToken;
  };

  const list = async (
    token: string,
    query = '',
  ): Promise<NotificationListResponseDto> => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/notifications?limit=100${query}`,
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
    return jsonBody<NotificationListResponseDto>(response);
  };

  const dispatchOnce = (): Promise<DispatchTotals> => dispatcher.dispatchOnce();

  const drainOutbox = async (): Promise<DispatchTotals> => {
    const totals: DispatchTotals = {
      claimed: 0,
      processed: 0,
      retried: 0,
      failed: 0,
    };
    for (let tick = 0; tick < 40; tick += 1) {
      const result = await dispatchOnce();
      totals.claimed += result.claimed;
      totals.processed += result.processed;
      totals.retried += result.retried;
      totals.failed += result.failed;
      if (result.claimed === 0) {
        break;
      }
    }
    return totals;
  };

  const notificationsFor = (aggregateId: string, userId?: string) =>
    prisma.notification.findMany({
      where: {
        ...(userId ? { userId } : {}),
        payload: { path: ['clusterId'], equals: aggregateId },
      },
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    dispatcher = app.get(OutboxDispatcherService);
    notifications = app.get(NotificationsService);

    const admin = await prisma.user.findUnique({
      where: { phone: ADMIN_PHONE },
      select: { id: true },
    });
    if (!admin) {
      throw new Error('Seed admin is missing');
    }
    adminId = admin.id;
    adminToken = await login(ADMIN_PHONE, ADMIN_PASSWORD);

    await prisma.notificationPreference.deleteMany({
      where: { userId: adminId },
    });
    await prisma.notification.deleteMany({ where: { userId: adminId } });
    await prisma.idempotencyRecord.deleteMany({
      where: { scope: 'notification' },
    });

    await prisma.user.deleteMany({ where: { phone: CITIZEN_PHONE } });
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone: CITIZEN_PHONE,
        displayName: 'Reporting Citizen',
        password: CITIZEN_PASSWORD,
      },
    });
    expect(registered.statusCode).toBe(201);

    const citizen = await prisma.user.findUnique({
      where: { phone: CITIZEN_PHONE },
      select: { id: true },
    });
    if (!citizen) {
      throw new Error('Citizen was not created');
    }
    citizenId = citizen.id;

    const activated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${citizenId}/status`,
      headers: auth(adminToken),
      payload: { status: 'ACTIVE' },
    });
    expect(activated.statusCode).toBe(200);
    citizenToken = await login(CITIZEN_PHONE, CITIZEN_PASSWORD);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/leaks/reports',
      headers: auth(citizenToken),
      payload: {
        location: { longitude: 36.8319, latitude: 7.6667 },
        description: DESCRIPTION,
        severity: 'HIGH',
      },
    });
    expect(created.statusCode).toBe(201);
    const body = jsonBody<LeakReportCreatedResponseDto>(created);
    clusterId = body.cluster.id;
    reportId = body.report.id;
  }, 120_000);

  afterAll(async () => {
    await prisma
      .$executeRaw(
        Prisma.sql`DROP TRIGGER IF EXISTS t_fail_notification_insert ON notifications`,
      )
      .catch(() => undefined);
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: clusterId } });
    await prisma.leakReport.deleteMany({ where: { id: reportId } });
    await prisma.leakCluster.deleteMany({ where: { id: clusterId } });
    await prisma.notification.deleteMany({ where: { userId: citizenId } });
    await prisma.idempotencyRecord.deleteMany({
      where: { scope: 'notification' },
    });
    await prisma.user.deleteMany({
      where: { phone: { in: [CITIZEN_PHONE, TECHNICIAN_PHONE] } },
    });
    await app.close();
  });

  it('leaves the event pending until it is dispatched', async () => {
    const event = await prisma.outboxEvent.findFirst({
      where: { aggregateId: clusterId, eventType: 'leak.reported' },
    });

    expect(event?.status).toBe(OutboxStatus.PENDING);
    expect(event?.attempts).toBe(0);
  });

  it('notifies dispatchers once the event is dispatched', async () => {
    const result = await drainOutbox();

    expect(result.processed).toBe(result.claimed);
    expect(result.failed).toBe(0);
    expect(result.retried).toBe(0);

    const found = await notificationsFor(clusterId);
    expect(found).toHaveLength(1);
    expect(found[0]?.userId).toBe(adminId);
    expect(found[0]?.channel).toBe('IN_APP');
    expect(found[0]?.title).toContain('HIGH');
    expect(found[0]?.status).toBe('QUEUED');
  });

  it('exposes the notification through the inbox endpoint', async () => {
    const body = await list(adminToken);
    const notification = body.items.find(
      (item) => item.payload?.['clusterId'] === clusterId,
    );

    expect(notification).toBeDefined();
    expect(notification?.status).toBe('QUEUED');
    expect(notification?.readAt).toBeNull();
  });

  it('marks the event as processed', async () => {
    const event = await prisma.outboxEvent.findFirst({
      where: { aggregateId: clusterId, eventType: 'leak.reported' },
    });

    expect(event?.status).toBe(OutboxStatus.PROCESSED);
    expect(event?.processedAt).not.toBeNull();
    expect(event?.attempts).toBe(1);
    expect(event?.lastError).toBeNull();
  });

  it('does not notify the citizen who filed the report', async () => {
    expect(await notificationsFor(clusterId, citizenId)).toHaveLength(0);

    const body = await list(citizenToken);
    expect(
      body.items.filter((item) => item.payload?.['clusterId'] === clusterId),
    ).toHaveLength(0);
  });

  it('is a no op when there is nothing left to claim', async () => {
    const result = await dispatchOnce();

    expect(result.claimed).toBe(0);
    expect(result.processed).toBe(0);
  });

  it('does not duplicate a notification when an event is replayed', async () => {
    const event = await prisma.outboxEvent.findFirst({
      where: { aggregateId: clusterId, eventType: 'leak.reported' },
    });
    if (!event) {
      throw new Error('Outbox event is missing');
    }

    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: OutboxStatus.PENDING, processedAt: null },
    });

    const result = await drainOutbox();
    expect(result.processed).toBeGreaterThanOrEqual(1);

    expect(await notificationsFor(clusterId)).toHaveLength(1);
  });

  it('retries a failing event and eventually gives up', async () => {
    await drainOutbox();
    const poison = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'LeakCluster',
        aggregateId: clusterId,
        eventType: 'leak.reported',
        payload: { severity: 'LOW', clusterId },
      },
    });

    const spy = vi
      .spyOn(notifications, 'handleOutboxEvent')
      .mockRejectedValue(new Error('handler exploded'));

    await prisma.outboxEvent.update({
      where: { id: poison.id },
      data: { availableAt: new Date(0) },
    });
    const first = await dispatchOnce();

    expect(first.retried).toBe(1);
    expect(first.failed).toBe(0);
    const retried = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: poison.id },
    });
    expect(retried.status).toBe(OutboxStatus.PENDING);
    expect(retried.attempts).toBe(1);
    expect(retried.lastError).toContain('handler exploded');
    expect(retried.availableAt.getTime()).toBeGreaterThan(Date.now());

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await prisma.outboxEvent.update({
        where: { id: poison.id },
        data: { availableAt: new Date(0) },
      });
      await dispatchOnce();
    }

    const exhausted = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: poison.id },
    });
    expect(exhausted.status).toBe(OutboxStatus.FAILED);
    expect(exhausted.attempts).toBe(5);
    expect(exhausted.lastError).toContain('handler exploded');

    spy.mockRestore();
    await prisma.outboxEvent.deleteMany({ where: { id: poison.id } });
  });

  it('delivers exactly once after a partial write failure', async () => {
    await drainOutbox();
    const partialClusterId = '00000000-0000-0000-0000-00000000ab01';
    const event = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'LeakCluster',
        aggregateId: partialClusterId,
        eventType: 'leak.reported',
        payload: { severity: 'MEDIUM', clusterId: partialClusterId },
      },
    });
    const key = `${event.id}:${adminId}:IN_APP`;

    await prisma.$executeRaw(Prisma.sql`
      CREATE OR REPLACE FUNCTION fail_notification_insert() RETURNS trigger AS
      'BEGIN RAISE EXCEPTION ''forced notification failure''; END;'
      LANGUAGE plpgsql
    `);
    await prisma.$executeRaw(Prisma.sql`
      CREATE TRIGGER t_fail_notification_insert
      BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION fail_notification_insert()
    `);

    try {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { availableAt: new Date(0) },
      });
      const failed = await dispatchOnce();

      expect(failed.retried).toBe(1);
      const stuck = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
      expect(stuck.status).toBe(OutboxStatus.PENDING);
      expect(stuck.lastError).toContain('forced notification failure');
      expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
      expect(await notificationsFor(partialClusterId)).toHaveLength(0);
    } finally {
      await prisma.$executeRaw(
        Prisma.sql`DROP TRIGGER IF EXISTS t_fail_notification_insert ON notifications`,
      );
      await prisma.$executeRaw(
        Prisma.sql`DROP FUNCTION IF EXISTS fail_notification_insert()`,
      );
    }

    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { availableAt: new Date(0) },
    });
    const recovered = await dispatchOnce();

    expect(recovered.processed).toBe(1);
    expect(await notificationsFor(partialClusterId)).toHaveLength(1);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(1);

    await prisma.notification.deleteMany({
      where: {
        userId: adminId,
        payload: { path: ['clusterId'], equals: partialClusterId },
      },
    });
    await prisma.idempotencyRecord.deleteMany({ where: { key } });
    await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
  });

  it('releases a stale processing lock', async () => {
    await drainOutbox();
    const stuck = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'LeakCluster',
        aggregateId: clusterId,
        eventType: 'unknown.event',
        payload: {},
        status: OutboxStatus.PROCESSING,
        availableAt: new Date(Date.now() - 10 * 60_000),
        attempts: 1,
      },
    });

    const result = await dispatchOnce();
    expect(result.claimed).toBe(1);

    const released = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: stuck.id },
    });
    expect(released.status).toBe(OutboxStatus.PROCESSED);
    expect(released.lastError).toBeNull();

    await prisma.outboxEvent.deleteMany({ where: { id: stuck.id } });
  });

  it('filters to unread notifications only', async () => {
    const body = await list(adminToken, '&unreadOnly=true');

    expect(body.items.every((item) => item.readAt === null)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('counts and marks notifications as read', async () => {
    const before = jsonBody<UnreadCountResponseDto>(
      await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: auth(adminToken),
      }),
    ).unread;
    expect(before).toBeGreaterThan(0);

    const body = await list(adminToken);
    const target = body.items.find((item) => item.readAt === null);
    if (!target) {
      throw new Error('Expected an unread notification');
    }

    const read = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notifications/${target.id}/read`,
      headers: auth(adminToken),
    });
    expect(read.statusCode).toBe(200);
    const updated = jsonBody<NotificationResponseDto>(read);
    expect(updated.status).toBe('READ');
    expect(updated.readAt).not.toBeNull();

    const after = jsonBody<UnreadCountResponseDto>(
      await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: auth(adminToken),
      }),
    ).unread;
    expect(after).toBe(before - 1);

    const replay = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notifications/${target.id}/read`,
      headers: auth(adminToken),
    });
    expect(replay.statusCode).toBe(200);
    expect(jsonBody<NotificationResponseDto>(replay).readAt).toEqual(
      updated.readAt,
    );
  });

  it('never exposes another user notification', async () => {
    const body = await list(adminToken);
    const target = body.items[0];
    if (!target) {
      throw new Error('Expected a notification');
    }

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notifications/${target.id}/read`,
      headers: auth(citizenToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for a notification that does not exist', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notifications/3f9b1c2e-7a41-4d5b-9c8e-2b6a1d4f7e30/read',
      headers: auth(adminToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects a malformed notification id', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notifications/not-a-uuid/read',
      headers: auth(adminToken),
    });

    expect(response.statusCode).toBe(400);
  });

  it('requires a token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
    });

    expect(response.statusCode).toBe(401);
  });

  it('reports preferences as enabled by default', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/preferences',
      headers: auth(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<NotificationPreferenceResponseDto[]>(response);
    expect(body.find((item) => item.channel === 'IN_APP')?.enabled).toBe(true);
  });

  it('respects a disabled preference on the next dispatch', async () => {
    const disabled = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notifications/preferences',
      headers: auth(adminToken),
      payload: { channel: 'IN_APP', enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(jsonBody<NotificationPreferenceResponseDto>(disabled).enabled).toBe(
      false,
    );

    await drainOutbox();
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/leaks/reports',
      headers: auth(citizenToken),
      payload: {
        location: { longitude: 36.9, latitude: 7.75 },
        description: `${DESCRIPTION} Second cluster.`,
      },
    });
    expect(second.statusCode).toBe(201);
    const otherClusterId =
      jsonBody<LeakReportCreatedResponseDto>(second).cluster.id;

    await drainOutbox();

    expect(await notificationsFor(otherClusterId, adminId)).toHaveLength(0);

    const reEnabled = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notifications/preferences',
      headers: auth(adminToken),
      payload: { channel: 'IN_APP', enabled: true },
    });
    expect(reEnabled.statusCode).toBe(200);

    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: otherClusterId },
    });
    await prisma.leakReport.deleteMany({
      where: { clusterId: otherClusterId },
    });
    await prisma.leakCluster.deleteMany({ where: { id: otherClusterId } });
  });

  it('refuses an SMS preference until a provider is configured', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notifications/preferences',
      headers: auth(adminToken),
      payload: { channel: 'SMS', enabled: true },
    });

    expect(response.statusCode).toBe(400);
  });

  it('validates the preference payload', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notifications/preferences',
      headers: auth(adminToken),
      payload: { channel: 'CARRIER_PIGEON', enabled: true },
    });

    expect(response.statusCode).toBe(400);
  });

  it('notifies the work order assignee but not the actor', async () => {
    await prisma.user.deleteMany({ where: { phone: TECHNICIAN_PHONE } });
    const staff = await app.inject({
      method: 'POST',
      url: '/api/v1/users/staff',
      headers: auth(adminToken),
      payload: {
        phone: TECHNICIAN_PHONE,
        displayName: 'Notified Technician',
        password: TECHNICIAN_PASSWORD,
        role: 'FIELD_TECHNICIAN',
      },
    });
    expect(staff.statusCode).toBe(201);
    const technicianId = jsonBody<{ id: string }>(staff).id;
    const technicianToken = await login(TECHNICIAN_PHONE, TECHNICIAN_PASSWORD);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/work-orders',
      headers: auth(adminToken),
      payload: {
        title: 'Repair the notified leak',
        description: 'A work order used to prove outbox fan out.',
        leakClusterId: clusterId,
        assignedToId: technicianId,
      },
    });
    expect(created.statusCode).toBe(201);
    const order = jsonBody<WorkOrderResponseDto>(created);

    await drainOutbox();

    const inbox = await prisma.notification.findMany({
      where: { userId: technicianId, template: 'work_order.created' },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.body).toContain(order.code);
    expect(inbox[0]?.payload).toMatchObject({ leakClusterId: clusterId });

    const technicianInbox = await list(technicianToken);
    expect(
      technicianInbox.items.filter(
        (item) => item.template === 'work_order.created',
      ),
    ).toHaveLength(1);

    const actorInbox = await prisma.notification.findMany({
      where: { userId: adminId, template: 'work_order.created' },
    });
    expect(actorInbox).toHaveLength(0);

    await prisma.workOrder.deleteMany({ where: { id: order.id } });
    await prisma.notification.deleteMany({});
    await prisma.idempotencyRecord.deleteMany({
      where: { scope: 'notification' },
    });
    await prisma.user.deleteMany({ where: { phone: TECHNICIAN_PHONE } });
  });

  it('notifies the reporter through every status transition', async () => {
    const triaged = await app.inject({
      method: 'PATCH',
      url: `/api/v1/leaks/clusters/${clusterId}/status`,
      headers: auth(adminToken),
      payload: { status: 'TRIAGED', note: 'A technician is on the way.' },
    });
    expect(triaged.statusCode).toBe(200);

    const resolved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/leaks/clusters/${clusterId}/status`,
      headers: auth(adminToken),
      payload: { status: 'RESOLVED', note: 'The pipe was replaced.' },
    });
    expect(resolved.statusCode).toBe(200);

    await drainOutbox();

    const inbox = await notificationsFor(clusterId, citizenId);
    const updates = inbox.filter(
      (item) => item.template === 'leak.status_changed',
    );
    expect(updates).toHaveLength(2);
    expect(updates.map((item) => item.title).sort()).toEqual([
      'Your leak is now resolved',
      'Your leak is now triaged',
    ]);
    expect(
      updates.find((item) => item.title === 'Your leak is now resolved')?.body,
    ).toBe('The pipe was replaced.');

    const actorInbox = await notificationsFor(clusterId, adminId);
    expect(
      actorInbox.filter((item) => item.template === 'leak.status_changed'),
    ).toHaveLength(0);
  });
});
