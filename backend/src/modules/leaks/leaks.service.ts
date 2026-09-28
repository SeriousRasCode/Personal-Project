import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { resolveObservedAt } from '../../common/dates.js';
import { paginated, type PageResult } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  LeakSeverity,
  LeakStatus,
  ReportSource,
  UserRole,
} from '../../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import {
  assertLeakStatusTransition,
  clampConfidence,
  isWithinClusterRadius,
  LEAK_CONFIDENCE_FLOOR,
  mergeIntoCluster,
  seedCluster,
  severityConfidenceCeiling,
  type ClusterMatch,
  type ClusterThresholds,
} from './leak-clustering.js';
import {
  CreateLeakReportDto,
  ListLeakClustersQueryDto,
  ListLeakReportsQueryDto,
  ListPublicLeakClustersQueryDto,
  UpdateLeakStatusDto,
} from './dto/leak.dto.js';
import {
  LeakClusterDetailResponseDto,
  LeakClusterResponseDto,
  LeakReportCreatedResponseDto,
  LeakReportResponseDto,
  PublicLeakClusterListResponseDto,
  PublicLeakClusterResponseDto,
} from './dto/leak-response.dto.js';
import {
  parseJsonValue,
  queryOne,
  queryRows,
  RawRow,
  toDate,
  toNullableDate,
  toNullableNumber,
  toNumber,
  toStringValue,
  whereSql,
} from '../geography/raw.js';
import { assertPoint, pointSql } from '../geography/geometry.js';

export const LEAK_OUTBOX_EVENT_TYPES = {
  leakReported: 'leak.reported',
  leakStatusChanged: 'leak.status_changed',
} as const;

export const LEAK_CONFIDENCE_CEILING: Record<UserRole, number> = {
  [UserRole.CITIZEN]: 0.6,
  [UserRole.STANDPIPE_OPERATOR]: 0.8,
  [UserRole.FIELD_TECHNICIAN]: 0.8,
  [UserRole.DISPATCHER]: 1,
  [UserRole.ADMIN]: 1,
};

const SYSTEM_CONFIDENCE_CEILING = 1;

const LEAK_REPORT_SELECT = Prisma.sql`
  SELECT
    r.id,
    r.reported_by_id AS "reportedById",
    r.cluster_id AS "clusterId",
    c.kebele_id AS "kebeleId",
    c.neighborhood_id AS "neighborhoodId",
    ST_X(r.location) AS "longitude",
    ST_Y(r.location) AS "latitude",
    ST_AsGeoJSON(r.location)::json AS "geoJson",
    r.description,
    r.photo_object_key AS "photoObjectKey",
    r.severity,
    r.status,
    r.source,
    r.confidence,
    r.observed_at AS "observedAt",
    r.resolved_at AS "resolvedAt",
    r.created_at AS "createdAt"
  FROM leak_reports r
  LEFT JOIN leak_clusters c ON c.id = r.cluster_id
`;

const LEAK_CLUSTER_SELECT = Prisma.sql`
  SELECT
    c.id,
    c.code,
    c.kebele_id AS "kebeleId",
    k.code AS "kebeleCode",
    c.neighborhood_id AS "neighborhoodId",
    CASE WHEN c.centroid IS NULL THEN NULL ELSE ST_X(c.centroid) END AS "centroidLongitude",
    CASE WHEN c.centroid IS NULL THEN NULL ELSE ST_Y(c.centroid) END AS "centroidLatitude",
    CASE WHEN c.centroid IS NULL THEN NULL ELSE ST_AsGeoJSON(c.centroid)::json END AS "centroidGeoJson",
    c.radius_meters AS "radiusMeters",
    c.severity,
    c.status,
    c.report_count AS "reportCount",
    c.confidence,
    c.first_reported_at AS "firstReportedAt",
    c.last_reported_at AS "lastReportedAt",
    c.created_at AS "createdAt",
    c.updated_at AS "updatedAt"
  FROM leak_clusters c
  JOIN kebeles k ON k.id = c.kebele_id
`;

export interface LeakActor {
  id: string;
  role: UserRole;
}

function toNullableGeoJson(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const parsed = parseJsonValue(value, 'centroidGeoJson');
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function resolveLeakConfidence(
  role: UserRole | null,
  severity: LeakSeverity,
  requested: number,
): number {
  const roleCeiling =
    role === null
      ? SYSTEM_CONFIDENCE_CEILING
      : (LEAK_CONFIDENCE_CEILING[role] ?? SYSTEM_CONFIDENCE_CEILING);
  const ceiling = Math.min(roleCeiling, severityConfidenceCeiling(severity));
  const safeRequested = Number.isFinite(requested)
    ? requested
    : LEAK_CONFIDENCE_FLOOR;
  return clampConfidence(Math.min(safeRequested, ceiling));
}

@Injectable()
export class LeaksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private thresholds(): ClusterThresholds {
    return {
      radiusMeters: this.configService.getOrThrow<number>(
        'leaks.clusterRadiusMeters',
      ),
      maxRadiusMeters: this.configService.getOrThrow<number>(
        'leaks.clusterMaxRadiusMeters',
      ),
      confidenceBase: this.configService.getOrThrow<number>(
        'leaks.clusterConfidenceBase',
      ),
      confidenceStep: this.configService.getOrThrow<number>(
        'leaks.clusterConfidenceStep',
      ),
    };
  }

  private inTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  private async resolveGeography(point: unknown): Promise<{
    kebeleId: string;
    neighborhoodId: string | null;
  }> {
    const location = pointSql(point, 'location');

    const containing = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT k.id, k.code
        FROM kebeles k
        WHERE k.is_active = TRUE
          AND k.boundary IS NOT NULL
          AND ST_Contains(k.boundary, ${location})
        ORDER BY ST_Area(k.boundary) ASC
        LIMIT 1
      `,
    );

    if (containing) {
      const kebeleId = toStringValue(containing['id'], 'kebeleId');
      const neighborhood = await queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          SELECT n.id
          FROM neighborhoods n
          WHERE n.is_active = TRUE
            AND n.kebele_id = ${kebeleId}
            AND n.boundary IS NOT NULL
            AND ST_Contains(n.boundary, ${location})
          LIMIT 1
        `,
      );

      return {
        kebeleId,
        neighborhoodId:
          neighborhood === null
            ? null
            : toStringValue(neighborhood['id'], 'neighborhoodId'),
      };
    }

    const nearest = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT k.id
        FROM kebeles k
        WHERE k.is_active = TRUE AND k.center IS NOT NULL
        ORDER BY ST_Distance(k.center::geography, ${location}::geography) ASC
        LIMIT 1
      `,
    );

    if (!nearest) {
      throw new BadRequestException(
        'No active kebele covers the reported location',
      );
    }

    return {
      kebeleId: toStringValue(nearest['id'], 'kebeleId'),
      neighborhoodId: null,
    };
  }

  private async findNearbyCluster(
    location: Prisma.Sql,
  ): Promise<ClusterMatch | null> {
    const thresholds = this.thresholds();
    const rows = await queryRows<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT
          c.id,
          c.severity,
          c.report_count AS "reportCount",
          c.confidence,
          c.radius_meters AS "radiusMeters",
          ST_Distance(c.centroid::geography, ${location}::geography) AS "distanceMeters"
        FROM leak_clusters c
        WHERE c.centroid IS NOT NULL
          AND c.status NOT IN (${LeakStatus.RESOLVED}::"LeakStatus", ${LeakStatus.REJECTED}::"LeakStatus")
        ORDER BY ST_Distance(c.centroid::geography, ${location}::geography) ASC
        LIMIT 1
      `,
    );

    const candidate = rows[0];
    if (!candidate) {
      return null;
    }

    const match: ClusterMatch = {
      id: toStringValue(candidate['id'], 'clusterId'),
      severity: toStringValue(
        candidate['severity'],
        'severity',
      ) as LeakSeverity,
      reportCount: toNumber(candidate['reportCount'], 'reportCount'),
      confidence: toNumber(candidate['confidence'], 'confidence'),
      radiusMeters: toNullableNumber(candidate['radiusMeters']),
      distanceMeters: toNumber(candidate['distanceMeters'], 'distanceMeters'),
    };

    return isWithinClusterRadius(match, thresholds) ? match : null;
  }

  async createLeakReport(
    dto: CreateLeakReportDto,
    actor: LeakActor | null,
    now: Date = new Date(),
  ): Promise<LeakReportCreatedResponseDto> {
    const point = assertPoint(dto.location, 'location');
    const observedAt = resolveObservedAt(dto.observedAt, now);
    const confidence = resolveLeakConfidence(
      actor?.role ?? null,
      dto.severity,
      dto.confidence,
    );
    const geography = await this.resolveGeography(point);
    const location = pointSql(point, 'location');
    const thresholds = this.thresholds();
    const match = await this.findNearbyCluster(location);

    const { reportId, clusterId } = await this.inTransaction(async (tx) => {
      const executor = tx;

      let clusterId: string;
      let attachedToExistingCluster: boolean;
      let clusterCode: string | null = null;

      if (match) {
        const merged = mergeIntoCluster(match, dto.severity, thresholds);
        await executor.$executeRaw(Prisma.sql`
          UPDATE leak_clusters
          SET severity = ${merged.severity}::"LeakSeverity",
              report_count = ${merged.reportCount},
              confidence = ${merged.confidence},
              radius_meters = ${merged.radiusMeters},
              last_reported_at = ${observedAt},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${match.id}
        `);
        clusterId = match.id;
        attachedToExistingCluster = true;
      } else {
        const seeded = seedCluster(dto.severity, thresholds);
        clusterId = randomUUID();
        clusterCode = `LEAK-${clusterId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
        await executor.$executeRaw(Prisma.sql`
          INSERT INTO leak_clusters (
            id, kebele_id, neighborhood_id, code, centroid, radius_meters,
            severity, status, report_count, confidence,
            first_reported_at, last_reported_at, created_at, updated_at
          )
          VALUES (
            ${clusterId},
            ${geography.kebeleId},
            ${geography.neighborhoodId},
            ${clusterCode},
            ${location},
            ${seeded.radiusMeters},
            ${seeded.severity}::"LeakSeverity",
            ${LeakStatus.OPEN}::"LeakStatus",
            ${seeded.reportCount},
            ${seeded.confidence},
            ${observedAt},
            ${observedAt},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `);
        attachedToExistingCluster = false;
      }

      const reportId = randomUUID();
      await executor.$executeRaw(Prisma.sql`
        INSERT INTO leak_reports (
          id, reported_by_id, cluster_id, location, description,
          photo_object_key, severity, status, source, confidence,
          observed_at, created_at, updated_at
        )
        VALUES (
          ${reportId},
          ${actor?.id ?? null},
          ${clusterId},
          ${location},
          ${dto.description.trim()},
          ${dto.photoObjectKey ?? null},
          ${dto.severity}::"LeakSeverity",
          ${LeakStatus.OPEN}::"LeakStatus",
          ${dto.source}::"ReportSource",
            ${confidence},
          ${observedAt},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `);

      await executor.outboxEvent.create({
        data: {
          aggregateType: 'LeakCluster',
          aggregateId: clusterId,
          eventType: LEAK_OUTBOX_EVENT_TYPES.leakReported,
          payload: {
            reportId,
            clusterId,
            clusterCode,
            reporterId: actor?.id ?? null,
            actorId: actor?.id ?? null,
            kebeleId: geography.kebeleId,
            severity: dto.severity,
            source: dto.source,
            attachedToExistingCluster,
            observedAt: observedAt.toISOString(),
          },
        },
      });

      return {
        reportId,
        clusterId,
      };
    });

    return {
      report: await this.findLeakReportById(reportId),
      cluster: await this.findClusterById(clusterId),
      attachedToExistingCluster: match !== null,
    };
  }

  async findLeakReportById(id: string): Promise<LeakReportResponseDto> {
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${LEAK_REPORT_SELECT} WHERE r.id = ${id}`,
    );
    if (!row) {
      throw new BadRequestException('Leak report not found');
    }
    return this.mapLeakReport(row);
  }

  async findClusterById(id: string): Promise<LeakClusterResponseDto> {
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${LEAK_CLUSTER_SELECT} WHERE c.id = ${id}`,
    );
    if (!row) {
      throw new BadRequestException('Leak cluster not found');
    }
    return this.mapLeakCluster(row);
  }

  async getClusterDetail(id: string): Promise<LeakClusterDetailResponseDto> {
    const cluster = await this.findClusterById(id);
    const rows = await queryRows<RawRow>(
      this.prisma,
      Prisma.sql`
        ${LEAK_REPORT_SELECT}
        WHERE r.cluster_id = ${id}
        ORDER BY r.observed_at DESC, r.created_at DESC
      `,
    );

    return {
      cluster,
      reports: rows.map((row) => this.mapLeakReport(row)),
    };
  }

  async listLeakReports(
    query: ListLeakReportsQueryDto,
  ): Promise<PageResult<LeakReportResponseDto>> {
    const conditions: Prisma.Sql[] = [];
    if (query.status !== undefined) {
      conditions.push(Prisma.sql`r.status = ${query.status}::"LeakStatus"`);
    }
    if (query.severity !== undefined) {
      conditions.push(
        Prisma.sql`r.severity = ${query.severity}::"LeakSeverity"`,
      );
    }
    if (query.source !== undefined) {
      conditions.push(Prisma.sql`r.source = ${query.source}::"ReportSource"`);
    }
    if (query.clusterId !== undefined) {
      conditions.push(Prisma.sql`r.cluster_id = ${query.clusterId}`);
    }
    if (query.kebeleId !== undefined) {
      conditions.push(Prisma.sql`c.kebele_id = ${query.kebeleId}`);
    }

    const filter = whereSql(conditions);

    const [rows, totalRow] = await Promise.all([
      queryRows<RawRow>(
        this.prisma,
        Prisma.sql`
          ${LEAK_REPORT_SELECT}
          WHERE ${filter}
          ORDER BY r.observed_at DESC, r.created_at DESC
          LIMIT ${query.take} OFFSET ${query.skip}
        `,
      ),
      queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          SELECT COUNT(*)::int AS total
          FROM leak_reports r
          LEFT JOIN leak_clusters c ON c.id = r.cluster_id
          WHERE ${filter}
        `,
      ),
    ]);

    return paginated(
      rows.map((row) => this.mapLeakReport(row)),
      this.mapCount(totalRow),
      query,
    );
  }

  async listLeakClusters(
    query: ListLeakClustersQueryDto,
  ): Promise<PageResult<LeakClusterResponseDto>> {
    const conditions: Prisma.Sql[] = [];
    if (query.status !== undefined) {
      conditions.push(Prisma.sql`c.status = ${query.status}::"LeakStatus"`);
    }
    if (query.severity !== undefined) {
      conditions.push(
        Prisma.sql`c.severity = ${query.severity}::"LeakSeverity"`,
      );
    }
    if (query.kebeleId !== undefined) {
      conditions.push(Prisma.sql`c.kebele_id = ${query.kebeleId}`);
    }
    if (query.neighborhoodId !== undefined) {
      conditions.push(Prisma.sql`c.neighborhood_id = ${query.neighborhoodId}`);
    }

    const filter = whereSql(conditions);

    const [rows, totalRow] = await Promise.all([
      queryRows<RawRow>(
        this.prisma,
        Prisma.sql`
          ${LEAK_CLUSTER_SELECT}
          WHERE ${filter}
          ORDER BY
            CASE c.severity
              WHEN 'CRITICAL'::"LeakSeverity" THEN 0
              WHEN 'HIGH'::"LeakSeverity" THEN 1
              WHEN 'MEDIUM'::"LeakSeverity" THEN 2
              ELSE 3
            END ASC,
            c.last_reported_at DESC
          LIMIT ${query.take} OFFSET ${query.skip}
        `,
      ),
      queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          SELECT COUNT(*)::int AS total
          FROM leak_clusters c
          WHERE ${filter}
        `,
      ),
    ]);

    return paginated(
      rows.map((row) => this.mapLeakCluster(row)),
      this.mapCount(totalRow),
      query,
    );
  }

  async listActiveLeakClusters(
    query: ListPublicLeakClustersQueryDto,
  ): Promise<PublicLeakClusterListResponseDto> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`c.status NOT IN (${LeakStatus.RESOLVED}::"LeakStatus", ${LeakStatus.REJECTED}::"LeakStatus")`,
      Prisma.sql`k.is_active = TRUE`,
    ];
    if (query.kebeleId !== undefined) {
      conditions.push(Prisma.sql`c.kebele_id = ${query.kebeleId}`);
    }

    const rows = await queryRows<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT
          c.id,
          c.code,
          k.code AS "kebeleCode",
          CASE WHEN c.centroid IS NULL THEN NULL ELSE ST_X(c.centroid) END AS "centroidLongitude",
          CASE WHEN c.centroid IS NULL THEN NULL ELSE ST_Y(c.centroid) END AS "centroidLatitude",
          c.severity,
          c.status,
          c.report_count AS "reportCount",
          c.confidence,
          c.last_reported_at AS "lastReportedAt"
        FROM leak_clusters c
        JOIN kebeles k ON k.id = c.kebele_id
        WHERE ${whereSql(conditions)}
        ORDER BY
          CASE c.severity
            WHEN 'CRITICAL'::"LeakSeverity" THEN 0
            WHEN 'HIGH'::"LeakSeverity" THEN 1
            WHEN 'MEDIUM'::"LeakSeverity" THEN 2
            ELSE 3
          END ASC,
          c.last_reported_at DESC
      `,
    );

    return {
      items: rows.map((row) => this.mapPublicCluster(row)),
    };
  }

  async updateClusterStatus(
    clusterId: string,
    dto: UpdateLeakStatusDto,
    actor: LeakActor,
    now: Date = new Date(),
  ): Promise<LeakClusterResponseDto> {
    const existing = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`SELECT status, report_count AS "reportCount" FROM leak_clusters WHERE id = ${clusterId}`,
    );
    if (!existing) {
      throw new BadRequestException('Leak cluster not found');
    }

    const currentStatus = toStringValue(
      existing['status'],
      'status',
    ) as LeakStatus;
    assertLeakStatusTransition(currentStatus, dto.status);

    const resolvedAt = dto.status === LeakStatus.RESOLVED ? now : undefined;

    const reporters = await queryRows<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT DISTINCT r.reported_by_id AS "reporterId"
        FROM leak_reports r
        WHERE r.cluster_id = ${clusterId}
          AND r.reported_by_id IS NOT NULL
      `,
    );

    const reporterIds = reporters.map((row) =>
      toStringValue(row['reporterId'], 'reporterId'),
    );

    await this.inTransaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE leak_clusters
        SET status = ${dto.status}::"LeakStatus", updated_at = CURRENT_TIMESTAMP
        WHERE id = ${clusterId}
      `);

      if (resolvedAt !== undefined) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE leak_reports
          SET status = ${LeakStatus.RESOLVED}::"LeakStatus",
              resolved_at = ${resolvedAt},
              updated_at = CURRENT_TIMESTAMP
          WHERE cluster_id = ${clusterId}
            AND status NOT IN (${LeakStatus.RESOLVED}::"LeakStatus", ${LeakStatus.REJECTED}::"LeakStatus")
        `);
      }

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'LeakCluster',
          aggregateId: clusterId,
          eventType: LEAK_OUTBOX_EVENT_TYPES.leakStatusChanged,
          payload: {
            clusterId,
            from: currentStatus,
            to: dto.status,
            note: dto.note ?? null,
            actorId: actor.id,
            reporterId: reporterIds[0] ?? null,
            reporterIds,
          },
        },
      });
    });

    await this.audit.record(
      {
        action: 'leak.status_changed',
        entityType: 'LeakCluster',
        entityId: clusterId,
        metadata: {
          from: currentStatus,
          to: dto.status,
          note: dto.note ?? null,
        },
      },
      actor,
    );

    return this.findClusterById(clusterId);
  }

  private mapCount(row: RawRow | null): number {
    return row === null ? 0 : toNumber(row['total'], 'total');
  }

  private mapLeakReport(row: RawRow): LeakReportResponseDto {
    return {
      id: toStringValue(row['id'], 'id'),
      reportedById:
        row['reportedById'] === null
          ? null
          : toStringValue(row['reportedById'], 'reportedById'),
      clusterId:
        row['clusterId'] === null
          ? null
          : toStringValue(row['clusterId'], 'clusterId'),
      kebeleId: toStringValue(row['kebeleId'], 'kebeleId'),
      neighborhoodId:
        row['neighborhoodId'] === null
          ? null
          : toStringValue(row['neighborhoodId'], 'neighborhoodId'),
      location: {
        longitude: toNumber(row['longitude'], 'longitude'),
        latitude: toNumber(row['latitude'], 'latitude'),
      },
      description: toStringValue(row['description'], 'description'),
      photoObjectKey:
        row['photoObjectKey'] === null
          ? null
          : toStringValue(row['photoObjectKey'], 'photoObjectKey'),
      severity: toStringValue(row['severity'], 'severity') as LeakSeverity,
      status: toStringValue(row['status'], 'status') as LeakStatus,
      source: toStringValue(row['source'], 'source') as ReportSource,
      confidence: toNumber(row['confidence'], 'confidence'),
      observedAt: toDate(row['observedAt'], 'observedAt'),
      resolvedAt: toNullableDate(row['resolvedAt'], 'resolvedAt'),
      createdAt: toDate(row['createdAt'], 'createdAt'),
    };
  }

  private mapLeakCluster(row: RawRow): LeakClusterResponseDto {
    return {
      id: toStringValue(row['id'], 'id'),
      code: toStringValue(row['code'], 'code'),
      kebeleId: toStringValue(row['kebeleId'], 'kebeleId'),
      kebeleCode: toStringValue(row['kebeleCode'], 'kebeleCode'),
      neighborhoodId:
        row['neighborhoodId'] === null
          ? null
          : toStringValue(row['neighborhoodId'], 'neighborhoodId'),
      centroidLongitude: toNullableNumber(row['centroidLongitude']),
      centroidLatitude: toNullableNumber(row['centroidLatitude']),
      centroidGeoJson: toNullableGeoJson(row['centroidGeoJson']),
      radiusMeters: toNullableNumber(row['radiusMeters']),
      severity: toStringValue(row['severity'], 'severity') as LeakSeverity,
      status: toStringValue(row['status'], 'status') as LeakStatus,
      reportCount: toNumber(row['reportCount'], 'reportCount'),
      confidence: toNumber(row['confidence'], 'confidence'),
      firstReportedAt: toDate(row['firstReportedAt'], 'firstReportedAt'),
      lastReportedAt: toDate(row['lastReportedAt'], 'lastReportedAt'),
      createdAt: toDate(row['createdAt'], 'createdAt'),
      updatedAt: toDate(row['updatedAt'], 'updatedAt'),
    };
  }

  private mapPublicCluster(row: RawRow): PublicLeakClusterResponseDto {
    return {
      id: toStringValue(row['id'], 'id'),
      code: toStringValue(row['code'], 'code'),
      kebeleCode: toStringValue(row['kebeleCode'], 'kebeleCode'),
      centroidLongitude: toNullableNumber(row['centroidLongitude']),
      centroidLatitude: toNullableNumber(row['centroidLatitude']),
      severity: toStringValue(row['severity'], 'severity') as LeakSeverity,
      status: toStringValue(row['status'], 'status') as LeakStatus,
      reportCount: toNumber(row['reportCount'], 'reportCount'),
      confidence: toNumber(row['confidence'], 'confidence'),
      lastReportedAt: toDate(row['lastReportedAt'], 'lastReportedAt'),
    };
  }
}
