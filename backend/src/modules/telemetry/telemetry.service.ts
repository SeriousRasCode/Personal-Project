import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PageResult, paginated } from '../../common/dto/pagination.dto.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  SensorStatus,
  SensorType,
  TelemetrySource,
  UserRole,
} from '../../generated/prisma/enums.js';
import { assertPoint, pointSql } from '../geography/geometry.js';
import {
  queryOne,
  queryRows,
  RawRow,
  rowValue,
  runInTransaction,
  toDate,
  toNullableDate,
  toNullableNumber,
  toNumber,
  toStringValue,
  whereSql,
} from '../geography/raw.js';
import { AuditService } from '../audit/audit.service.js';
import {
  assertWindowMinutes,
  roundToThree,
  windowRange,
} from './pressure-aggregate.js';
import {
  BatchReadingsDto,
  CreateSensorDto,
  ListAggregatesQueryDto,
  ListReadingsQueryDto,
  ListSensorsQueryDto,
  PressureStatsQueryDto,
  RebuildAggregatesDto,
  RecordReadingDto,
  UpdateSensorDto,
} from './dto/telemetry.dto.js';
import {
  PressureAggregateResponseDto,
  PressureReadingResponseDto,
  PressureStatsResponseDto,
  RebuildAggregatesResultDto,
  RecordReadingResultDto,
  SensorResponseDto,
} from './dto/telemetry-response.dto.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const READ_ROLES = [
  UserRole.ADMIN,
  UserRole.DISPATCHER,
  UserRole.FIELD_TECHNICIAN,
] as const;

const WRITE_ROLES = [UserRole.ADMIN, UserRole.DISPATCHER] as const;

const INGEST_ROLES = [
  UserRole.ADMIN,
  UserRole.DISPATCHER,
  UserRole.FIELD_TECHNICIAN,
] as const;

const ADMIN_ONLY_SOURCES: readonly TelemetrySource[] = [
  TelemetrySource.SENSOR,
  TelemetrySource.CSV_IMPORT,
  TelemetrySource.SIMULATOR,
];

const DEFAULT_LOW_PRESSURE_BAR = 1.5;
const MAX_METADATA_KEYS = 40;

const SENSOR_SELECT = Prisma.sql`
  SELECT
    s.id,
    s.standpipe_id AS "standpipeId",
    s.external_id AS "externalId",
    s.name,
    s.type,
    s.status,
    CASE WHEN s.location IS NULL THEN NULL ELSE ST_X(s.location) END AS "locationLongitude",
    CASE WHEN s.location IS NULL THEN NULL ELSE ST_Y(s.location) END AS "locationLatitude",
    s.metadata,
    s.last_seen_at AS "lastSeenAt",
    s.created_at AS "createdAt",
    s.updated_at AS "updatedAt"
  FROM telemetry_sensors s
`;

const READING_SELECT = Prisma.sql`
  SELECT
    r.id,
    r.sensor_id AS "sensorId",
    r.pressure_bar AS "pressureBar",
    r.flow_liters_per_second AS "flowLitersPerSecond",
    CASE WHEN r.location IS NULL THEN NULL ELSE ST_X(r.location) END AS "locationLongitude",
    CASE WHEN r.location IS NULL THEN NULL ELSE ST_Y(r.location) END AS "locationLatitude",
    r.source,
    r.external_id AS "externalId",
    r.observed_at AS "observedAt",
    r.received_at AS "receivedAt",
    r.created_by_id AS "createdById"
  FROM pressure_readings r
`;

const AGGREGATE_SELECT = Prisma.sql`
  SELECT
    a.id,
    a.sensor_id AS "sensorId",
    a.window_start AS "windowStart",
    a.window_end AS "windowEnd",
    a.average_pressure_bar AS "averagePressureBar",
    a.minimum_pressure_bar AS "minimumPressureBar",
    a.maximum_pressure_bar AS "maximumPressureBar",
    a.sample_count AS "sampleCount",
    CASE WHEN a.cell IS NULL THEN NULL ELSE ST_X(a.cell) END AS "cellLongitude",
    CASE WHEN a.cell IS NULL THEN NULL ELSE ST_Y(a.cell) END AS "cellLatitude"
  FROM pressure_aggregates a
`;

interface PreparedReading {
  id: string;
  sensorId: string | null;
  pressureBar: number;
  flowLitersPerSecond: number | null;
  observedAt: Date;
  source: TelemetrySource;
  externalId: string | null;
  location: { longitude: number; latitude: number } | null;
}

function assertId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BadRequestException(`${fieldName} must be a valid UUID`);
  }
  return value;
}

function optionalId(
  value: unknown,
  fieldName: string,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  return assertId(value, fieldName);
}

function textInput(value: unknown, fieldName: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${fieldName} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new BadRequestException(`${fieldName} is required`);
  }
  if (normalized.length > maximum) {
    throw new BadRequestException(
      `${fieldName} must be at most ${maximum} characters`,
    );
  }
  return normalized;
}

function optionalTextInput(
  value: unknown,
  fieldName: string,
  maximum: number,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return textInput(value, fieldName, maximum);
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  throw new InternalServerErrorException('Expected a text column');
}

function parseTimestamp(value: unknown, fieldName: string): Date {
  if (value === null || value === undefined || value === '') {
    throw new BadRequestException(`${fieldName} is required`);
  }
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(
          typeof value === 'string' || typeof value === 'number'
            ? value
            : (() => {
                throw new BadRequestException(
                  `${fieldName} must be a valid date`,
                );
              })(),
        );
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid date`);
  }
  return date;
}

function optionalTimestamp(
  value: unknown,
  fieldName: string,
): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  return parseTimestamp(value, fieldName);
}

function normalizeMetadata(
  value: unknown,
  fieldName: string,
): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${fieldName} must be an object`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_METADATA_KEYS) {
    throw new BadRequestException(
      `${fieldName} must have at most ${MAX_METADATA_KEYS} keys`,
    );
  }
  for (const [key, entry] of entries) {
    if (key.length === 0 || key.length > 60) {
      throw new BadRequestException(
        `${fieldName} keys must be between 1 and 60 characters`,
      );
    }
    const kind = typeof entry;
    if (
      entry !== null &&
      kind !== 'string' &&
      kind !== 'number' &&
      kind !== 'boolean'
    ) {
      throw new BadRequestException(
        `${fieldName}.${key} must be a string, number, boolean or null`,
      );
    }
  }
  return value as Record<string, unknown>;
}

function decimalInput(
  value: unknown,
  fieldName: string,
  minimum: number,
  maximum: number,
): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new BadRequestException(`${fieldName} must be finite`);
  }
  if (numberValue < minimum || numberValue > maximum) {
    throw new BadRequestException(
      `${fieldName} must be between ${minimum} and ${maximum}`,
    );
  }
  if (
    Math.abs(numberValue * 1_000 - Math.round(numberValue * 1_000)) >
    Number.EPSILON * Math.max(1, Math.abs(numberValue * 1_000))
  ) {
    throw new BadRequestException(
      `${fieldName} must have at most three decimals`,
    );
  }
  return numberValue;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    meta?: { driverAdapterError?: { kind?: unknown } };
  };
  if (candidate.code === 'P2002' || candidate.code === '23505') {
    return true;
  }
  const kind = candidate.meta?.driverAdapterError?.kind;
  if (typeof kind === 'string' && kind.toLowerCase().includes('unique')) {
    return true;
  }
  return (
    typeof candidate.message === 'string' && candidate.message.includes('23505')
  );
}

@Injectable()
export class TelemetryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  private lowPressureThreshold(): number {
    const configured = Number(
      this.configService.get<string>('TELEMETRY_LOW_PRESSURE_BAR') ??
        DEFAULT_LOW_PRESSURE_BAR,
    );
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_LOW_PRESSURE_BAR;
  }

  private assertRole(
    actor: AuthenticatedUser,
    allowed: readonly UserRole[],
    message: string,
  ): void {
    if (!allowed.includes(actor.role)) {
      throw new ForbiddenException(message);
    }
  }

  private assertSourceAllowed(
    source: TelemetrySource,
    actor: AuthenticatedUser,
  ): void {
    if (ADMIN_ONLY_SOURCES.includes(source) && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        `Only administrators can ingest ${source} readings`,
      );
    }
  }

  private count(row: RawRow | null): number {
    if (!row) {
      return 0;
    }
    const value = rowValue(row, 'total');
    return value === undefined || value === null ? 0 : Number(value);
  }

  private mapSensor(row: RawRow): SensorResponseDto {
    return {
      id: toStringValue(rowValue(row, 'id'), 'sensor id'),
      standpipeId: nullableString(rowValue(row, 'standpipeId')),
      externalId: nullableString(rowValue(row, 'externalId')),
      name: toStringValue(rowValue(row, 'name'), 'sensor name'),
      type: toStringValue(rowValue(row, 'type'), 'sensor type') as SensorType,
      status: toStringValue(
        rowValue(row, 'status'),
        'sensor status',
      ) as SensorStatus,
      locationLongitude: toNullableNumber(rowValue(row, 'locationLongitude')),
      locationLatitude: toNullableNumber(rowValue(row, 'locationLatitude')),
      metadata:
        (rowValue(row, 'metadata') as Record<string, unknown> | null) ?? null,
      lastSeenAt:
        toNullableDate(
          rowValue(row, 'lastSeenAt'),
          'lastSeenAt',
        )?.toISOString() ?? null,
      createdAt: toDate(rowValue(row, 'createdAt'), 'createdAt').toISOString(),
      updatedAt: toDate(rowValue(row, 'updatedAt'), 'updatedAt').toISOString(),
    };
  }

  private mapReading(row: RawRow): PressureReadingResponseDto {
    return {
      id: toStringValue(rowValue(row, 'id'), 'reading id'),
      sensorId: nullableString(rowValue(row, 'sensorId')),
      pressureBar: toNumber(rowValue(row, 'pressureBar'), 'pressureBar'),
      flowLitersPerSecond: toNullableNumber(
        rowValue(row, 'flowLitersPerSecond'),
      ),
      locationLongitude: toNullableNumber(rowValue(row, 'locationLongitude')),
      locationLatitude: toNullableNumber(rowValue(row, 'locationLatitude')),
      source: toStringValue(
        rowValue(row, 'source'),
        'reading source',
      ) as TelemetrySource,
      externalId: nullableString(rowValue(row, 'externalId')),
      observedAt: toDate(
        rowValue(row, 'observedAt'),
        'observedAt',
      ).toISOString(),
      receivedAt: toDate(
        rowValue(row, 'receivedAt'),
        'receivedAt',
      ).toISOString(),
      createdById: nullableString(rowValue(row, 'createdById')),
    };
  }

  private mapAggregate(row: RawRow): PressureAggregateResponseDto {
    return {
      id: toStringValue(rowValue(row, 'id'), 'aggregate id'),
      sensorId: nullableString(rowValue(row, 'sensorId')),
      windowStart: toDate(
        rowValue(row, 'windowStart'),
        'windowStart',
      ).toISOString(),
      windowEnd: toDate(rowValue(row, 'windowEnd'), 'windowEnd').toISOString(),
      averagePressureBar: toNumber(
        rowValue(row, 'averagePressureBar'),
        'averagePressureBar',
      ),
      minimumPressureBar: toNumber(
        rowValue(row, 'minimumPressureBar'),
        'minimumPressureBar',
      ),
      maximumPressureBar: toNumber(
        rowValue(row, 'maximumPressureBar'),
        'maximumPressureBar',
      ),
      sampleCount: toNumber(rowValue(row, 'sampleCount'), 'sampleCount'),
      cellLongitude: toNullableNumber(rowValue(row, 'cellLongitude')),
      cellLatitude: toNullableNumber(rowValue(row, 'cellLatitude')),
    };
  }

  async listSensors(
    query: ListSensorsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PageResult<SensorResponseDto>> {
    this.assertRole(actor, READ_ROLES, 'You cannot view telemetry sensors');
    const conditions: Prisma.Sql[] = [];
    if (query.standpipeId !== undefined) {
      conditions.push(Prisma.sql`s.standpipe_id = ${query.standpipeId}`);
    }
    if (query.type !== undefined) {
      conditions.push(Prisma.sql`s.type = ${query.type}::"SensorType"`);
    }
    if (query.status !== undefined) {
      conditions.push(Prisma.sql`s.status = ${query.status}::"SensorStatus"`);
    }
    if (query.kebeleId !== undefined) {
      conditions.push(Prisma.sql`sp.kebele_id = ${query.kebeleId}`);
    }
    const filter = whereSql(conditions);
    const [rows, totalRow] = await Promise.all([
      queryRows<RawRow>(
        this.prisma,
        Prisma.sql`
          ${SENSOR_SELECT}
          LEFT JOIN standpipes sp ON sp.id = s.standpipe_id
          WHERE ${filter}
          ORDER BY s.created_at DESC, s.id DESC
          LIMIT ${query.take} OFFSET ${query.skip}
        `,
      ),
      queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          SELECT COUNT(*)::int AS total
          FROM telemetry_sensors s
          LEFT JOIN standpipes sp ON sp.id = s.standpipe_id
          WHERE ${filter}
        `,
      ),
    ]);
    return paginated(
      rows.map((row) => this.mapSensor(row)),
      this.count(totalRow),
      query,
    );
  }

  async getSensor(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<SensorResponseDto> {
    this.assertRole(actor, READ_ROLES, 'You cannot view telemetry sensors');
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${SENSOR_SELECT} WHERE s.id = ${assertId(id, 'id')} LIMIT 1`,
    );
    if (!row) {
      throw new NotFoundException('Sensor was not found');
    }
    return this.mapSensor(row);
  }

  async createSensor(
    dto: CreateSensorDto,
    actor: AuthenticatedUser,
  ): Promise<SensorResponseDto> {
    this.assertRole(actor, WRITE_ROLES, 'You cannot manage telemetry sensors');
    const standpipeId = optionalId(dto.standpipeId, 'standpipeId') ?? null;
    const externalId =
      optionalTextInput(dto.externalId, 'externalId', 100) ?? null;
    const name = textInput(dto.name, 'name', 120);
    const location = dto.location ?? null;
    if (location !== null) {
      assertPoint(location, 'location');
    }
    const metadata = normalizeMetadata(dto.metadata, 'metadata') ?? null;
    if (standpipeId !== null) {
      await this.assertStandpipeExists(standpipeId);
    }
    const id = randomUUID();
    try {
      const inserted = await queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          INSERT INTO telemetry_sensors
            (id, standpipe_id, external_id, name, type, status, location, metadata,
             created_at, updated_at)
          VALUES
            (${id}, ${standpipeId}, ${externalId}, ${name},
             ${dto.type ?? SensorType.PRESSURE}::"SensorType",
             ${dto.status ?? SensorStatus.ACTIVE}::"SensorStatus",
             ${location === null ? Prisma.sql`NULL` : pointSql(location, 'location')},
             ${metadata === null ? Prisma.sql`NULL` : Prisma.sql`${JSON.stringify(metadata)}::jsonb`},
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id
        `,
      );
      if (!inserted) {
        throw new InternalServerErrorException('Sensor could not be created');
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('externalId is already registered');
      }
      throw error;
    }
    const created = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${SENSOR_SELECT} WHERE s.id = ${id} LIMIT 1`,
    );
    if (!created) {
      throw new InternalServerErrorException('Sensor could not be read');
    }
    await this.auditService.record(
      {
        action: 'telemetry.sensor_created',
        entityType: 'TelemetrySensor',
        entityId: id,
        metadata: { name, externalId, standpipeId },
      },
      actor,
    );
    return this.mapSensor(created);
  }

  async updateSensor(
    id: string,
    dto: UpdateSensorDto,
    actor: AuthenticatedUser,
  ): Promise<SensorResponseDto> {
    this.assertRole(actor, WRITE_ROLES, 'You cannot manage telemetry sensors');
    const sensorId = assertId(id, 'id');
    const expected = parseTimestamp(dto.expectedUpdatedAt, 'expectedUpdatedAt');
    const name = textInput(dto.name, 'name', 120);
    const metadata = normalizeMetadata(dto.metadata, 'metadata');
    const locationProvided = dto.location !== undefined;
    const location = dto.location ?? null;
    if (locationProvided && location !== null) {
      assertPoint(location, 'location');
    }
    const locationValue = !locationProvided
      ? Prisma.sql`telemetry_sensors.location`
      : location === null
        ? Prisma.sql`NULL`
        : pointSql(location, 'location');
    const metadataValue =
      metadata === undefined
        ? Prisma.sql`telemetry_sensors.metadata`
        : metadata === null
          ? Prisma.sql`NULL`
          : Prisma.sql`${JSON.stringify(metadata)}::jsonb`;
    let updated: RawRow | null;
    try {
      updated = await queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          UPDATE telemetry_sensors
          SET name = ${name},
              type = ${dto.type ?? SensorType.PRESSURE}::"SensorType",
              status = ${dto.status ?? SensorStatus.ACTIVE}::"SensorStatus",
              location = ${locationValue},
              metadata = ${metadataValue},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${sensorId} AND updated_at = ${expected}
          RETURNING id
        `,
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Sensor conflicts with another record');
      }
      throw error;
    }
    if (!updated) {
      const existing = await queryOne<RawRow>(
        this.prisma,
        Prisma.sql`SELECT id FROM telemetry_sensors WHERE id = ${sensorId} LIMIT 1`,
      );
      if (!existing) {
        throw new NotFoundException('Sensor was not found');
      }
      throw new ConflictException(
        'Sensor was modified by another request, reload and retry',
      );
    }
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${SENSOR_SELECT} WHERE s.id = ${sensorId} LIMIT 1`,
    );
    if (!row) {
      throw new InternalServerErrorException('Sensor could not be read');
    }
    await this.auditService.record(
      {
        action: 'telemetry.sensor_updated',
        entityType: 'TelemetrySensor',
        entityId: sensorId,
        metadata: { name, status: dto.status },
      },
      actor,
    );
    return this.mapSensor(row);
  }

  async recordReading(
    dto: RecordReadingDto,
    actor: AuthenticatedUser,
  ): Promise<RecordReadingResultDto> {
    this.assertRole(actor, INGEST_ROLES, 'You cannot ingest telemetry');
    this.assertSourceAllowed(dto.source, actor);
    return this.ingest([dto], actor);
  }

  async recordReadings(
    dto: BatchReadingsDto,
    actor: AuthenticatedUser,
  ): Promise<RecordReadingResultDto> {
    this.assertRole(actor, INGEST_ROLES, 'You cannot ingest telemetry');
    if (dto.readings.length === 0) {
      throw new BadRequestException(
        'readings must contain at least one reading',
      );
    }
    for (const reading of dto.readings) {
      this.assertSourceAllowed(reading.source, actor);
    }
    return this.ingest(dto.readings, actor);
  }

  private async ingest(
    readings: RecordReadingDto[],
    actor: AuthenticatedUser,
  ): Promise<RecordReadingResultDto> {
    const prepared: PreparedReading[] = readings.map((reading) => ({
      id: randomUUID(),
      sensorId: optionalId(reading.sensorId, 'sensorId') ?? null,
      pressureBar: decimalInput(
        reading.pressureBar,
        'pressureBar',
        0,
        9999.999,
      ),
      flowLitersPerSecond:
        reading.flowLitersPerSecond === undefined
          ? null
          : decimalInput(
              reading.flowLitersPerSecond,
              'flowLitersPerSecond',
              0,
              9_999_999.999,
            ),
      observedAt: parseTimestamp(reading.observedAt, 'observedAt'),
      source: reading.source,
      externalId:
        optionalTextInput(reading.externalId, 'externalId', 120) ?? null,
      location: reading.location
        ? (assertPoint(reading.location, 'location'), reading.location)
        : null,
    }));

    for (const reading of prepared) {
      if (reading.sensorId !== null) {
        await this.assertSensorExists(reading.sensorId);
      }
    }

    const accepted: PressureReadingResponseDto[] = [];
    let duplicates = 0;
    for (const reading of prepared) {
      const stored = await this.insertReading(reading, actor.id);
      if (stored === null) {
        duplicates += 1;
      } else {
        accepted.push(stored);
      }
    }
    return {
      created: accepted.length > 0,
      accepted: accepted.length,
      duplicates,
      readings: accepted,
    };
  }

  private async insertReading(
    reading: PreparedReading,
    actorId: string,
  ): Promise<PressureReadingResponseDto | null> {
    let inserted: RawRow | null;
    try {
      inserted = await queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          INSERT INTO pressure_readings
            (id, sensor_id, pressure_bar, flow_liters_per_second, location, source,
             external_id, observed_at, created_by_id)
          VALUES
            (${reading.id}, ${reading.sensorId}, ${reading.pressureBar},
             ${reading.flowLitersPerSecond},
             ${reading.location === null ? Prisma.sql`NULL` : pointSql(reading.location, 'location')},
             ${reading.source}::"TelemetrySource",
             ${reading.externalId}, ${reading.observedAt}, ${actorId})
          ON CONFLICT (external_id) DO NOTHING
          RETURNING id
        `,
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
    if (!inserted) {
      return null;
    }
    if (reading.sensorId !== null) {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE telemetry_sensors
        SET last_seen_at = GREATEST(
          COALESCE(last_seen_at, ${reading.observedAt}::timestamptz),
          ${reading.observedAt}::timestamptz
        )
        WHERE id = ${reading.sensorId}
      `);
    }
    const stored = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${READING_SELECT} WHERE r.id = ${reading.id} LIMIT 1`,
    );
    if (!stored) {
      throw new InternalServerErrorException('Reading could not be read');
    }
    return this.mapReading(stored);
  }

  async listReadings(
    query: ListReadingsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PageResult<PressureReadingResponseDto>> {
    this.assertRole(actor, READ_ROLES, 'You cannot view telemetry readings');
    const from = optionalTimestamp(query.from, 'from') ?? null;
    const to = optionalTimestamp(query.to, 'to') ?? null;
    if (from !== null && to !== null && from.getTime() > to.getTime()) {
      throw new BadRequestException('from must not be after to');
    }
    const conditions: Prisma.Sql[] = [];
    if (query.sensorId !== undefined) {
      conditions.push(Prisma.sql`r.sensor_id = ${query.sensorId}`);
    }
    if (query.standpipeId !== undefined) {
      conditions.push(Prisma.sql`ts.standpipe_id = ${query.standpipeId}`);
    }
    if (from !== null) {
      conditions.push(Prisma.sql`r.observed_at >= ${from}`);
    }
    if (to !== null) {
      conditions.push(Prisma.sql`r.observed_at <= ${to}`);
    }
    const filter = whereSql(conditions);
    const [rows, totalRow] = await Promise.all([
      queryRows<RawRow>(
        this.prisma,
        Prisma.sql`
          ${READING_SELECT}
          LEFT JOIN telemetry_sensors ts ON ts.id = r.sensor_id
          WHERE ${filter}
          ORDER BY r.observed_at DESC, r.id DESC
          LIMIT ${query.take} OFFSET ${query.skip}
        `,
      ),
      queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          SELECT COUNT(*)::int AS total
          FROM pressure_readings r
          LEFT JOIN telemetry_sensors ts ON ts.id = r.sensor_id
          WHERE ${filter}
        `,
      ),
    ]);
    return paginated(
      rows.map((row) => this.mapReading(row)),
      this.count(totalRow),
      query,
    );
  }

  async getPressureStats(
    query: PressureStatsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PressureStatsResponseDto> {
    this.assertRole(actor, READ_ROLES, 'You cannot view telemetry');
    const windowMinutes = assertWindowMinutes(query.windowMinutes ?? 1_440);
    const { windowStart, windowEnd } = windowRange(new Date(), windowMinutes);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`r.observed_at >= ${windowStart}`,
      Prisma.sql`r.observed_at < ${windowEnd}`,
    ];
    if (query.sensorId !== undefined) {
      conditions.push(Prisma.sql`r.sensor_id = ${query.sensorId}`);
    }
    if (query.standpipeId !== undefined) {
      conditions.push(Prisma.sql`ts.standpipe_id = ${query.standpipeId}`);
    }
    const threshold = this.lowPressureThreshold();
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`
        SELECT
          COUNT(*)::int AS "sampleCount",
          AVG(r.pressure_bar)::float8 AS "averagePressureBar",
          MIN(r.pressure_bar)::float8 AS "minimumPressureBar",
          MAX(r.pressure_bar)::float8 AS "maximumPressureBar",
          COUNT(*) FILTER (WHERE r.pressure_bar < ${threshold})::int AS "lowPressureSampleCount"
        FROM pressure_readings r
        LEFT JOIN telemetry_sensors ts ON ts.id = r.sensor_id
        WHERE ${whereSql(conditions)}
      `,
    );
    const sampleCount = row
      ? toNumber(rowValue(row, 'sampleCount'), 'sampleCount')
      : 0;
    const hasSamples = row !== null && sampleCount > 0;
    return {
      standpipeId: query.standpipeId ?? null,
      sensorId: query.sensorId ?? null,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      averagePressureBar: hasSamples
        ? roundToThree(
            toNumber(rowValue(row, 'averagePressureBar'), 'averagePressureBar'),
          )
        : null,
      minimumPressureBar: hasSamples
        ? roundToThree(
            toNumber(rowValue(row, 'minimumPressureBar'), 'minimumPressureBar'),
          )
        : null,
      maximumPressureBar: hasSamples
        ? roundToThree(
            toNumber(rowValue(row, 'maximumPressureBar'), 'maximumPressureBar'),
          )
        : null,
      sampleCount,
      lowPressureSampleCount: row
        ? toNumber(
            rowValue(row, 'lowPressureSampleCount'),
            'lowPressureSampleCount',
          )
        : 0,
      lowPressureThresholdBar: threshold,
    };
  }

  async listAggregates(
    query: ListAggregatesQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PageResult<PressureAggregateResponseDto>> {
    this.assertRole(actor, READ_ROLES, 'You cannot view telemetry aggregates');
    const conditions: Prisma.Sql[] = [];
    if (query.sensorId !== undefined) {
      conditions.push(Prisma.sql`a.sensor_id = ${query.sensorId}`);
    }
    if (query.standpipeId !== undefined) {
      conditions.push(Prisma.sql`ts.standpipe_id = ${query.standpipeId}`);
    }
    const filter = whereSql(conditions);
    const [rows, totalRow] = await Promise.all([
      queryRows<RawRow>(
        this.prisma,
        Prisma.sql`
          ${AGGREGATE_SELECT}
          LEFT JOIN telemetry_sensors ts ON ts.id = a.sensor_id
          WHERE ${filter}
          ORDER BY a.window_start DESC, a.id DESC
          LIMIT ${query.take} OFFSET ${query.skip}
        `,
      ),
      queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          SELECT COUNT(*)::int AS total
          FROM pressure_aggregates a
          LEFT JOIN telemetry_sensors ts ON ts.id = a.sensor_id
          WHERE ${filter}
        `,
      ),
    ]);
    return paginated(
      rows.map((row) => this.mapAggregate(row)),
      this.count(totalRow),
      query,
    );
  }

  async rebuildAggregates(
    dto: RebuildAggregatesDto,
    actor: AuthenticatedUser,
  ): Promise<RebuildAggregatesResultDto> {
    this.assertRole(
      actor,
      WRITE_ROLES,
      'You cannot rebuild telemetry aggregates',
    );
    const windowMinutes = assertWindowMinutes(dto.windowMinutes ?? 60);
    const { windowStart, windowEnd } = windowRange(new Date(), windowMinutes);
    const widthSeconds = windowMinutes * 60;
    const result = await runInTransaction(this.prisma, async (client) => {
      const buckets = await queryRows<RawRow>(
        client,
        Prisma.sql`
          WITH stamped AS (
            SELECT
              r.sensor_id AS "sensorId",
              r.pressure_bar AS "pressureBar",
              r.location AS location,
              to_timestamp(
                floor(extract(epoch FROM r.observed_at) / ${widthSeconds})
                * ${widthSeconds}
              ) AS "windowStart"
            FROM pressure_readings r
            WHERE r.observed_at >= ${windowStart} AND r.observed_at < ${windowEnd}
          ),
          grouped AS (
            SELECT
              s."sensorId",
              s."windowStart",
              AVG(s."pressureBar")::numeric(7,3) AS "averagePressureBar",
              MIN(s."pressureBar")::numeric(7,3) AS "minimumPressureBar",
              MAX(s."pressureBar")::numeric(7,3) AS "maximumPressureBar",
              COUNT(*)::int AS "sampleCount",
              CASE
                WHEN COUNT(*) FILTER (WHERE s.location IS NOT NULL) > 0
                  THEN ST_SetSRID(
                    ST_MakePoint(
                      AVG(ST_X(s.location)) FILTER (WHERE s.location IS NOT NULL),
                      AVG(ST_Y(s.location)) FILTER (WHERE s.location IS NOT NULL)
                    ),
                    4326
                  )
                ELSE NULL
              END AS cell
            FROM stamped s
            GROUP BY s."sensorId", s."windowStart"
          )
          INSERT INTO pressure_aggregates
            (id, sensor_id, window_start, window_end, average_pressure_bar,
             minimum_pressure_bar, maximum_pressure_bar, sample_count, cell,
             created_at)
          SELECT
            gen_random_uuid(), g."sensorId", g."windowStart",
            g."windowStart" + make_interval(mins => ${windowMinutes}),
            g."averagePressureBar", g."minimumPressureBar",
            g."maximumPressureBar", g."sampleCount", g.cell,
            CURRENT_TIMESTAMP
          FROM grouped g
          ON CONFLICT (sensor_id, window_start, window_end) DO UPDATE SET
            average_pressure_bar = EXCLUDED.average_pressure_bar,
            minimum_pressure_bar = EXCLUDED.minimum_pressure_bar,
            maximum_pressure_bar = EXCLUDED.maximum_pressure_bar,
            sample_count = EXCLUDED.sample_count,
            cell = EXCLUDED.cell
          RETURNING id
        `,
      );
      const scanned = await queryOne<RawRow>(
        client,
        Prisma.sql`
          SELECT COUNT(*)::int AS total
          FROM pressure_readings
          WHERE observed_at >= ${windowStart} AND observed_at < ${windowEnd}
        `,
      );
      return { buckets: buckets.length, scanned: this.count(scanned) };
    });
    await this.auditService.record(
      {
        action: 'telemetry.aggregates_rebuilt',
        entityType: 'PressureAggregate',
        metadata: {
          windowMinutes,
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          bucketsWritten: result.buckets,
        },
      },
      actor,
    );
    return {
      windowMinutes,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      bucketsWritten: result.buckets,
      readingsScanned: result.scanned,
    };
  }

  private async assertStandpipeExists(standpipeId: string): Promise<void> {
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`SELECT id FROM standpipes WHERE id = ${standpipeId} LIMIT 1`,
    );
    if (!row) {
      throw new BadRequestException(
        'standpipeId does not reference a Standpipe',
      );
    }
  }

  private async assertSensorExists(sensorId: string): Promise<void> {
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`SELECT id FROM telemetry_sensors WHERE id = ${sensorId} LIMIT 1`,
    );
    if (!row) {
      throw new BadRequestException('sensorId does not reference a Sensor');
    }
  }
}
