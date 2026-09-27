import { BadRequestException, Injectable } from '@nestjs/common';
import { paginated, type PageResult } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { UserRole } from '../../generated/prisma/enums.js';
import type {
  QueueWaitReportModel,
  TapStatusReportModel,
} from '../../generated/prisma/models.js';
import {
  ConsensusService,
  QueueSnapshotView,
  TapConsensusView,
} from '../consensus/consensus.service.js';
import {
  CreateQueueWaitReportDto,
  CreateTapStatusReportDto,
  ListQueueReportsQueryDto,
  ListTapReportsQueryDto,
} from './dto/report.dto.js';
import {
  QueueWaitReportResponseDto,
  TapStatusReportResponseDto,
} from './dto/report-response.dto.js';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MAX_FUTURE_SKEW_MS = 5 * MINUTE_MS;
const MAX_BACKDATE_MS = 30 * DAY_MS;

export const REPORT_OUTBOX_EVENT_TYPES = {
  tapStatusReported: 'tap_status.reported',
  queueWaitReported: 'queue_wait.reported',
} as const;

export const RELIABILITY_CEILING: Record<UserRole, number> = {
  [UserRole.CITIZEN]: 1,
  [UserRole.STANDPIPE_OPERATOR]: 2,
  [UserRole.FIELD_TECHNICIAN]: 2,
  [UserRole.DISPATCHER]: 3,
  [UserRole.ADMIN]: 5,
};

export const SYSTEM_RELIABILITY_CEILING = 5;

export function resolveReliabilityWeight(
  role: UserRole | null,
  requested: number,
): number {
  const ceiling =
    role === null ? SYSTEM_RELIABILITY_CEILING : RELIABILITY_CEILING[role];
  const safeRequested = Number.isFinite(requested) ? requested : 1;
  return Math.min(Math.max(safeRequested, 0.1), ceiling);
}

export function resolveObservedAt(
  requested: Date | undefined,
  now: Date,
): Date {
  if (!requested) {
    return now;
  }
  const observedMs = requested.getTime();
  if (Number.isNaN(observedMs)) {
    throw new BadRequestException('observedAt is not a valid date');
  }
  if (observedMs > now.getTime() + MAX_FUTURE_SKEW_MS) {
    throw new BadRequestException('observedAt cannot be in the future');
  }
  if (observedMs < now.getTime() - MAX_BACKDATE_MS) {
    throw new BadRequestException('observedAt cannot be older than 30 days');
  }
  return new Date(observedMs);
}

export interface TapStatusReportCreated {
  report: TapStatusReportResponseDto;
  consensus: TapConsensusView;
}

export interface QueueWaitReportCreated {
  report: QueueWaitReportResponseDto;
  snapshot: QueueSnapshotView | null;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consensus: ConsensusService,
  ) {}

  private inTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  async createTapStatusReport(
    dto: CreateTapStatusReportDto,
    actor: { id: string; role: UserRole } | null,
    now: Date = new Date(),
  ): Promise<TapStatusReportCreated> {
    await this.consensus.assertStandpipeExists(dto.standpipeId);
    const observedAt = resolveObservedAt(dto.observedAt, now);
    const reliabilityWeight = resolveReliabilityWeight(
      actor?.role ?? null,
      dto.reliabilityWeight,
    );

    const report = await this.inTransaction(async (tx) => {
      const created = await tx.tapStatusReport.create({
        data: {
          standpipeId: dto.standpipeId,
          reportedById: actor?.id ?? null,
          status: dto.status,
          source: dto.source,
          reliabilityWeight,
          note: dto.note ?? null,
          observedAt,
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Standpipe',
          aggregateId: dto.standpipeId,
          eventType: REPORT_OUTBOX_EVENT_TYPES.tapStatusReported,
          payload: {
            reportId: created.id,
            standpipeId: dto.standpipeId,
            status: dto.status,
            source: dto.source,
            observedAt: observedAt.toISOString(),
          },
        },
      });

      return created;
    });

    const consensus = await this.consensus.recalculateTapConsensus(
      dto.standpipeId,
      now,
    );

    return {
      report: this.mapTapReport(report),
      consensus,
    };
  }

  async createQueueWaitReport(
    dto: CreateQueueWaitReportDto,
    actor: { id: string; role: UserRole } | null,
    now: Date = new Date(),
  ): Promise<QueueWaitReportCreated> {
    await this.consensus.assertStandpipeExists(dto.standpipeId);
    const observedAt = resolveObservedAt(dto.observedAt, now);
    const reliabilityWeight = resolveReliabilityWeight(
      actor?.role ?? null,
      dto.reliabilityWeight,
    );

    const report = await this.inTransaction(async (tx) => {
      const created = await tx.queueWaitReport.create({
        data: {
          standpipeId: dto.standpipeId,
          reportedById: actor?.id ?? null,
          waitMinutes: dto.waitMinutes,
          queueSize: dto.queueSize ?? null,
          source: dto.source,
          reliabilityWeight,
          observedAt,
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Standpipe',
          aggregateId: dto.standpipeId,
          eventType: REPORT_OUTBOX_EVENT_TYPES.queueWaitReported,
          payload: {
            reportId: created.id,
            standpipeId: dto.standpipeId,
            waitMinutes: dto.waitMinutes,
            queueSize: dto.queueSize ?? null,
            source: dto.source,
            observedAt: observedAt.toISOString(),
          },
        },
      });

      return created;
    });

    const snapshot = await this.consensus.recalculateQueueSnapshot(
      dto.standpipeId,
      now,
    );

    return {
      report: this.mapQueueReport(report),
      snapshot,
    };
  }

  async listTapReports(
    query: ListTapReportsQueryDto,
  ): Promise<PageResult<TapStatusReportResponseDto>> {
    const where: Prisma.TapStatusReportWhereInput = {
      standpipeId: query.standpipeId,
    };
    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.source !== undefined) {
      where.source = query.source;
    }

    const [rows, total] = await Promise.all([
      this.prisma.tapStatusReport.findMany({
        where,
        orderBy: { observedAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.tapStatusReport.count({ where }),
    ]);

    return paginated(
      rows.map((row) => this.mapTapReport(row)),
      total,
      query,
    );
  }

  async listQueueReports(
    query: ListQueueReportsQueryDto,
  ): Promise<PageResult<QueueWaitReportResponseDto>> {
    const where: Prisma.QueueWaitReportWhereInput = {
      standpipeId: query.standpipeId,
    };
    if (query.source !== undefined) {
      where.source = query.source;
    }

    const [rows, total] = await Promise.all([
      this.prisma.queueWaitReport.findMany({
        where,
        orderBy: { observedAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.queueWaitReport.count({ where }),
    ]);

    return paginated(
      rows.map((row) => this.mapQueueReport(row)),
      total,
      query,
    );
  }

  private mapTapReport(row: TapStatusReportModel): TapStatusReportResponseDto {
    return {
      id: row.id,
      standpipeId: row.standpipeId,
      reportedById: row.reportedById,
      status: row.status,
      source: row.source,
      reliabilityWeight: Number(row.reliabilityWeight),
      note: row.note,
      observedAt: row.observedAt,
      createdAt: row.createdAt,
    };
  }

  private mapQueueReport(
    row: QueueWaitReportModel,
  ): QueueWaitReportResponseDto {
    return {
      id: row.id,
      standpipeId: row.standpipeId,
      reportedById: row.reportedById,
      waitMinutes: row.waitMinutes,
      queueSize: row.queueSize,
      source: row.source,
      reliabilityWeight: Number(row.reliabilityWeight),
      observedAt: row.observedAt,
      createdAt: row.createdAt,
    };
  }
}
