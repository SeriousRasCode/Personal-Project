import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { FlowStatus, QueueTrend } from '../../generated/prisma/enums.js';
import {
  queryOne,
  queryRows,
  RawRow,
  rowValue,
  toDate,
  toNullableDate,
  toNullableNumber,
  toNumber,
  toStringValue,
} from '../geography/raw.js';
import {
  calculateQueueSnapshot,
  type QueueObservation,
} from './queue-trend.js';
import { calculateTapConsensus, type TapObservation } from './tap-consensus.js';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface TapConsensusView {
  standpipeId: string;
  status: FlowStatus;
  confidence: number;
  sampleCount: number;
  fullFlowScore: number;
  trickleScore: number;
  dryScore: number;
  lastCalculatedAt: Date;
  lastObservedAt: Date | null;
}

export interface QueueSnapshotView {
  standpipeId: string;
  waitMinutes: number;
  queueSize: number | null;
  trend: QueueTrend;
  confidence: number;
  sampleCount: number;
  lastCalculatedAt: Date;
}

export interface KebeleConsensusView {
  standpipeId: string;
  code: string;
  name: string;
  locationLongitude: number | null;
  locationLatitude: number | null;
  tapStatus: FlowStatus;
  tapConfidence: number;
  tapSampleCount: number;
  tapLastObservedAt: Date | null;
  waitMinutes: number | null;
  queueSize: number | null;
  queueTrend: QueueTrend | null;
  queueConfidence: number | null;
  queueLastCalculatedAt: Date | null;
}

@Injectable()
export class ConsensusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private windowHours(): number {
    return this.config.get<number>('consensus.windowHours', 24);
  }

  private halfLifeHours(): number {
    return this.config.get<number>('consensus.halfLifeHours', 6);
  }

  private saturationWeight(): number {
    return this.config.get<number>('consensus.saturationWeight', 4);
  }

  private priorWeight(): number {
    return this.config.get<number>('consensus.priorWeight', 0.25);
  }

  private queueWindowHours(): number {
    return this.config.get<number>('consensus.queue.windowHours', 6);
  }

  private queueMinSamples(): number {
    return this.config.get<number>('consensus.queue.minSamples', 2);
  }

  private queueSaturationSamples(): number {
    return this.config.get<number>('consensus.queue.saturationSamples', 5);
  }

  private queueMinRelativeDelta(): number {
    return this.config.get<number>('consensus.queue.minRelativeDelta', 0.15);
  }

  private queueMinAbsoluteDeltaMinutes(): number {
    return this.config.get<number>(
      'consensus.queue.minAbsoluteDeltaMinutes',
      2,
    );
  }

  private queueSnapshotMinIntervalMinutes(): number {
    return this.config.get<number>(
      'consensus.queue.snapshotMinIntervalMinutes',
      15,
    );
  }

  private async loadTapObservations(
    standpipeId: string,
    now: Date,
  ): Promise<TapObservation[]> {
    const windowStart = new Date(now.getTime() - this.windowHours() * HOUR_MS);
    const rows = await queryRows<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT status, reliability_weight, observed_at
        FROM tap_status_reports
        WHERE standpipe_id = ${standpipeId}
          AND observed_at >= ${windowStart}
        ORDER BY observed_at DESC
      `,
    );

    return rows.map((row) => ({
      status: toStringValue(rowValue(row, 'status'), 'status') as FlowStatus,
      reliabilityWeight: toNumber(
        rowValue(row, 'reliability_weight'),
        'reliabilityWeight',
      ),
      observedAt: toDate(rowValue(row, 'observed_at'), 'observedAt'),
    }));
  }

  private async loadQueueObservations(
    standpipeId: string,
    now: Date,
  ): Promise<QueueObservation[]> {
    const windowHours = this.queueWindowHours();
    const windowStart = new Date(now.getTime() - windowHours * 2 * HOUR_MS);
    const rows = await queryRows<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT wait_minutes, queue_size, observed_at
        FROM queue_wait_reports
        WHERE standpipe_id = ${standpipeId}
          AND observed_at >= ${windowStart}
        ORDER BY observed_at DESC
      `,
    );

    return rows.map((row) => ({
      waitMinutes: toNumber(rowValue(row, 'wait_minutes'), 'waitMinutes'),
      queueSize: toNullableNumber(rowValue(row, 'queue_size')),
      observedAt: toDate(rowValue(row, 'observed_at'), 'observedAt'),
    }));
  }

  private mapTapConsensus(row: RawRow): TapConsensusView {
    return {
      standpipeId: toStringValue(
        rowValue(row, 'standpipe_id', 'standpipeId'),
        'standpipeId',
      ),
      status: toStringValue(rowValue(row, 'status'), 'status') as FlowStatus,
      confidence: toNumber(rowValue(row, 'confidence'), 'confidence'),
      sampleCount: toNumber(rowValue(row, 'sample_count'), 'sampleCount'),
      fullFlowScore: toNumber(
        rowValue(row, 'full_flow_score'),
        'fullFlowScore',
      ),
      trickleScore: toNumber(rowValue(row, 'trickle_score'), 'trickleScore'),
      dryScore: toNumber(rowValue(row, 'dry_score'), 'dryScore'),
      lastCalculatedAt: toDate(
        rowValue(row, 'last_calculated_at'),
        'lastCalculatedAt',
      ),
      lastObservedAt: toNullableDate(
        rowValue(row, 'last_observed_at'),
        'lastObservedAt',
      ),
    };
  }

  private mapQueueSnapshot(row: RawRow): QueueSnapshotView {
    return {
      standpipeId: toStringValue(
        rowValue(row, 'standpipe_id', 'standpipeId'),
        'standpipeId',
      ),
      waitMinutes: toNumber(rowValue(row, 'wait_minutes'), 'waitMinutes'),
      queueSize: toNullableNumber(rowValue(row, 'queue_size')),
      trend: toStringValue(rowValue(row, 'trend'), 'trend') as QueueTrend,
      confidence: toNumber(rowValue(row, 'confidence'), 'confidence'),
      sampleCount: toNumber(rowValue(row, 'sample_count'), 'sampleCount'),
      lastCalculatedAt: toDate(
        rowValue(row, 'last_calculated_at'),
        'lastCalculatedAt',
      ),
    };
  }

  async recalculateTapConsensus(
    standpipeId: string,
    now: Date = new Date(),
  ): Promise<TapConsensusView> {
    const observations = await this.loadTapObservations(standpipeId, now);
    const result = calculateTapConsensus(observations, {
      now,
      windowHours: this.windowHours(),
      halfLifeHours: this.halfLifeHours(),
      saturationWeight: this.saturationWeight(),
      priorWeight: this.priorWeight(),
    });

    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`
        INSERT INTO tap_consensus (
          id,
          standpipe_id,
          status,
          confidence,
          sample_count,
          full_flow_score,
          trickle_score,
          dry_score,
          last_calculated_at,
          last_observed_at,
          updated_at
        )
        VALUES (
          ${randomUUID()},
          ${standpipeId},
          CAST(${result.status} AS "FlowStatus"),
          ${result.confidence},
          ${result.sampleCount},
          ${result.fullFlowScore},
          ${result.trickleScore},
          ${result.dryScore},
          ${now},
          ${result.lastObservedAt},
          ${now}
        )
        ON CONFLICT (standpipe_id) DO UPDATE SET
          status = EXCLUDED.status,
          confidence = EXCLUDED.confidence,
          sample_count = EXCLUDED.sample_count,
          full_flow_score = EXCLUDED.full_flow_score,
          trickle_score = EXCLUDED.trickle_score,
          dry_score = EXCLUDED.dry_score,
          last_calculated_at = EXCLUDED.last_calculated_at,
          last_observed_at = EXCLUDED.last_observed_at,
          updated_at = EXCLUDED.updated_at
        RETURNING
          standpipe_id,
          status,
          confidence,
          sample_count,
          full_flow_score,
          trickle_score,
          dry_score,
          last_calculated_at,
          last_observed_at
      `,
    );

    if (!row) {
      throw new NotFoundException('Tap consensus could not be stored');
    }

    return this.mapTapConsensus(row);
  }

  async recalculateQueueSnapshot(
    standpipeId: string,
    now: Date = new Date(),
  ): Promise<QueueSnapshotView | null> {
    const observations = await this.loadQueueObservations(standpipeId, now);
    const computed = calculateQueueSnapshot(observations, {
      now,
      recentHours: this.queueWindowHours(),
      minSamples: this.queueMinSamples(),
      saturationSamples: this.queueSaturationSamples(),
      minRelativeDelta: this.queueMinRelativeDelta(),
      minAbsoluteDeltaMinutes: this.queueMinAbsoluteDeltaMinutes(),
    });

    const latest = await this.findQueueSnapshot(standpipeId);
    if (!computed) {
      return latest;
    }

    const minIntervalMs = this.queueSnapshotMinIntervalMinutes() * MINUTE_MS;
    if (
      latest &&
      now.getTime() - latest.lastCalculatedAt.getTime() < minIntervalMs
    ) {
      return latest;
    }

    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`
        INSERT INTO queue_snapshots (
          id,
          standpipe_id,
          wait_minutes,
          queue_size,
          trend,
          confidence,
          sample_count,
          last_calculated_at
        )
        VALUES (
          ${randomUUID()},
          ${standpipeId},
          ${computed.waitMinutes},
          ${computed.queueSize},
          CAST(${computed.trend} AS "QueueTrend"),
          ${computed.confidence},
          ${computed.sampleCount},
          ${now}
        )
        RETURNING
          standpipe_id,
          wait_minutes,
          queue_size,
          trend,
          confidence,
          sample_count,
          last_calculated_at
      `,
    );

    return row ? this.mapQueueSnapshot(row) : latest;
  }

  async findTapConsensus(
    standpipeId: string,
  ): Promise<TapConsensusView | null> {
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT
          standpipe_id,
          status,
          confidence,
          sample_count,
          full_flow_score,
          trickle_score,
          dry_score,
          last_calculated_at,
          last_observed_at
        FROM tap_consensus
        WHERE standpipe_id = ${standpipeId}
      `,
    );

    return row ? this.mapTapConsensus(row) : null;
  }

  async findQueueSnapshot(
    standpipeId: string,
  ): Promise<QueueSnapshotView | null> {
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT
          standpipe_id,
          wait_minutes,
          queue_size,
          trend,
          confidence,
          sample_count,
          last_calculated_at
        FROM queue_snapshots
        WHERE standpipe_id = ${standpipeId}
        ORDER BY last_calculated_at DESC
        LIMIT 1
      `,
    );

    return row ? this.mapQueueSnapshot(row) : null;
  }

  async standpipeExists(standpipeId: string): Promise<boolean> {
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT s.id
        FROM standpipes s
        WHERE s.id = ${standpipeId}
          AND s.is_active = TRUE
      `,
    );

    return row !== null;
  }

  async assertStandpipeExists(standpipeId: string): Promise<void> {
    if (!(await this.standpipeExists(standpipeId))) {
      throw new NotFoundException('Standpipe not found');
    }
  }

  async listKebeleConsensus(kebeleId: string): Promise<{
    items: KebeleConsensusView[];
  }> {
    const rows = await queryRows<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT
          s.id AS "standpipeId",
          s.code,
          s.name,
          CASE WHEN s.location IS NULL THEN NULL ELSE ST_X(s.location) END AS "locationLongitude",
          CASE WHEN s.location IS NULL THEN NULL ELSE ST_Y(s.location) END AS "locationLatitude",
          COALESCE(tc.status, CAST('UNKNOWN' AS "FlowStatus")) AS status,
          COALESCE(tc.confidence, 0) AS "tapConfidence",
          COALESCE(tc.sample_count, 0) AS "tapSampleCount",
          tc.last_observed_at AS "tapLastObservedAt",
          q.wait_minutes AS "waitMinutes",
          q.queue_size AS "queueSize",
          q.trend AS "queueTrend",
          q.confidence AS "queueConfidence",
          q.last_calculated_at AS "queueLastCalculatedAt"
        FROM standpipes s
        LEFT JOIN tap_consensus tc ON tc.standpipe_id = s.id
        LEFT JOIN LATERAL (
          SELECT
            qs.wait_minutes,
            qs.queue_size,
            qs.trend,
            qs.confidence,
            qs.last_calculated_at
          FROM queue_snapshots qs
          WHERE qs.standpipe_id = s.id
          ORDER BY qs.last_calculated_at DESC
          LIMIT 1
        ) q ON TRUE
        WHERE s.kebele_id = ${kebeleId}
          AND s.is_active = TRUE
        ORDER BY s.code ASC
      `,
    );

    return {
      items: rows.map((row) => ({
        standpipeId: toStringValue(rowValue(row, 'standpipeId'), 'standpipeId'),
        code: toStringValue(rowValue(row, 'code'), 'code'),
        name: toStringValue(rowValue(row, 'name'), 'name'),
        locationLongitude: toNullableNumber(rowValue(row, 'locationLongitude')),
        locationLatitude: toNullableNumber(rowValue(row, 'locationLatitude')),
        tapStatus: toStringValue(
          rowValue(row, 'status'),
          'status',
        ) as FlowStatus,
        tapConfidence: toNumber(
          rowValue(row, 'tapConfidence'),
          'tapConfidence',
        ),
        tapSampleCount: toNumber(
          rowValue(row, 'tapSampleCount'),
          'tapSampleCount',
        ),
        tapLastObservedAt: toNullableDate(
          rowValue(row, 'tapLastObservedAt'),
          'tapLastObservedAt',
        ),
        waitMinutes: toNullableNumber(rowValue(row, 'waitMinutes')),
        queueSize: toNullableNumber(rowValue(row, 'queueSize')),
        queueTrend: rowValue(row, 'queueTrend') as QueueTrend | null,
        queueConfidence: toNullableNumber(rowValue(row, 'queueConfidence')),
        queueLastCalculatedAt: toNullableDate(
          rowValue(row, 'queueLastCalculatedAt'),
          'queueLastCalculatedAt',
        ),
      })),
    };
  }
}
