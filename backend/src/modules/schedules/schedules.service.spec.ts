import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ScheduleStatus,
  UserRole,
  WindowStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ListRotationSchedulesDto } from './schedules.dto.js';
import {
  SchedulesService,
  SCHEDULE_OUTBOX_EVENT_TYPES,
} from './schedules.service.js';

const scheduleId = '00000000-0000-0000-0000-000000000001';
const windowId = '00000000-0000-0000-0000-000000000002';
const kebeleId = '00000000-0000-0000-0000-000000000003';
const standpipeId = '00000000-0000-0000-0000-000000000004';
const actorId = '00000000-0000-0000-0000-000000000005';
const secondWindowId = '00000000-0000-0000-0000-000000000006';
const thirdWindowId = '00000000-0000-0000-0000-000000000007';

type WindowUpdateArgs = {
  data: { status: WindowStatus };
};

type ValveUpdateArgs = {
  where: { kebeleId: string };
  data: {
    isOpen: boolean;
    lastChangedAt: Date;
    lastChangedById: string;
  };
};

type OutboxCreateArgs = {
  data: {
    eventType: string;
    payload: { reason?: string; [key: string]: unknown };
  };
};

function createConfig(): ConfigService {
  return {
    get: vi.fn().mockReturnValue('Africa/Addis_Ababa'),
  } as unknown as ConfigService;
}

function createService(tx: Record<string, unknown>): SchedulesService {
  const prisma = {
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  } as unknown as PrismaService;
  return new SchedulesService(prisma, createConfig());
}

describe('SchedulesService', () => {
  let tx: Record<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T09:00:00.000Z'));
    tx = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('limits non-manager list queries to published and active schedules', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      rotationSchedule: { findMany, count },
    } as unknown as PrismaService;
    const service = new SchedulesService(prisma, createConfig());

    await service.list(new ListRotationSchedulesDto(), UserRole.CITIZEN);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: [ScheduleStatus.PUBLISHED, ScheduleStatus.ACTIVE] },
        },
      }),
    );
  });

  it('hides draft schedules from citizens but allows dispatchers', async () => {
    const schedule = {
      id: scheduleId,
      kebeleId,
      name: 'Draft',
      startsOn: new Date('2026-09-25T00:00:00.000Z'),
      endsOn: new Date('2026-09-26T00:00:00.000Z'),
      status: ScheduleStatus.DRAFT,
      notes: null,
      createdById: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const findUnique = vi.fn().mockResolvedValue(schedule);
    const prisma = {
      rotationSchedule: { findUnique },
    } as unknown as PrismaService;
    const service = new SchedulesService(prisma, createConfig());

    await expect(service.getById(scheduleId, UserRole.CITIZEN)).rejects.toThrow(
      'Rotation schedule not found',
    );
    await expect(
      service.getById(scheduleId, UserRole.DISPATCHER),
    ).resolves.toBe(schedule);
  });

  it('creates a draft schedule with normalized window dates', async () => {
    const created = {
      id: scheduleId,
      name: 'Morning rotation',
      startsOn: new Date('2026-09-25T00:00:00.000Z'),
      endsOn: new Date('2026-09-26T00:00:00.000Z'),
      status: ScheduleStatus.DRAFT,
    };
    const details = { ...created, kebele: null, createdBy: null, windows: [] };
    const create = vi.fn().mockResolvedValue({ id: scheduleId });
    const findUnique = vi.fn().mockResolvedValue(details);
    const kebeleFindUnique = vi
      .fn()
      .mockResolvedValue({ id: kebeleId, isActive: true });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    tx = {
      kebele: { findUnique: kebeleFindUnique },
      rotationSchedule: { create, findUnique },
      rotationWindow: {
        createMany,
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = createService(tx);

    await service.create(
      {
        kebeleId,
        name: 'Morning rotation',
        startsOn: '2026-09-25',
        endsOn: '2026-09-26',
        windows: [
          {
            startsAt: '2026-09-25T08:00:00',
            endsAt: '2026-09-25T10:00:00',
            minimumPressureBar: 1.5,
            maximumPressureBar: 3,
          },
        ],
      },
      actorId,
    );

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        kebeleId,
        createdById: actorId,
      },
    });
    expect(createMany.mock.calls[0]?.[0]).toMatchObject({
      data: [
        {
          minimumPressureBar: 1.5,
          maximumPressureBar: 3,
        },
      ],
    });
  });

  it('publishes a schedule and writes its outbox event transactionally', async () => {
    const updatedAt = new Date('2026-09-20T08:00:00.000Z');
    const current = {
      id: scheduleId,
      kebeleId,
      name: 'Morning rotation',
      startsOn: new Date('2026-09-25T00:00:00.000Z'),
      endsOn: new Date('2026-09-26T00:00:00.000Z'),
      status: ScheduleStatus.DRAFT,
      notes: null,
      createdById: actorId,
      createdAt: updatedAt,
      updatedAt,
      windows: [
        {
          id: windowId,
          rotationScheduleId: scheduleId,
          standpipeId: null,
          startsAt: new Date('2026-09-25T08:00:00.000Z'),
          endsAt: new Date('2026-09-25T10:00:00.000Z'),
          status: WindowStatus.SCHEDULED,
          minimumPressureBar: null,
          maximumPressureBar: null,
          openedAt: null,
          closedAt: null,
          notes: null,
          createdAt: updatedAt,
          updatedAt,
        },
      ],
    };
    const details = { ...current, status: ScheduleStatus.PUBLISHED };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(details);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const outboxCreate = vi.fn().mockResolvedValue({ id: 'outbox-1' });
    tx = {
      kebele: {
        findUnique: vi.fn().mockResolvedValue({ id: kebeleId, isActive: true }),
      },
      rotationSchedule: { findUnique, updateMany },
      rotationWindow: { findFirst: vi.fn().mockResolvedValue(null) },
      outboxEvent: { create: outboxCreate },
    };
    const service = createService(tx);

    await service.publish(scheduleId, { updatedAt: updatedAt.toISOString() });

    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: scheduleId, updatedAt },
      data: { status: ScheduleStatus.PUBLISHED },
    });
    expect(outboxCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        aggregateType: 'rotation_schedule',
        aggregateId: scheduleId,
        eventType: SCHEDULE_OUTBOX_EVENT_TYPES.published,
      },
    });
  });

  it('opens a window, updates kebele valves, and records the event', async () => {
    const updatedAt = new Date('2026-09-25T07:00:00.000Z');
    const current = {
      id: windowId,
      rotationScheduleId: scheduleId,
      standpipeId,
      startsAt: new Date('2026-09-25T08:00:00.000Z'),
      endsAt: new Date('2026-09-25T10:00:00.000Z'),
      status: WindowStatus.SCHEDULED,
      minimumPressureBar: null,
      maximumPressureBar: null,
      openedAt: null,
      closedAt: null,
      notes: null,
      createdAt: updatedAt,
      updatedAt,
      rotationSchedule: {
        id: scheduleId,
        kebeleId,
        startsOn: new Date('2026-09-25T00:00:00.000Z'),
        endsOn: new Date('2026-09-26T00:00:00.000Z'),
        status: ScheduleStatus.ACTIVE,
        notes: null,
        createdById: actorId,
        createdAt: updatedAt,
        updatedAt,
        name: 'Morning rotation',
      },
    };
    const details = { ...current, status: WindowStatus.OPENED };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(details);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const valveUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const outboxCreate = vi.fn().mockResolvedValue({ id: 'outbox-2' });
    tx = {
      kebele: {
        findUnique: vi.fn().mockResolvedValue({ id: kebeleId, isActive: true }),
      },
      standpipe: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: standpipeId, isActive: true }]),
      },
      rotationWindow: {
        findUnique,
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany,
      },
      valve: { updateMany: valveUpdateMany },
      outboxEvent: { create: outboxCreate },
    };
    const service = createService(tx);

    await service.openWindow(
      scheduleId,
      windowId,
      { updatedAt: updatedAt.toISOString() },
      actorId,
    );

    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: windowId, updatedAt },
      data: { status: WindowStatus.OPENED },
    });
    expect(valveUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { kebeleId },
      data: {
        isOpen: true,
        lastChangedById: actorId,
      },
    });
    expect(outboxCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        eventType: SCHEDULE_OUTBOX_EVENT_TYPES.windowOpened,
        aggregateId: windowId,
      },
    });
  });

  it('sanitizes public list payloads and filters them explicitly', async () => {
    const publicItem = {
      id: scheduleId,
      kebeleId,
      name: 'Public rotation',
      startsOn: new Date('2026-09-25T00:00:00.000Z'),
      endsOn: new Date('2026-09-26T00:00:00.000Z'),
      status: ScheduleStatus.PUBLISHED,
      notes: null,
      kebele: { id: kebeleId, name: 'Kebele', code: 'K-1' },
      windows: [
        {
          id: windowId,
          standpipeId,
          startsAt: new Date('2026-09-25T08:00:00.000Z'),
          endsAt: new Date('2026-09-25T10:00:00.000Z'),
          status: WindowStatus.SCHEDULED,
          minimumPressureBar: null,
          maximumPressureBar: null,
          openedAt: null,
          closedAt: null,
          notes: null,
          standpipe: { id: standpipeId, code: 'SP-1', name: 'Standpipe' },
        },
      ],
    };
    const findMany = vi.fn().mockResolvedValue([publicItem]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = {
      rotationSchedule: { findMany, count },
    } as unknown as PrismaService;
    const service = new SchedulesService(prisma, createConfig());

    const result = await service.list(new ListRotationSchedulesDto(), {
      publicOnly: true,
    });

    const query = findMany.mock.calls[0]?.[0] as {
      select: Record<string, unknown>;
      orderBy: unknown;
      where: unknown;
    };
    expect(query.where).toEqual({
      status: { in: [ScheduleStatus.PUBLISHED, ScheduleStatus.ACTIVE] },
    });
    expect(query.select).not.toHaveProperty('createdById');
    expect(query.select).not.toHaveProperty('createdAt');
    expect(query.select).not.toHaveProperty('updatedAt');
    expect(result.items[0]).toEqual(publicItem);
  });

  it('rejects a local overlap between kebele-wide and standpipe-specific windows', async () => {
    const txCreate = vi.fn();
    const findFirst = vi.fn().mockResolvedValue(null);
    tx = {
      kebele: {
        findUnique: vi.fn().mockResolvedValue({ id: kebeleId, isActive: true }),
      },
      rotationSchedule: { create: txCreate },
      rotationWindow: { findFirst },
    };
    const service = createService(tx);

    await expect(
      service.create(
        {
          kebeleId,
          name: 'Overlapping rotation',
          startsOn: '2026-09-25',
          endsOn: '2026-09-25',
          windows: [
            {
              standpipeId: null,
              startsAt: '2026-09-25T08:00:00',
              endsAt: '2026-09-25T10:00:00',
            },
            {
              standpipeId,
              startsAt: '2026-09-25T09:00:00',
              endsAt: '2026-09-25T11:00:00',
            },
          ],
        },
        actorId,
      ),
    ).rejects.toThrow(
      'Kebele-wide windows cannot overlap standpipe-specific windows',
    );
    expect(txCreate).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('checks every same-kebele window when validating a kebele-wide window', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'existing-window' });
    const txCreate = vi.fn();
    tx = {
      kebele: {
        findUnique: vi.fn().mockResolvedValue({ id: kebeleId, isActive: true }),
      },
      rotationSchedule: { create: txCreate },
      rotationWindow: { findFirst },
    };
    const service = createService(tx);

    await expect(
      service.create(
        {
          kebeleId,
          name: 'Kebele rotation',
          startsOn: '2026-09-25',
          endsOn: '2026-09-25',
          windows: [
            {
              standpipeId: null,
              startsAt: '2026-09-25T08:00:00',
              endsAt: '2026-09-25T10:00:00',
            },
          ],
        },
        actorId,
      ),
    ).rejects.toThrow(
      'Schedule windows overlap another window in the same kebele',
    );
    const query = findFirst.mock.calls[0]?.[0] as {
      where?: { OR?: unknown };
    };
    expect(query?.where?.OR).toBeUndefined();
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('reconciles activation windows and all kebele valves transactionally', async () => {
    const updatedAt = new Date('2026-09-24T08:00:00.000Z');
    const currentWindow = {
      id: windowId,
      rotationScheduleId: scheduleId,
      standpipeId: null,
      startsAt: new Date('2026-09-25T08:00:00.000Z'),
      endsAt: new Date('2026-09-25T10:00:00.000Z'),
      status: WindowStatus.SCHEDULED,
      minimumPressureBar: null,
      maximumPressureBar: null,
      openedAt: null,
      closedAt: null,
      notes: null,
      createdAt: updatedAt,
      updatedAt,
    };
    const pastWindow = {
      ...currentWindow,
      id: secondWindowId,
      startsAt: new Date('2026-09-25T06:00:00.000Z'),
      endsAt: new Date('2026-09-25T07:00:00.000Z'),
    };
    const futureWindow = {
      ...currentWindow,
      id: thirdWindowId,
      startsAt: new Date('2026-09-25T11:00:00.000Z'),
      endsAt: new Date('2026-09-25T12:00:00.000Z'),
    };
    const current = {
      id: scheduleId,
      kebeleId,
      name: 'Morning rotation',
      startsOn: new Date('2026-09-25T00:00:00.000Z'),
      endsOn: new Date('2026-09-26T00:00:00.000Z'),
      status: ScheduleStatus.PUBLISHED,
      notes: null,
      createdById: actorId,
      createdAt: updatedAt,
      updatedAt,
      windows: [currentWindow, pastWindow, futureWindow],
    };
    const details = { ...current, status: ScheduleStatus.ACTIVE };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(details);
    const windowUpdateMany = vi
      .fn<(args: WindowUpdateArgs) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const scheduleUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const valveUpdateMany = vi
      .fn<(args: ValveUpdateArgs) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 3 });
    const outboxCreate = vi
      .fn<(args: OutboxCreateArgs) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: 'outbox-activate' });
    tx = {
      kebele: {
        findUnique: vi.fn().mockResolvedValue({ id: kebeleId, isActive: true }),
      },
      rotationSchedule: { findUnique, updateMany: scheduleUpdateMany },
      rotationWindow: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: windowUpdateMany,
      },
      valve: { updateMany: valveUpdateMany },
      outboxEvent: { create: outboxCreate },
    };
    const service = createService(tx);

    await service.activate(
      scheduleId,
      { updatedAt: updatedAt.toISOString(), reason: 'rotation started' },
      actorId,
    );

    expect(
      windowUpdateMany.mock.calls.map(([args]) => args.data.status),
    ).toEqual([WindowStatus.OPENED, WindowStatus.CLOSED]);
    expect(valveUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { kebeleId },
      data: {
        isOpen: true,
        lastChangedById: actorId,
      },
    });
    expect(outboxCreate.mock.calls[0]?.[0].data).toMatchObject({
      eventType: SCHEDULE_OUTBOX_EVENT_TYPES.activated,
      payload: { reason: 'rotation started' },
    });
  });

  it('rejects activation outside the schedule date range', async () => {
    const updatedAt = new Date('2026-09-24T08:00:00.000Z');
    const current = {
      id: scheduleId,
      kebeleId,
      startsOn: new Date('2026-09-26T00:00:00.000Z'),
      endsOn: new Date('2026-09-27T00:00:00.000Z'),
      status: ScheduleStatus.PUBLISHED,
      updatedAt,
      windows: [],
    };
    tx = {
      rotationSchedule: {
        findUnique: vi.fn().mockResolvedValue(current),
      },
    };
    const service = createService(tx);

    await expect(
      service.activate(scheduleId, {
        updatedAt: updatedAt.toISOString(),
      }),
    ).rejects.toThrow('schedule action is outside the schedule date range');
  });

  it('rejects completion before the schedule end date', async () => {
    const updatedAt = new Date('2026-09-24T08:00:00.000Z');
    const current = {
      id: scheduleId,
      kebeleId,
      startsOn: new Date('2026-09-25T00:00:00.000Z'),
      endsOn: new Date('2026-09-26T00:00:00.000Z'),
      status: ScheduleStatus.ACTIVE,
      updatedAt,
      windows: [],
    };
    tx = {
      rotationSchedule: {
        findUnique: vi.fn().mockResolvedValue(current),
      },
    };
    const service = createService(tx);

    await expect(
      service.complete(scheduleId, {
        updatedAt: updatedAt.toISOString(),
      }),
    ).rejects.toThrow('schedule cannot be completed before its end date');
  });

  it('rejects activation when a referenced standpipe is inactive', async () => {
    const updatedAt = new Date('2026-09-24T08:00:00.000Z');
    const currentWindow = {
      id: windowId,
      rotationScheduleId: scheduleId,
      standpipeId,
      startsAt: new Date('2026-09-25T08:00:00.000Z'),
      endsAt: new Date('2026-09-25T10:00:00.000Z'),
      status: WindowStatus.SCHEDULED,
      minimumPressureBar: null,
      maximumPressureBar: null,
      openedAt: null,
      closedAt: null,
      notes: null,
      createdAt: updatedAt,
      updatedAt,
    };
    const current = {
      id: scheduleId,
      kebeleId,
      startsOn: new Date('2026-09-25T00:00:00.000Z'),
      endsOn: new Date('2026-09-26T00:00:00.000Z'),
      status: ScheduleStatus.PUBLISHED,
      updatedAt,
      windows: [currentWindow],
    };
    tx = {
      rotationSchedule: {
        findUnique: vi.fn().mockResolvedValue(current),
      },
      kebele: {
        findUnique: vi.fn().mockResolvedValue({ id: kebeleId, isActive: true }),
      },
      standpipe: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: standpipeId, isActive: false }]),
      },
    };
    const service = createService(tx);

    await expect(
      service.activate(scheduleId, {
        updatedAt: updatedAt.toISOString(),
      }),
    ).rejects.toThrow('Every schedule standpipe must be active');
  });

  it('closes windows and records completion and cancellation events', async () => {
    const updatedAt = new Date('2026-09-24T08:00:00.000Z');
    const window = {
      id: windowId,
      rotationScheduleId: scheduleId,
      standpipeId: null,
      startsAt: new Date('2026-09-25T08:00:00.000Z'),
      endsAt: new Date('2026-09-25T10:00:00.000Z'),
      status: WindowStatus.OPENED,
      minimumPressureBar: null,
      maximumPressureBar: null,
      openedAt: new Date('2026-09-25T08:00:00.000Z'),
      closedAt: null,
      notes: null,
      createdAt: updatedAt,
      updatedAt,
    };
    const current = {
      id: scheduleId,
      kebeleId,
      startsOn: new Date('2026-09-25T00:00:00.000Z'),
      endsOn: new Date('2026-09-26T00:00:00.000Z'),
      status: ScheduleStatus.ACTIVE,
      updatedAt,
      windows: [window],
    };
    const details = { ...current, status: ScheduleStatus.COMPLETED };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(details);
    const windowUpdateMany = vi
      .fn<(args: WindowUpdateArgs) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const scheduleUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const valveUpdateMany = vi
      .fn<(args: ValveUpdateArgs) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 2 });
    const outboxCreate = vi
      .fn<(args: OutboxCreateArgs) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: 'outbox-complete' });
    tx = {
      rotationSchedule: { findUnique, updateMany: scheduleUpdateMany },
      rotationWindow: { updateMany: windowUpdateMany },
      valve: { updateMany: valveUpdateMany },
      outboxEvent: { create: outboxCreate },
    };
    const service = createService(tx);
    vi.setSystemTime(new Date('2026-09-27T09:00:00.000Z'));

    await service.complete(
      scheduleId,
      { updatedAt: updatedAt.toISOString(), reason: 'rotation finished' },
      actorId,
    );

    expect(windowUpdateMany.mock.calls[0]?.[0].data.status).toBe(
      WindowStatus.CLOSED,
    );
    expect(valveUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      data: { isOpen: false },
    });
    expect(outboxCreate.mock.calls[0]?.[0].data).toMatchObject({
      eventType: SCHEDULE_OUTBOX_EVENT_TYPES.completed,
      payload: { reason: 'rotation finished' },
    });
  });

  it('rejects manual window changes outside the window bounds', async () => {
    const updatedAt = new Date('2026-09-25T07:00:00.000Z');
    const current = {
      id: windowId,
      rotationScheduleId: scheduleId,
      standpipeId: null,
      startsAt: new Date('2026-09-25T08:00:00.000Z'),
      endsAt: new Date('2026-09-25T10:00:00.000Z'),
      status: WindowStatus.OPENED,
      minimumPressureBar: null,
      maximumPressureBar: null,
      openedAt: new Date('2026-09-25T08:00:00.000Z'),
      closedAt: null,
      notes: null,
      createdAt: updatedAt,
      updatedAt,
      rotationSchedule: {
        id: scheduleId,
        kebeleId,
        startsOn: new Date('2026-09-25T00:00:00.000Z'),
        endsOn: new Date('2026-09-26T00:00:00.000Z'),
        status: ScheduleStatus.ACTIVE,
        notes: null,
        createdById: actorId,
        createdAt: updatedAt,
        updatedAt,
        name: 'Morning rotation',
      },
    };
    tx = {
      rotationWindow: {
        findUnique: vi.fn().mockResolvedValue(current),
      },
    };
    const service = createService(tx);
    vi.setSystemTime(new Date('2026-09-25T11:00:00.000Z'));

    await expect(
      service.closeWindow(
        scheduleId,
        windowId,
        { updatedAt: updatedAt.toISOString() },
        actorId,
      ),
    ).rejects.toThrow(
      'Window actions are only allowed within the window time bounds',
    );
  });
});
