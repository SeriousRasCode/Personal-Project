import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../../../database/prisma.service.js';
import { UserStatus, WindowStatus } from '../../../generated/prisma/enums.js';
import { normalizePhone } from '../../../common/auth/phone.util.js';
import { getApplicationTimezone } from '../../geography/date-only.js';
import type { UssdCallbackDto, UssdSessionQueryDto } from '../dto/ussd.dto.js';
import type {
  UssdCallbackResponseDto,
  UssdSessionResponseDto,
} from '../dto/ussd-response.dto.js';
import {
  USSD_HELP_STEP,
  USSD_MAIN_STEP,
  USSD_SCHEDULE_STEP,
  USSD_STANDPIPES_STEP,
  USSD_UNREGISTERED_STEP,
  goodbyeMessage,
  helpMessage,
  invalidInputMessage,
  mainMenuMessage,
  navigate,
  scheduleMessage,
  standpipesMessage,
  unregisteredMessage,
  type UssdStandpipeLine,
  type UssdWindowLine,
} from './ussd-session.js';

export const USSD_SESSION_TTL_SECONDS = 300;

@Injectable()
export class UssdService {
  private readonly logger = new Logger(UssdService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async handleCallback(dto: UssdCallbackDto): Promise<UssdCallbackResponseDto> {
    const phone = normalizePhone(dto.phone);
    const now = new Date();
    const session = await this.activeSession(dto.sessionKey, phone, now);

    if (session === null) {
      return {
        sessionKey: dto.sessionKey,
        phone,
        step: USSD_MAIN_STEP,
        message: mainMenuMessage(),
        ended: false,
      };
    }

    const navigation = navigate(session.menuPath, dto.input ?? '');

    if (navigation.done) {
      await this.closeSession(session.id, USSD_MAIN_STEP, now);
      return {
        sessionKey: session.sessionKey,
        phone,
        step: USSD_MAIN_STEP,
        message: goodbyeMessage(),
        ended: true,
      };
    }

    if (navigation.invalid) {
      await this.persistStep(session.id, session.menuPath, now);

      return {
        sessionKey: session.sessionKey,
        phone,
        step: session.menuPath,
        message: invalidInputMessage(),
        ended: false,
      };
    }

    const context = await this.loadContext(phone);
    const step = this.resolveStep(navigation, context.registered);
    const message = this.renderStep(step, context);

    await this.persistStep(session.id, step, now);

    return {
      sessionKey: session.sessionKey,
      phone,
      step,
      message,
      ended: false,
    };
  }

  async listSessions(
    query: UssdSessionQueryDto,
  ): Promise<{ items: UssdSessionResponseDto[]; total: number }> {
    const now = new Date();
    const rows = await this.prisma.ussdSession.findMany({
      where: {
        ...(query.phone !== undefined ? { phone: query.phone } : {}),
        ...(query.activeOnly ? { expiresAt: { gt: now } } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: query.skip,
      take: query.take,
    });

    const total = await this.prisma.ussdSession.count({
      where: {
        ...(query.phone !== undefined ? { phone: query.phone } : {}),
        ...(query.activeOnly ? { expiresAt: { gt: now } } : {}),
      },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        sessionKey: row.sessionKey,
        phone: row.phone,
        menuPath: row.menuPath,
        expiresAt: row.expiresAt.toISOString(),
        active: row.expiresAt > now,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
    };
  }

  private async activeSession(
    sessionKey: string,
    phone: string,
    now: Date,
  ): Promise<{ id: string; sessionKey: string; menuPath: string } | null> {
    const existing = await this.prisma.ussdSession.findUnique({
      where: { sessionKey },
      select: {
        id: true,
        sessionKey: true,
        menuPath: true,
        phone: true,
        expiresAt: true,
      },
    });

    if (existing && existing.phone === phone && existing.expiresAt > now) {
      return existing;
    }

    const expiresAt = new Date(
      now.getTime() + USSD_SESSION_TTL_SECONDS * 1_000,
    );

    if (existing) {
      const refreshed = await this.prisma.ussdSession.updateMany({
        where: {
          id: existing.id,
          OR: [{ expiresAt: { lte: now } }, { phone }],
        },
        data: { phone, menuPath: USSD_MAIN_STEP, expiresAt },
      });

      if (refreshed.count === 1) {
        return { id: existing.id, sessionKey, menuPath: USSD_MAIN_STEP };
      }
    }

    const created = await this.prisma.ussdSession.upsert({
      where: { sessionKey },
      create: { sessionKey, phone, menuPath: USSD_MAIN_STEP, expiresAt },
      update: { phone, menuPath: USSD_MAIN_STEP, expiresAt },
      select: { id: true, sessionKey: true, menuPath: true },
    });

    return created;
  }

  private async closeSession(
    id: string,
    menuPath: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.ussdSession.updateMany({
      where: { id },
      data: { menuPath, expiresAt: new Date(now.getTime() - 1_000) },
    });
  }

  private async persistStep(
    id: string,
    step: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.ussdSession.updateMany({
      where: { id },
      data: {
        menuPath: step,
        expiresAt: new Date(now.getTime() + USSD_SESSION_TTL_SECONDS * 1_000),
      },
    });
  }

  private resolveStep(
    navigation: { step: string; invalid: boolean },
    registered: boolean,
  ): string {
    if (registered) {
      return navigation.step;
    }
    if (
      navigation.step === USSD_STANDPIPES_STEP ||
      navigation.step === USSD_SCHEDULE_STEP
    ) {
      return USSD_UNREGISTERED_STEP;
    }
    return navigation.step;
  }

  private renderStep(
    step: string,
    context: {
      registered: boolean;
      standpipes: UssdStandpipeLine[];
      windows: UssdWindowLine[];
    },
  ): string {
    switch (step) {
      case USSD_STANDPIPES_STEP:
        return standpipesMessage(context.standpipes);
      case USSD_SCHEDULE_STEP:
        return scheduleMessage(context.windows);
      case USSD_HELP_STEP:
        return helpMessage();
      case USSD_UNREGISTERED_STEP:
        return unregisteredMessage();
      default:
        return mainMenuMessage();
    }
  }

  private async loadContext(phone: string): Promise<{
    registered: boolean;
    standpipes: UssdStandpipeLine[];
    windows: UssdWindowLine[];
  }> {
    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: {
        id: true,
        status: true,
        operatorProfile: { select: { id: true } },
        citizenProfile: { select: { kebeleId: true } },
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      return { registered: false, standpipes: [], windows: [] };
    }

    const kebeles = await this.resolveKebeles(user);

    if (kebeles.length === 0) {
      return {
        registered: true,
        standpipes: [],
        windows: [],
      };
    }

    const [standpipes, windows] = await Promise.all([
      this.loadStandpipes(kebeles),
      this.loadWindows(kebeles),
    ]);

    return { registered: true, standpipes, windows };
  }

  private async resolveKebeles(user: {
    operatorProfile: { id: string } | null;
    citizenProfile: { kebeleId: string | null } | null;
  }): Promise<string[]> {
    if (user.operatorProfile) {
      const standpipes = await this.prisma.standpipe.findMany({
        where: { operatorProfileId: user.operatorProfile.id },
        select: { kebeleId: true },
        distinct: ['kebeleId'],
      });
      return standpipes.map((row) => row.kebeleId);
    }

    return user.citizenProfile?.kebeleId ? [user.citizenProfile.kebeleId] : [];
  }

  private async loadStandpipes(
    kebeleIds: string[],
  ): Promise<UssdStandpipeLine[]> {
    const rows = await this.prisma.standpipe.findMany({
      where: { kebeleId: { in: kebeleIds }, isActive: true },
      select: {
        code: true,
        name: true,
        kebele: { select: { name: true } },
        tapConsensus: { select: { status: true } },
      },
      orderBy: { code: 'asc' },
      take: 10,
    });

    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      kebele: row.kebele.name,
      status: row.tapConsensus?.status ?? 'UNKNOWN',
    }));
  }

  private async loadWindows(kebeleIds: string[]): Promise<UssdWindowLine[]> {
    const timezone = getApplicationTimezone(this.configService);
    const today = DateTime.now().setZone(timezone).toISODate();

    if (today === null) {
      return [];
    }

    const startOfDay = DateTime.fromISO(today, { zone: timezone }).startOf(
      'day',
    );
    const endOfDay = startOfDay.endOf('day');

    const windows = await this.prisma.rotationWindow.findMany({
      where: {
        rotationSchedule: {
          kebeleId: { in: kebeleIds },
          startsOn: { lte: endOfDay.toJSDate() },
          endsOn: { gte: startOfDay.toJSDate() },
        },
        startsAt: { lte: endOfDay.toJSDate() },
        endsAt: { gte: startOfDay.toJSDate() },
      },
      select: {
        startsAt: true,
        endsAt: true,
        status: true,
        standpipe: { select: { code: true } },
        rotationSchedule: { select: { status: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 6,
    });

    const active = new Set<WindowStatus>([
      WindowStatus.SCHEDULED,
      WindowStatus.OPENED,
      WindowStatus.CLOSED,
    ]);

    return windows
      .filter((window) => active.has(window.status))
      .map((window) => ({
        standpipeCode: window.standpipe?.code ?? '-',
        timeRange: `${formatTime(window.startsAt, timezone)}-${formatTime(window.endsAt, timezone)}`,
        status: window.status,
      }));
  }
}

function formatTime(value: Date, timezone: string): string {
  return DateTime.fromJSDate(value, { zone: 'utc' })
    .setZone(timezone)
    .toFormat('HH:mm');
}
