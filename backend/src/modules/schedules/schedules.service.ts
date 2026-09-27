import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma.service.js';
import { paginated, type PageResult } from '../../common/dto/pagination.dto.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  ScheduleStatus,
  UserRole,
  WindowStatus,
} from '../../generated/prisma/enums.js';
import type {
  RotationScheduleModel,
  RotationWindowModel,
} from '../../generated/prisma/models.js';
import {
  InvalidTransitionError,
  transitionScheduleStatus,
  transitionWindowStatus,
} from './schedule-state.js';
import type {
  CreateRotationScheduleDto,
  ListRotationSchedulesDto,
  RotationWindowInputDto,
  ScheduleTransitionDto,
  UpdateRotationScheduleDto,
  WindowTransitionDto,
} from './schedules.dto.js';

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const defaultTimezone = 'Africa/Addis_Ababa';
const maximumPressureBar = 9999.999;
const publicScheduleStatuses = [
  ScheduleStatus.PUBLISHED,
  ScheduleStatus.ACTIVE,
] as const;
const scheduleAggregateType = 'rotation_schedule';
const windowAggregateType = 'rotation_window';

export const SCHEDULE_OUTBOX_EVENT_TYPES = {
  published: 'rotation_schedule.published',
  activated: 'rotation_schedule.activated',
  completed: 'rotation_schedule.completed',
  cancelled: 'rotation_schedule.cancelled',
  windowOpened: 'rotation_window.opened',
  windowClosed: 'rotation_window.closed',
} as const;

const scheduleDetailsInclude = {
  kebele: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      displayName: true,
      role: true,
    },
  },
  windows: {
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    include: {
      standpipe: {
        select: {
          id: true,
          kebeleId: true,
          code: true,
          name: true,
        },
      },
    },
  },
} as const satisfies Prisma.RotationScheduleInclude;

const publicScheduleDetailsSelect = {
  id: true,
  kebeleId: true,
  name: true,
  startsOn: true,
  endsOn: true,
  status: true,
  notes: true,
  kebele: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
  windows: {
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      standpipeId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      minimumPressureBar: true,
      maximumPressureBar: true,
      openedAt: true,
      closedAt: true,
      notes: true,
      standpipe: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  },
} as const satisfies Prisma.RotationScheduleSelect;

const windowDetailsInclude = {
  rotationSchedule: {
    select: {
      id: true,
      kebeleId: true,
      status: true,
      startsOn: true,
      endsOn: true,
    },
  },
  standpipe: {
    select: {
      id: true,
      kebeleId: true,
      code: true,
      name: true,
    },
  },
} as const satisfies Prisma.RotationWindowInclude;

export type ScheduleDetails = Prisma.RotationScheduleGetPayload<{
  include: typeof scheduleDetailsInclude;
}>;

export type PublicScheduleDetails = Prisma.RotationScheduleGetPayload<{
  select: typeof publicScheduleDetailsSelect;
}>;

export type WindowDetails = Prisma.RotationWindowGetPayload<{
  include: typeof windowDetailsInclude;
}>;

export interface ScheduleRequest {
  publicOnly?: boolean;
  user?: {
    id?: string;
    userId?: string;
    sub?: string;
    role?: UserRole;
  };
}

type DateInput = Date | string;
type RoleInput = UserRole | AuthenticatedUser | ScheduleRequest | undefined;
type VersionInput =
  | DateInput
  | {
      updatedAt: DateInput;
      reason?: string | null;
    };

type WindowInput = {
  standpipeId?: string | null;
  startsAt: DateInput;
  endsAt: DateInput;
  minimumPressureBar?: unknown;
  maximumPressureBar?: unknown;
  notes?: string | null;
};

type NormalizedWindow = {
  standpipeId: string | null;
  startsAt: Date;
  endsAt: Date;
  minimumPressureBar: number | null;
  maximumPressureBar: number | null;
  notes: string | null;
};

type ScheduleRange = {
  startsOn: DateTime;
  endsOn: DateTime;
  start: DateTime;
  end: DateTime;
};

type ScheduleWithWindows = RotationScheduleModel & {
  windows: RotationWindowModel[];
};

@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async create(
    dto: CreateRotationScheduleDto,
    actorId: string,
  ): Promise<ScheduleDetails> {
    this.requireActorId(actorId);
    const timezone = this.getTimezone();
    const range = this.parseScheduleRange(dto.startsOn, dto.endsOn, timezone);
    const windows = this.normalizeWindows(dto.windows ?? [], range, timezone);

    return this.inTransaction(async (tx) => {
      await this.assertWindowSet(tx, dto.kebeleId, windows);

      const schedule = await tx.rotationSchedule.create({
        data: {
          kebeleId: dto.kebeleId,
          name: dto.name,
          status: ScheduleStatus.DRAFT,
          startsOn: this.dateOnlyValue(range.startsOn),
          endsOn: this.dateOnlyValue(range.endsOn),
          notes: dto.notes ?? null,
          createdById: actorId,
        },
        select: {
          id: true,
        },
      });

      if (windows.length > 0) {
        await tx.rotationWindow.createMany({
          data: windows.map((window) => ({
            rotationScheduleId: schedule.id,
            standpipeId: window.standpipeId,
            status: WindowStatus.SCHEDULED,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            minimumPressureBar: window.minimumPressureBar,
            maximumPressureBar: window.maximumPressureBar,
            notes: window.notes,
          })),
        });
      }

      return this.findScheduleDetails(tx, schedule.id);
    });
  }

  async update(
    id: string,
    dto: UpdateRotationScheduleDto,
  ): Promise<ScheduleDetails> {
    this.assertNoNullUpdateFields(dto);
    const expectedUpdatedAt = this.parseVersion(dto.updatedAt);
    const timezone = this.getTimezone();

    return this.inTransaction(async (tx) => {
      const current = await tx.rotationSchedule.findUnique({
        where: { id },
      });

      if (!current) {
        throw new NotFoundException('Rotation schedule not found');
      }

      this.assertVersion(current.updatedAt, expectedUpdatedAt);

      if (current.status !== ScheduleStatus.DRAFT) {
        throw new ConflictException('Only draft schedules can be updated');
      }

      const kebeleId = dto.kebeleId ?? current.kebeleId;
      const startsOn: DateInput = dto.startsOn ?? current.startsOn;
      const endsOn: DateInput = dto.endsOn ?? current.endsOn;
      const range = this.parseScheduleRange(startsOn, endsOn, timezone);

      let windows: NormalizedWindow[];
      if (dto.windows !== undefined) {
        windows = this.normalizeWindows(dto.windows, range, timezone);
      } else {
        const currentWindows = await tx.rotationWindow.findMany({
          where: { rotationScheduleId: id },
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        });
        windows = this.normalizeWindows(currentWindows, range, timezone);
      }

      await this.assertWindowSet(tx, kebeleId, windows, id);

      const data: Prisma.RotationScheduleUncheckedUpdateInput = {};
      if (dto.kebeleId !== undefined) {
        data.kebeleId = dto.kebeleId;
      }
      if (dto.name !== undefined) {
        data.name = dto.name;
      }
      if (dto.startsOn !== undefined) {
        data.startsOn = this.dateOnlyValue(range.startsOn);
      }
      if (dto.endsOn !== undefined) {
        data.endsOn = this.dateOnlyValue(range.endsOn);
      }
      if (dto.notes !== undefined) {
        data.notes = dto.notes;
      }

      const hasWindowUpdate = dto.windows !== undefined;
      if (Object.keys(data).length > 0 || hasWindowUpdate) {
        data.updatedAt = this.getNow(timezone).toJSDate();
        await this.updateScheduleWithVersion(tx, id, expectedUpdatedAt, data);
      }

      if (dto.windows !== undefined) {
        await tx.rotationWindow.deleteMany({
          where: { rotationScheduleId: id },
        });
        if (windows.length > 0) {
          await tx.rotationWindow.createMany({
            data: windows.map((window) => ({
              rotationScheduleId: id,
              standpipeId: window.standpipeId,
              status: WindowStatus.SCHEDULED,
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              minimumPressureBar: window.minimumPressureBar,
              maximumPressureBar: window.maximumPressureBar,
              notes: window.notes,
            })),
          });
        }
      }

      return this.findScheduleDetails(tx, id);
    });
  }

  async list(
    query: ListRotationSchedulesDto,
    role?: RoleInput,
  ): Promise<PageResult<ScheduleDetails>> {
    const where = this.buildListWhere(query, role);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const pagination = {
      ...query,
      page,
      limit,
    } as ListRotationSchedulesDto;

    if (!this.isPublicOnly(role) && this.canManage(this.resolveRole(role))) {
      const [items, total] = await Promise.all([
        this.prisma.rotationSchedule.findMany({
          where,
          include: scheduleDetailsInclude,
          orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take: limit,
        }),
        this.prisma.rotationSchedule.count({ where }),
      ]);

      return paginated(items, total, pagination);
    }

    const [items, total] = await Promise.all([
      this.prisma.rotationSchedule.findMany({
        where,
        select: publicScheduleDetailsSelect,
        orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.rotationSchedule.count({ where }),
    ]);

    return paginated(
      items.map((item) => this.toPublicSchedule(item)),
      total,
      pagination,
    ) as PageResult<ScheduleDetails>;
  }

  async getById(id: string, role?: RoleInput): Promise<ScheduleDetails> {
    const publicOnly = this.isPublicOnly(role);
    if (!publicOnly && this.canManage(this.resolveRole(role))) {
      const schedule = await this.prisma.rotationSchedule.findUnique({
        where: { id },
        include: scheduleDetailsInclude,
      });

      if (!schedule) {
        throw new NotFoundException('Rotation schedule not found');
      }

      return schedule;
    }

    const schedule = await this.prisma.rotationSchedule.findUnique({
      where: { id },
      select: publicScheduleDetailsSelect,
    });

    if (
      !schedule ||
      (publicOnly
        ? !this.isPublicStatus(schedule.status)
        : !this.canReadStatus(schedule.status, role))
    ) {
      throw new NotFoundException('Rotation schedule not found');
    }

    return this.toPublicSchedule(schedule) as ScheduleDetails;
  }

  async publish(
    id: string,
    version: ScheduleTransitionDto | VersionInput,
    actorId?: string,
  ): Promise<ScheduleDetails> {
    return this.transitionSchedule(
      id,
      version,
      ScheduleStatus.PUBLISHED,
      actorId,
    );
  }

  async activate(
    id: string,
    version: ScheduleTransitionDto | VersionInput,
    actorId?: string,
  ): Promise<ScheduleDetails> {
    return this.transitionSchedule(id, version, ScheduleStatus.ACTIVE, actorId);
  }

  async cancel(
    id: string,
    version: ScheduleTransitionDto | VersionInput,
    actorId?: string,
  ): Promise<ScheduleDetails> {
    return this.transitionSchedule(
      id,
      version,
      ScheduleStatus.CANCELLED,
      actorId,
    );
  }

  async complete(
    id: string,
    version: ScheduleTransitionDto | VersionInput,
    actorId?: string,
  ): Promise<ScheduleDetails> {
    return this.transitionSchedule(
      id,
      version,
      ScheduleStatus.COMPLETED,
      actorId,
    );
  }

  async openWindow(
    scheduleId: string,
    windowId: string,
    version: WindowTransitionDto | VersionInput,
    actorId: string,
  ): Promise<WindowDetails> {
    return this.changeWindow(
      scheduleId,
      windowId,
      version,
      actorId,
      WindowStatus.OPENED,
    );
  }

  async closeWindow(
    scheduleId: string,
    windowId: string,
    version: WindowTransitionDto | VersionInput,
    actorId: string,
  ): Promise<WindowDetails> {
    return this.changeWindow(
      scheduleId,
      windowId,
      version,
      actorId,
      WindowStatus.CLOSED,
    );
  }

  async findAll(
    query: ListRotationSchedulesDto,
    role?: RoleInput,
  ): Promise<PageResult<ScheduleDetails>> {
    return this.list(query, role);
  }

  async findOne(id: string, role?: RoleInput): Promise<ScheduleDetails> {
    return this.getById(id, role);
  }

  async publishSchedule(
    id: string,
    version: ScheduleTransitionDto | VersionInput,
    actorId?: string,
  ): Promise<ScheduleDetails> {
    return this.publish(id, version, actorId);
  }

  async activateSchedule(
    id: string,
    version: ScheduleTransitionDto | VersionInput,
    actorId?: string,
  ): Promise<ScheduleDetails> {
    return this.activate(id, version, actorId);
  }

  async cancelSchedule(
    id: string,
    version: ScheduleTransitionDto | VersionInput,
    actorId?: string,
  ): Promise<ScheduleDetails> {
    return this.cancel(id, version, actorId);
  }

  async completeSchedule(
    id: string,
    version: ScheduleTransitionDto | VersionInput,
    actorId?: string,
  ): Promise<ScheduleDetails> {
    return this.complete(id, version, actorId);
  }

  private async transitionSchedule(
    id: string,
    version: ScheduleTransitionDto | VersionInput,
    target: ScheduleStatus,
    actorId?: string,
  ): Promise<ScheduleDetails> {
    const expectedUpdatedAt = this.parseVersion(version);
    const timezone = this.getTimezone();
    const now = this.getNow(timezone);
    const reason = this.transitionReason(version);

    return this.inTransaction(async (tx) => {
      const current = await tx.rotationSchedule.findUnique({
        where: { id },
        include: {
          windows: {
            orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          },
        },
      });

      if (!current) {
        throw new NotFoundException('Rotation schedule not found');
      }

      this.assertVersion(current.updatedAt, expectedUpdatedAt);

      try {
        transitionScheduleStatus(current.status, target);
      } catch (error: unknown) {
        if (error instanceof InvalidTransitionError) {
          throw new ConflictException(error.message);
        }
        throw error;
      }

      const range = this.parseScheduleRange(
        current.startsOn,
        current.endsOn,
        timezone,
      );
      this.assertLifecycleTime(target, now, range);

      if (target === ScheduleStatus.PUBLISHED) {
        const validWindows = current.windows.filter(
          (window) => window.status !== WindowStatus.CANCELLED,
        );
        if (validWindows.length === 0) {
          throw new BadRequestException(
            'A schedule must contain at least one valid window before publishing',
          );
        }
        if (
          validWindows.some(
            (window) => window.status !== WindowStatus.SCHEDULED,
          )
        ) {
          throw new ConflictException(
            'Only scheduled windows can be published',
          );
        }
        const normalizedWindows = this.normalizeWindows(
          validWindows,
          range,
          timezone,
        );
        await this.assertWindowSet(
          tx,
          current.kebeleId,
          normalizedWindows,
          current.id,
        );
      }

      if (target === ScheduleStatus.ACTIVE) {
        const validWindows = current.windows.filter(
          (window) => window.status !== WindowStatus.CANCELLED,
        );
        if (validWindows.length === 0) {
          throw new BadRequestException(
            'A schedule must contain at least one valid window before activation',
          );
        }
        const normalizedWindows = this.normalizeWindows(
          validWindows,
          range,
          timezone,
        );
        await this.assertWindowSet(
          tx,
          current.kebeleId,
          normalizedWindows,
          current.id,
        );
        await this.reconcileActivationWindows(
          tx,
          current,
          now,
          timezone,
          actorId,
        );
      }

      if (
        target === ScheduleStatus.CANCELLED ||
        target === ScheduleStatus.COMPLETED
      ) {
        await this.reconcileTerminalWindows(tx, current, target, now, actorId);
      }

      await this.updateScheduleWithVersion(tx, id, expectedUpdatedAt, {
        status: target,
        updatedAt: now.toJSDate(),
      });
      await this.writeScheduleOutboxEvent(
        tx,
        current,
        target,
        reason,
        actorId,
        now.toJSDate(),
      );

      return this.findScheduleDetails(tx, id);
    });
  }

  private async changeWindow(
    scheduleId: string,
    windowId: string,
    version: WindowTransitionDto | VersionInput,
    actorId: string,
    target: WindowStatus,
  ): Promise<WindowDetails> {
    this.requireActorId(actorId);
    const expectedUpdatedAt = this.parseVersion(version);
    const timezone = this.getTimezone();
    const now = this.getNow(timezone);
    const reason = this.transitionReason(version);

    return this.inTransaction(async (tx) => {
      const current = await tx.rotationWindow.findUnique({
        where: { id: windowId },
        include: {
          rotationSchedule: true,
        },
      });

      if (!current || current.rotationScheduleId !== scheduleId) {
        throw new NotFoundException('Rotation window not found');
      }

      this.assertVersion(current.updatedAt, expectedUpdatedAt);

      if (
        current.rotationSchedule.status !== ScheduleStatus.PUBLISHED &&
        current.rotationSchedule.status !== ScheduleStatus.ACTIVE
      ) {
        throw new ConflictException(
          'Only published or active schedules can change window state',
        );
      }

      const range = this.parseScheduleRange(
        current.rotationSchedule.startsOn,
        current.rotationSchedule.endsOn,
        timezone,
      );
      this.assertWithinRange(now, range, 'schedule');
      this.assertWithinWindow(now, current, timezone);

      try {
        transitionWindowStatus(current.status, target);
      } catch (error: unknown) {
        if (error instanceof InvalidTransitionError) {
          throw new ConflictException(error.message);
        }
        throw error;
      }

      const normalizedWindow = this.normalizeWindows(
        [current],
        range,
        timezone,
      )[0];
      await this.assertWindowSet(
        tx,
        current.rotationSchedule.kebeleId,
        [normalizedWindow],
        current.rotationScheduleId,
      );

      const changedAt = now.toJSDate();
      const data: Prisma.RotationWindowUncheckedUpdateInput = {
        status: target,
        updatedAt: changedAt,
      };
      if (target === WindowStatus.OPENED) {
        data.openedAt = changedAt;
        data.closedAt = null;
      } else {
        data.closedAt = changedAt;
      }

      const result = await tx.rotationWindow.updateMany({
        where: {
          id: windowId,
          status: current.status,
          updatedAt: expectedUpdatedAt,
        },
        data,
      });
      this.assertUpdatedCount(result.count);

      await this.updateValves(
        tx,
        current.rotationSchedule.kebeleId,
        target === WindowStatus.OPENED,
        changedAt,
        actorId,
      );
      await this.writeWindowOutboxEvent(
        tx,
        current,
        target,
        changedAt,
        reason,
        actorId,
      );

      return this.findWindowDetails(tx, windowId);
    });
  }

  private async inTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  private buildListWhere(
    query: ListRotationSchedulesDto,
    role: RoleInput,
  ): Prisma.RotationScheduleWhereInput {
    const where: Prisma.RotationScheduleWhereInput = {};
    const resolvedRole = this.resolveRole(role);
    const canManage = !this.isPublicOnly(role) && this.canManage(resolvedRole);
    const timezone = this.getTimezone();

    if (query.kebeleId) {
      where.kebeleId = query.kebeleId;
    }

    if (canManage) {
      if (query.status) {
        where.status = query.status;
      }
    } else if (query.status) {
      if (
        query.status === ScheduleStatus.PUBLISHED ||
        query.status === ScheduleStatus.ACTIVE
      ) {
        where.status = query.status;
      } else {
        where.status = {
          in: [],
        };
      }
    } else {
      where.status = {
        in: [...publicScheduleStatuses],
      };
    }

    if (query.from || query.to) {
      const from = query.from
        ? this.parseDateOnly(query.from, timezone, 'from')
        : undefined;
      const to = query.to
        ? this.parseDateOnly(query.to, timezone, 'to')
        : undefined;
      if (from && to && to.toMillis() < from.toMillis()) {
        throw new BadRequestException('from must be on or before to');
      }
      const startsOn: Prisma.DateTimeFilter<'RotationSchedule'> = {};
      if (from) {
        startsOn.gte = this.dateOnlyValue(from);
      }
      if (to) {
        startsOn.lte = this.dateOnlyValue(to);
      }
      where.startsOn = startsOn;
    }

    return where;
  }

  private async assertActiveKebele(
    tx: Prisma.TransactionClient,
    kebeleId: string,
  ): Promise<void> {
    const kebele = await tx.kebele.findUnique({
      where: { id: kebeleId },
      select: { id: true, isActive: true },
    });
    if (!kebele) {
      throw new BadRequestException('Kebele not found');
    }
    if (!kebele.isActive) {
      throw new BadRequestException('Kebele must be active');
    }
  }

  private async assertWindowSet(
    tx: Prisma.TransactionClient,
    kebeleId: string,
    windows: readonly NormalizedWindow[],
    excludeScheduleId?: string,
  ): Promise<void> {
    await this.assertActiveKebele(tx, kebeleId);
    this.assertLocalWindowOverlaps(windows);
    await this.assertStandpipesBelongToKebele(tx, kebeleId, windows);
    await this.assertPersistedWindowOverlaps(
      tx,
      kebeleId,
      windows,
      excludeScheduleId,
    );
  }

  private assertLocalWindowOverlaps(
    windows: readonly NormalizedWindow[],
  ): void {
    for (let leftIndex = 0; leftIndex < windows.length; leftIndex += 1) {
      const left = windows[leftIndex];
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < windows.length;
        rightIndex += 1
      ) {
        const right = windows[rightIndex];
        if (
          (left.standpipeId === null || right.standpipeId === null) &&
          left.startsAt.getTime() < right.endsAt.getTime() &&
          left.endsAt.getTime() > right.startsAt.getTime()
        ) {
          throw new BadRequestException(
            'Kebele-wide windows cannot overlap standpipe-specific windows',
          );
        }
      }
    }

    const grouped = new Map<string, NormalizedWindow[]>();
    for (const window of windows) {
      if (window.standpipeId === null) {
        continue;
      }
      const current = grouped.get(window.standpipeId) ?? [];
      current.push(window);
      grouped.set(window.standpipeId, current);
    }

    for (const [standpipeId, standpipeWindows] of grouped) {
      const ordered = [...standpipeWindows].sort(
        (left, right) => left.startsAt.getTime() - right.startsAt.getTime(),
      );
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1];
        const current = ordered[index];
        if (previous.endsAt.getTime() > current.startsAt.getTime()) {
          throw new BadRequestException(
            `Windows for standpipe ${standpipeId} overlap`,
          );
        }
      }
    }
  }

  private async assertStandpipesBelongToKebele(
    tx: Prisma.TransactionClient,
    kebeleId: string,
    windows: readonly NormalizedWindow[],
  ): Promise<void> {
    const standpipeIds = [
      ...new Set(
        windows
          .map((window) => window.standpipeId)
          .filter((id): id is string => id !== null),
      ),
    ];

    if (standpipeIds.length === 0) {
      return;
    }

    const standpipes = await tx.standpipe.findMany({
      where: {
        id: { in: standpipeIds },
        kebeleId,
      },
      select: { id: true, isActive: true },
    });

    if (
      standpipes.length !== standpipeIds.length ||
      standpipes.some((standpipe) => !standpipe.isActive)
    ) {
      throw new BadRequestException(
        'Every schedule standpipe must be active and belong to the schedule kebele',
      );
    }
  }

  private async assertPersistedWindowOverlaps(
    tx: Prisma.TransactionClient,
    kebeleId: string,
    windows: readonly NormalizedWindow[],
    excludeScheduleId?: string,
  ): Promise<void> {
    for (const window of windows) {
      const where: Prisma.RotationWindowWhereInput = {
        startsAt: { lt: window.endsAt },
        endsAt: { gt: window.startsAt },
        status: { not: WindowStatus.CANCELLED },
        rotationSchedule: {
          is: {
            kebeleId,
            status: { not: ScheduleStatus.CANCELLED },
          },
        },
      };
      if (window.standpipeId !== null) {
        where.OR = [{ standpipeId: null }, { standpipeId: window.standpipeId }];
      }
      if (excludeScheduleId) {
        where.rotationScheduleId = { not: excludeScheduleId };
      }

      const conflict = await tx.rotationWindow.findFirst({
        where,
        select: { id: true },
      });
      if (conflict) {
        throw new BadRequestException(
          'Schedule windows overlap another window in the same kebele',
        );
      }
    }
  }

  private normalizeWindows(
    windows: readonly (WindowInput | RotationWindowInputDto)[],
    range: ScheduleRange,
    timezone: string,
  ): NormalizedWindow[] {
    const startOfRange = range.start;
    const endOfRange = range.end;
    const normalized: NormalizedWindow[] = [];

    for (const [index, window] of windows.entries()) {
      const startsAt = this.parseWindowDate(
        window.startsAt,
        timezone,
        `windows[${index}].startsAt`,
      );
      const endsAt = this.parseWindowDate(
        window.endsAt,
        timezone,
        `windows[${index}].endsAt`,
      );
      const minimumPressureBar = this.parseOptionalNumber(
        window.minimumPressureBar,
        `windows[${index}].minimumPressureBar`,
      );
      const maximumPressureBar = this.parseOptionalNumber(
        window.maximumPressureBar,
        `windows[${index}].maximumPressureBar`,
      );

      if (startsAt.toMillis() >= endsAt.toMillis()) {
        throw new BadRequestException(
          `Window ${index + 1} must start before it ends`,
        );
      }
      if (
        startsAt.toMillis() < startOfRange.toMillis() ||
        endsAt.toMillis() > endOfRange.toMillis()
      ) {
        throw new BadRequestException(
          `Window ${index + 1} must fall within the schedule dates`,
        );
      }
      if (
        minimumPressureBar !== null &&
        maximumPressureBar !== null &&
        minimumPressureBar > maximumPressureBar
      ) {
        throw new BadRequestException(
          `Window ${index + 1} minimum pressure cannot exceed maximum pressure`,
        );
      }

      normalized.push({
        standpipeId: window.standpipeId ?? null,
        startsAt: startsAt.toJSDate(),
        endsAt: endsAt.toJSDate(),
        minimumPressureBar,
        maximumPressureBar,
        notes: window.notes ?? null,
      });
    }

    return normalized;
  }

  private parseScheduleRange(
    startsOn: DateInput,
    endsOn: DateInput,
    timezone: string,
  ): ScheduleRange {
    const start = this.parseDateOnly(startsOn, timezone, 'startsOn');
    const end = this.parseDateOnly(endsOn, timezone, 'endsOn');
    if (end.toMillis() < start.toMillis()) {
      throw new BadRequestException('endsOn must be on or after startsOn');
    }
    return {
      startsOn: start,
      endsOn: end,
      start: start.startOf('day'),
      end: end.endOf('day'),
    };
  }

  private dateOnlyValue(value: DateTime): string {
    return value.toFormat('yyyy-MM-dd');
  }

  private parseDateOnly(
    value: DateInput,
    timezone: string,
    field: string,
  ): DateTime {
    let parsed: DateTime;
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) {
        throw new BadRequestException(`${field} must be a valid date`);
      }
      parsed = DateTime.fromISO(value.toISOString().slice(0, 10), {
        zone: timezone,
      });
    } else {
      const text = value.trim();
      if (!dateOnlyPattern.test(text)) {
        throw new BadRequestException(
          `${field} must be a date in YYYY-MM-DD format`,
        );
      }
      parsed = DateTime.fromISO(text, { zone: timezone });
    }

    if (!parsed.isValid || parsed.toISODate() === null) {
      throw new BadRequestException(`${field} must be a valid date`);
    }

    return parsed.startOf('day');
  }

  private getNow(timezone: string): DateTime {
    const now = DateTime.now().setZone(timezone);
    if (!now.isValid) {
      throw new BadRequestException('Application timezone is invalid');
    }
    return now;
  }

  private assertLifecycleTime(
    target: ScheduleStatus,
    now: DateTime,
    range: ScheduleRange,
  ): void {
    const nowTime = now.toMillis();
    if (target === ScheduleStatus.PUBLISHED && nowTime > range.end.toMillis()) {
      throw new BadRequestException(
        'A schedule cannot be published after its end date',
      );
    }
    if (target === ScheduleStatus.ACTIVE) {
      this.assertWithinRange(now, range, 'schedule');
    }
    if (target === ScheduleStatus.COMPLETED && nowTime < range.end.toMillis()) {
      throw new BadRequestException(
        'A schedule cannot be completed before its end date',
      );
    }
    if (target === ScheduleStatus.CANCELLED && nowTime > range.end.toMillis()) {
      throw new BadRequestException(
        'A schedule cannot be cancelled after its end date',
      );
    }
  }

  private assertWithinRange(
    value: DateTime,
    range: ScheduleRange,
    label: string,
  ): void {
    if (
      value.toMillis() < range.start.toMillis() ||
      value.toMillis() > range.end.toMillis()
    ) {
      throw new BadRequestException(
        `${label} action is outside the schedule date range`,
      );
    }
  }

  private assertWithinWindow(
    value: DateTime,
    window: RotationWindowModel,
    timezone: string,
  ): void {
    const startsAt = this.parseWindowDate(
      window.startsAt,
      timezone,
      'startsAt',
    );
    const endsAt = this.parseWindowDate(window.endsAt, timezone, 'endsAt');
    if (
      value.toMillis() < startsAt.toMillis() ||
      value.toMillis() > endsAt.toMillis()
    ) {
      throw new BadRequestException(
        'Window actions are only allowed within the window time bounds',
      );
    }
  }

  private assertNoNullUpdateFields(dto: UpdateRotationScheduleDto): void {
    for (const field of [
      'updatedAt',
      'kebeleId',
      'name',
      'startsOn',
      'endsOn',
      'windows',
    ] as const) {
      if (dto[field] === null) {
        throw new BadRequestException(`${field} cannot be null`);
      }
    }
  }

  private transitionReason(value: VersionInput): string | null {
    if (
      typeof value === 'object' &&
      value !== null &&
      !(value instanceof Date) &&
      'reason' in value
    ) {
      return value.reason ?? null;
    }
    return null;
  }

  private async reconcileActivationWindows(
    tx: Prisma.TransactionClient,
    schedule: ScheduleWithWindows,
    now: DateTime,
    timezone: string,
    actorId?: string,
  ): Promise<void> {
    let hasOpenWindow = false;
    const changedAt = now.toJSDate();

    for (const window of schedule.windows) {
      if (window.status === WindowStatus.CANCELLED) {
        continue;
      }

      const startsAt = this.parseWindowDate(
        window.startsAt,
        timezone,
        'startsAt',
      );
      const endsAt = this.parseWindowDate(window.endsAt, timezone, 'endsAt');
      const nowTime = now.toMillis();
      let target: WindowStatus | undefined;

      if (nowTime < startsAt.toMillis()) {
        if (window.status === WindowStatus.OPENED) {
          target = WindowStatus.SCHEDULED;
        }
      } else if (nowTime > endsAt.toMillis()) {
        if (
          window.status === WindowStatus.SCHEDULED ||
          window.status === WindowStatus.OPENED
        ) {
          target = WindowStatus.CLOSED;
        }
      } else if (window.status === WindowStatus.SCHEDULED) {
        target = WindowStatus.OPENED;
      }

      if (
        window.status === WindowStatus.OPENED &&
        target !== WindowStatus.CLOSED &&
        target !== WindowStatus.SCHEDULED
      ) {
        hasOpenWindow = true;
      }
      if (target === WindowStatus.OPENED) {
        hasOpenWindow = true;
      }
      if (target === undefined) {
        continue;
      }

      const data: Prisma.RotationWindowUncheckedUpdateInput = {
        status: target,
        updatedAt: changedAt,
      };
      if (target === WindowStatus.OPENED) {
        data.openedAt = changedAt;
        data.closedAt = null;
      } else if (target === WindowStatus.CLOSED) {
        data.closedAt = changedAt;
      } else {
        data.openedAt = null;
        data.closedAt = null;
      }

      const result = await tx.rotationWindow.updateMany({
        where: {
          id: window.id,
          status: window.status,
          updatedAt: window.updatedAt,
        },
        data,
      });
      this.assertUpdatedCount(result.count);
    }

    await this.updateValves(
      tx,
      schedule.kebeleId,
      hasOpenWindow,
      changedAt,
      actorId,
    );
  }

  private async reconcileTerminalWindows(
    tx: Prisma.TransactionClient,
    schedule: ScheduleWithWindows,
    target: typeof ScheduleStatus.CANCELLED | typeof ScheduleStatus.COMPLETED,
    now: DateTime,
    actorId?: string,
  ): Promise<void> {
    const changedAt = now.toJSDate();

    for (const window of schedule.windows) {
      if (window.status === WindowStatus.CANCELLED) {
        continue;
      }
      if (
        target === ScheduleStatus.COMPLETED &&
        window.status === WindowStatus.CLOSED
      ) {
        continue;
      }

      const data: Prisma.RotationWindowUncheckedUpdateInput = {
        status:
          target === ScheduleStatus.CANCELLED
            ? WindowStatus.CANCELLED
            : WindowStatus.CLOSED,
        updatedAt: changedAt,
      };
      if (
        target === ScheduleStatus.CANCELLED &&
        window.status === WindowStatus.OPENED
      ) {
        data.closedAt = changedAt;
      }
      if (target === ScheduleStatus.COMPLETED) {
        data.closedAt = changedAt;
      }

      const result = await tx.rotationWindow.updateMany({
        where: {
          id: window.id,
          status: window.status,
          updatedAt: window.updatedAt,
        },
        data,
      });
      this.assertUpdatedCount(result.count);
    }

    await this.updateValves(tx, schedule.kebeleId, false, changedAt, actorId);
  }

  private async updateValves(
    tx: Prisma.TransactionClient,
    kebeleId: string,
    isOpen: boolean,
    changedAt: Date,
    actorId?: string,
  ): Promise<void> {
    const data: Prisma.ValveUncheckedUpdateInput = {
      isOpen,
      lastChangedAt: changedAt,
    };
    if (actorId) {
      data.lastChangedById = actorId;
    }
    await tx.valve.updateMany({
      where: { kebeleId },
      data,
    });
  }

  private parseWindowDate(
    value: DateInput,
    timezone: string,
    field: string,
  ): DateTime {
    let parsed: DateTime;
    if (value instanceof Date) {
      parsed = DateTime.fromJSDate(value, { zone: 'utc' }).setZone(timezone);
    } else {
      const text = value.trim();
      const hasOffset = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(text);
      parsed = hasOffset
        ? DateTime.fromISO(text, { setZone: true })
        : DateTime.fromISO(text, { zone: timezone });
      parsed = parsed.setZone(timezone);
    }

    if (!parsed.isValid) {
      throw new BadRequestException(`${field} must be a valid date-time`);
    }

    return parsed;
  }

  private parseOptionalNumber(value: unknown, field: string): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException(`${field} must be a number`);
    }
    if (parsed < 0) {
      throw new BadRequestException(`${field} cannot be negative`);
    }
    if (parsed > maximumPressureBar) {
      throw new BadRequestException(
        `${field} cannot exceed ${maximumPressureBar}`,
      );
    }
    if (Number(parsed.toFixed(3)) !== parsed) {
      throw new BadRequestException(
        `${field} must have no more than 3 decimal places`,
      );
    }
    return parsed;
  }

  private async updateScheduleWithVersion(
    tx: Prisma.TransactionClient,
    id: string,
    expectedUpdatedAt: Date,
    data: Prisma.RotationScheduleUncheckedUpdateInput,
  ): Promise<void> {
    const result = await tx.rotationSchedule.updateMany({
      where: {
        id,
        updatedAt: expectedUpdatedAt,
      },
      data: {
        ...data,
        updatedAt: data.updatedAt ?? new Date(),
      },
    });
    this.assertUpdatedCount(result.count);
  }

  private assertVersion(actual: Date, expected: Date): void {
    const actualTime = actual.getTime();
    if (!Number.isFinite(actualTime) || actualTime !== expected.getTime()) {
      throw new ConflictException(
        'Schedule or window was updated by another user',
      );
    }
  }

  private assertUpdatedCount(count: number): void {
    if (count !== 1) {
      throw new ConflictException('Resource was updated by another user');
    }
  }

  private parseVersion(value: VersionInput): Date {
    const candidate =
      typeof value === 'string' || value instanceof Date
        ? value
        : value.updatedAt;
    if (candidate === null || candidate === undefined || candidate === '') {
      throw new BadRequestException('updatedAt must be a valid date-time');
    }
    const parsed =
      candidate instanceof Date
        ? new Date(candidate.getTime())
        : new Date(candidate);
    if (!Number.isFinite(parsed.getTime())) {
      throw new BadRequestException('updatedAt must be a valid date-time');
    }
    return parsed;
  }

  private requireActorId(actorId: string): void {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user is required');
    }
  }

  private isPublicStatus(status: ScheduleStatus): boolean {
    return publicScheduleStatuses.some((candidate) => candidate === status);
  }

  private canManage(role: UserRole | undefined): boolean {
    return role === UserRole.DISPATCHER || role === UserRole.ADMIN;
  }

  private canReadStatus(status: ScheduleStatus, role: RoleInput): boolean {
    return (
      this.canManage(this.resolveRole(role)) ||
      status === ScheduleStatus.PUBLISHED ||
      status === ScheduleStatus.ACTIVE
    );
  }

  private isPublicOnly(role: RoleInput): boolean {
    return (
      typeof role === 'object' &&
      role !== null &&
      !(role instanceof Date) &&
      'publicOnly' in role &&
      role.publicOnly === true
    );
  }

  private resolveRole(role: RoleInput): UserRole | undefined {
    if (typeof role === 'string') {
      return role;
    }
    if (role && 'role' in role) {
      return role.role;
    }
    return role?.user?.role;
  }

  private getTimezone(): string {
    const configured = this.configService.get<string>('appTimezone');
    return configured?.trim() || defaultTimezone;
  }

  private toPublicSchedule(
    schedule: PublicScheduleDetails,
  ): PublicScheduleDetails {
    return {
      id: schedule.id,
      kebeleId: schedule.kebeleId,
      name: schedule.name,
      startsOn: schedule.startsOn,
      endsOn: schedule.endsOn,
      status: schedule.status,
      notes: schedule.notes,
      kebele: {
        id: schedule.kebele.id,
        name: schedule.kebele.name,
        code: schedule.kebele.code,
      },
      windows: schedule.windows.map((window) => ({
        id: window.id,
        standpipeId: window.standpipeId,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        status: window.status,
        minimumPressureBar: window.minimumPressureBar,
        maximumPressureBar: window.maximumPressureBar,
        openedAt: window.openedAt,
        closedAt: window.closedAt,
        notes: window.notes,
        standpipe: window.standpipe
          ? {
              id: window.standpipe.id,
              code: window.standpipe.code,
              name: window.standpipe.name,
            }
          : null,
      })),
    };
  }

  private async findScheduleDetails(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<ScheduleDetails> {
    const schedule = await tx.rotationSchedule.findUnique({
      where: { id },
      include: scheduleDetailsInclude,
    });
    if (!schedule) {
      throw new NotFoundException('Rotation schedule not found');
    }
    return schedule;
  }

  private async findWindowDetails(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<WindowDetails> {
    const window = await tx.rotationWindow.findUnique({
      where: { id },
      include: windowDetailsInclude,
    });
    if (!window) {
      throw new NotFoundException('Rotation window not found');
    }
    return window;
  }

  private async writeScheduleOutboxEvent(
    tx: Prisma.TransactionClient,
    schedule: ScheduleWithWindows,
    status: ScheduleStatus,
    reason: string | null,
    actorId: string | undefined,
    changedAt: Date,
  ): Promise<void> {
    let eventType: string;
    switch (status) {
      case ScheduleStatus.PUBLISHED:
        eventType = SCHEDULE_OUTBOX_EVENT_TYPES.published;
        break;
      case ScheduleStatus.ACTIVE:
        eventType = SCHEDULE_OUTBOX_EVENT_TYPES.activated;
        break;
      case ScheduleStatus.COMPLETED:
        eventType = SCHEDULE_OUTBOX_EVENT_TYPES.completed;
        break;
      case ScheduleStatus.CANCELLED:
        eventType = SCHEDULE_OUTBOX_EVENT_TYPES.cancelled;
        break;
      default:
        throw new Error(`Unsupported schedule transition status: ${status}`);
    }

    await tx.outboxEvent.create({
      data: {
        aggregateType: scheduleAggregateType,
        aggregateId: schedule.id,
        eventType,
        payload: {
          scheduleId: schedule.id,
          kebeleId: schedule.kebeleId,
          status,
          windowCount: schedule.windows.length,
          reason: reason ?? null,
          actorId: actorId ?? null,
          changedAt: changedAt.toISOString(),
        },
      },
    });
  }

  private async writeWindowOutboxEvent(
    tx: Prisma.TransactionClient,
    window: RotationWindowModel & {
      rotationSchedule: RotationScheduleModel;
    },
    status: WindowStatus,
    changedAt: Date,
    reason: string | null,
    actorId: string | undefined,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        aggregateType: windowAggregateType,
        aggregateId: window.id,
        eventType:
          status === WindowStatus.OPENED
            ? SCHEDULE_OUTBOX_EVENT_TYPES.windowOpened
            : SCHEDULE_OUTBOX_EVENT_TYPES.windowClosed,
        payload: {
          scheduleId: window.rotationScheduleId,
          windowId: window.id,
          standpipeId: window.standpipeId,
          status,
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
          changedAt: changedAt.toISOString(),
          reason: reason ?? null,
          actorId: actorId ?? null,
        },
      },
    });
  }
}
