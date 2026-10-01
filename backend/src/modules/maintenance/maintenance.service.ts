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
import { UserRole } from '../../generated/prisma/enums.js';
import {
  getApplicationTimezone,
  parseDateOnly,
} from '../geography/date-only.js';
import {
  assertGeometry,
  geometrySql,
  pointSql,
} from '../geography/geometry.js';
import {
  queryOne,
  queryRows,
  RawRow,
  rowValue,
  runInTransaction,
  toBoolean,
  toDate,
  toNullableDate,
  toNullableNumber,
  toStringValue,
  whereSql,
} from '../geography/raw.js';
import { mapGeoJson, mapPoint } from '../geography/types.js';
import {
  PipelineQueryDto,
  ValveQueryDto,
} from '../geography/dto/common.dto.js';
import { AuditService } from '../audit/audit.service.js';
import {
  ChangeValveStateDto,
  CreatePipelineDto,
  CreateValveDto,
  UpdatePipelineDto,
  UpdateValveDto,
  ValveStateChangeResultDto,
} from './dto/maintenance.dto.js';
import {
  PipelineResponseDto,
  ValveResponseDto,
} from './dto/maintenance-response.dto.js';
import {
  assertStateChange,
  RepeatedValveStateError,
  valvePosition,
} from './valve-state.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const READ_ROLES = [
  UserRole.ADMIN,
  UserRole.DISPATCHER,
  UserRole.FIELD_TECHNICIAN,
] as const;

const REGISTRY_WRITE_ROLES = [UserRole.ADMIN, UserRole.DISPATCHER] as const;

const VALVE_OPERATOR_ROLES = [
  UserRole.ADMIN,
  UserRole.DISPATCHER,
  UserRole.FIELD_TECHNICIAN,
] as const;

const PIPELINE_SELECT = Prisma.sql`
  SELECT
    p.id,
    p.kebele_id AS "kebeleId",
    p.name,
    p.material,
    p.diameter_millimeters AS "diameterMillimeters",
    ST_AsGeoJSON(p.path)::json AS "pathGeoJson",
    p.installed_at AS "installedAt",
    p.is_active AS "isActive",
    p.created_at AS "createdAt",
    p.updated_at AS "updatedAt"
  FROM pipelines p
`;

const VALVE_SELECT = Prisma.sql`
  SELECT
    v.id,
    v.kebele_id AS "kebeleId",
    v.name,
    v.code,
    ST_X(v.location) AS "locationLongitude",
    ST_Y(v.location) AS "locationLatitude",
    v.is_open AS "isOpen",
    v.last_changed_at AS "lastChangedAt",
    v.last_changed_by_id AS "lastChangedById",
    v.created_at AS "createdAt",
    v.updated_at AS "updatedAt"
  FROM valves v
`;

function assertId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BadRequestException(`${fieldName} must be a valid UUID`);
  }
  return value;
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

function parseExpectedDate(
  dto: UpdatePipelineDto | UpdateValveDto | ChangeValveStateDto,
): Date {
  const value = dto.expectedUpdatedAt ?? dto.updatedAt;
  if (value === undefined || value === null || value === '') {
    throw new BadRequestException('expectedUpdatedAt is required for updates');
  }
  const expected = new Date(value);
  if (Number.isNaN(expected.getTime())) {
    throw new BadRequestException('expectedUpdatedAt must be a valid date');
  }
  if (
    dto.expectedUpdatedAt !== undefined &&
    dto.updatedAt !== undefined &&
    new Date(dto.updatedAt).getTime() !== expected.getTime()
  ) {
    throw new BadRequestException('updatedAt aliases must match');
  }
  return expected;
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
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  private timezone(): string {
    return getApplicationTimezone(this.configService);
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

  private count(row: RawRow | null): number {
    if (!row) {
      return 0;
    }
    const value = rowValue(row, 'total');
    return value === undefined || value === null ? 0 : Number(value);
  }

  private mapPipeline(row: RawRow): PipelineResponseDto {
    const path = mapGeoJson(row, 'path', 'LineString');
    if (!path) {
      throw new InternalServerErrorException('Pipeline path is missing');
    }
    return {
      id: toStringValue(rowValue(row, 'id'), 'pipeline id'),
      kebeleId: toStringValue(rowValue(row, 'kebeleId'), 'pipeline kebeleId'),
      name: toStringValue(rowValue(row, 'name'), 'pipeline name'),
      material: nullableString(rowValue(row, 'material')),
      diameterMillimeters: toNullableNumber(
        rowValue(row, 'diameterMillimeters'),
      ),
      path,
      installedAt:
        toNullableDate(
          rowValue(row, 'installedAt'),
          'installedAt',
        )?.toISOString() ?? null,
      isActive: toBoolean(rowValue(row, 'isActive')),
      createdAt: toDate(rowValue(row, 'createdAt'), 'createdAt').toISOString(),
      updatedAt: toDate(rowValue(row, 'updatedAt'), 'updatedAt').toISOString(),
    };
  }

  private mapValve(row: RawRow): ValveResponseDto {
    const location = mapPoint(row, 'location');
    if (!location) {
      throw new InternalServerErrorException('Valve location is missing');
    }
    const isOpen = toBoolean(rowValue(row, 'isOpen'));
    return {
      id: toStringValue(rowValue(row, 'id'), 'valve id'),
      kebeleId: toStringValue(rowValue(row, 'kebeleId'), 'valve kebeleId'),
      name: toStringValue(rowValue(row, 'name'), 'valve name'),
      code: toStringValue(rowValue(row, 'code'), 'valve code'),
      longitude: location.longitude,
      latitude: location.latitude,
      position: valvePosition(isOpen),
      isOpen,
      lastChangedAt:
        toNullableDate(
          rowValue(row, 'lastChangedAt'),
          'lastChangedAt',
        )?.toISOString() ?? null,
      lastChangedById: nullableString(rowValue(row, 'lastChangedById')),
      createdAt: toDate(rowValue(row, 'createdAt'), 'createdAt').toISOString(),
      updatedAt: toDate(rowValue(row, 'updatedAt'), 'updatedAt').toISOString(),
    };
  }

  async listPipelines(
    query: PipelineQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PageResult<PipelineResponseDto>> {
    this.assertRole(actor, READ_ROLES, 'You cannot view pipelines');
    const conditions: Prisma.Sql[] = [];
    if (query.kebeleId !== undefined) {
      conditions.push(Prisma.sql`p.kebele_id = ${query.kebeleId}`);
    }
    if (query.isActive !== undefined) {
      conditions.push(Prisma.sql`p.is_active = ${query.isActive}`);
    }
    if (query.search !== undefined) {
      conditions.push(Prisma.sql`p.name ILIKE ${`%${query.search}%`}`);
    }
    const filter = whereSql(conditions);
    const [rows, totalRow] = await Promise.all([
      queryRows<RawRow>(
        this.prisma,
        Prisma.sql`
          ${PIPELINE_SELECT}
          WHERE ${filter}
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT ${query.take} OFFSET ${query.skip}
        `,
      ),
      queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          SELECT COUNT(*)::int AS total FROM pipelines p WHERE ${filter}
        `,
      ),
    ]);
    return paginated(
      rows.map((row) => this.mapPipeline(row)),
      this.count(totalRow),
      query,
    );
  }

  async getPipeline(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PipelineResponseDto> {
    this.assertRole(actor, READ_ROLES, 'You cannot view pipelines');
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${PIPELINE_SELECT} WHERE p.id = ${assertId(id, 'id')} LIMIT 1`,
    );
    if (!row) {
      throw new NotFoundException('Pipeline was not found');
    }
    return this.mapPipeline(row);
  }

  async createPipeline(
    dto: CreatePipelineDto,
    actor: AuthenticatedUser,
  ): Promise<PipelineResponseDto> {
    this.assertRole(
      actor,
      REGISTRY_WRITE_ROLES,
      'You cannot manage the pipeline registry',
    );
    const kebeleId = assertId(dto.kebeleId, 'kebeleId');
    const name = textInput(dto.name, 'name', 120);
    const material = optionalTextInput(dto.material, 'material', 60) ?? null;
    const installedAt =
      dto.installedAt === undefined
        ? null
        : parseDateOnly(
            dto.installedAt,
            'installedAt',
            this.timezone(),
            undefined,
            true,
          );
    assertGeometry(dto.path, 'LineString', 'path');
    await this.assertKebeleExists(kebeleId);
    const id = randomUUID();
    const inserted = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`
        INSERT INTO pipelines
          (id, kebele_id, name, material, diameter_millimeters, path,
           installed_at, is_active, created_at, updated_at)
        VALUES
          (${id}, ${kebeleId}, ${name}, ${material},
           ${dto.diameterMillimeters ?? null}, ${geometrySql(dto.path, 'LineString', 'path')},
           ${installedAt}, ${dto.isActive ?? true},
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `,
    );
    if (!inserted) {
      throw new InternalServerErrorException('Pipeline could not be created');
    }
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${PIPELINE_SELECT} WHERE p.id = ${id} LIMIT 1`,
    );
    if (!row) {
      throw new InternalServerErrorException('Pipeline could not be read');
    }
    await this.auditService.record(
      {
        action: 'maintenance.pipeline_created',
        entityType: 'Pipeline',
        entityId: id,
        metadata: { name, kebeleId, material },
      },
      actor,
    );
    return this.mapPipeline(row);
  }

  async updatePipeline(
    id: string,
    dto: UpdatePipelineDto,
    actor: AuthenticatedUser,
  ): Promise<PipelineResponseDto> {
    this.assertRole(
      actor,
      REGISTRY_WRITE_ROLES,
      'You cannot manage the pipeline registry',
    );
    const pipelineId = assertId(id, 'id');
    const expected = parseExpectedDate(dto);
    const name = textInput(dto.name, 'name', 120);
    const material = optionalTextInput(dto.material, 'material', 60);
    const installedAt =
      dto.installedAt === undefined
        ? undefined
        : parseDateOnly(
            dto.installedAt,
            'installedAt',
            this.timezone(),
            undefined,
            true,
          );
    assertGeometry(dto.path, 'LineString', 'path');
    const updated = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`
        UPDATE pipelines
        SET name = ${name},
            material = CASE
              WHEN ${material === undefined} THEN pipelines.material
              ELSE ${material ?? null}
            END,
            diameter_millimeters = CASE
              WHEN ${dto.diameterMillimeters === undefined} THEN pipelines.diameter_millimeters
              ELSE ${dto.diameterMillimeters ?? null}
            END,
            path = ${geometrySql(dto.path, 'LineString', 'path')},
            installed_at = CASE
              WHEN ${installedAt === undefined} THEN pipelines.installed_at
              ELSE ${installedAt ?? null}
            END,
            is_active = COALESCE(${dto.isActive ?? null}, pipelines.is_active),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${pipelineId} AND updated_at = ${expected}
        RETURNING id
      `,
    );
    if (!updated) {
      await this.assertStillExists('pipelines', pipelineId, 'Pipeline');
      throw new ConflictException(
        'Pipeline was modified by another request, reload and retry',
      );
    }
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${PIPELINE_SELECT} WHERE p.id = ${pipelineId} LIMIT 1`,
    );
    if (!row) {
      throw new InternalServerErrorException('Pipeline could not be read');
    }
    await this.auditService.record(
      {
        action: 'maintenance.pipeline_updated',
        entityType: 'Pipeline',
        entityId: pipelineId,
        metadata: { name, isActive: dto.isActive },
      },
      actor,
    );
    return this.mapPipeline(row);
  }

  async listValves(
    query: ValveQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PageResult<ValveResponseDto>> {
    this.assertRole(actor, READ_ROLES, 'You cannot view valves');
    const conditions: Prisma.Sql[] = [];
    if (query.kebeleId !== undefined) {
      conditions.push(Prisma.sql`v.kebele_id = ${query.kebeleId}`);
    }
    if (query.isOpen !== undefined) {
      conditions.push(Prisma.sql`v.is_open = ${query.isOpen}`);
    }
    if (query.search !== undefined) {
      conditions.push(
        Prisma.sql`(v.name ILIKE ${`%${query.search}%`} OR v.code ILIKE ${`%${query.search}%`})`,
      );
    }
    const filter = whereSql(conditions);
    const [rows, totalRow] = await Promise.all([
      queryRows<RawRow>(
        this.prisma,
        Prisma.sql`
          ${VALVE_SELECT}
          WHERE ${filter}
          ORDER BY v.created_at DESC, v.id DESC
          LIMIT ${query.take} OFFSET ${query.skip}
        `,
      ),
      queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          SELECT COUNT(*)::int AS total FROM valves v WHERE ${filter}
        `,
      ),
    ]);
    return paginated(
      rows.map((row) => this.mapValve(row)),
      this.count(totalRow),
      query,
    );
  }

  async getValve(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<ValveResponseDto> {
    this.assertRole(actor, READ_ROLES, 'You cannot view valves');
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${VALVE_SELECT} WHERE v.id = ${assertId(id, 'id')} LIMIT 1`,
    );
    if (!row) {
      throw new NotFoundException('Valve was not found');
    }
    return this.mapValve(row);
  }

  async createValve(
    dto: CreateValveDto,
    actor: AuthenticatedUser,
  ): Promise<ValveResponseDto> {
    this.assertRole(
      actor,
      REGISTRY_WRITE_ROLES,
      'You cannot manage the valve registry',
    );
    const kebeleId = assertId(dto.kebeleId, 'kebeleId');
    const name = textInput(dto.name, 'name', 120);
    const code = textInput(dto.code, 'code', 40).toUpperCase();
    await this.assertKebeleExists(kebeleId);
    const id = randomUUID();
    try {
      const inserted = await queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          INSERT INTO valves
            (id, kebele_id, name, code, location, is_open, last_changed_at,
             last_changed_by_id, created_at, updated_at)
          VALUES
            (${id}, ${kebeleId}, ${name}, ${code},
             ${pointSql(dto.location, 'location')}, ${dto.isOpen ?? false},
             ${dto.isOpen ? Prisma.sql`CURRENT_TIMESTAMP` : Prisma.sql`NULL`},
             ${dto.isOpen ? actor.id : Prisma.sql`NULL`},
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id
        `,
      );
      if (!inserted) {
        throw new InternalServerErrorException('Valve could not be created');
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('code is already registered');
      }
      throw error;
    }
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${VALVE_SELECT} WHERE v.id = ${id} LIMIT 1`,
    );
    if (!row) {
      throw new InternalServerErrorException('Valve could not be read');
    }
    await this.auditService.record(
      {
        action: 'maintenance.valve_created',
        entityType: 'Valve',
        entityId: id,
        metadata: { name, code, kebeleId, isOpen: dto.isOpen ?? false },
      },
      actor,
    );
    return this.mapValve(row);
  }

  async updateValve(
    id: string,
    dto: UpdateValveDto,
    actor: AuthenticatedUser,
  ): Promise<ValveResponseDto> {
    this.assertRole(
      actor,
      REGISTRY_WRITE_ROLES,
      'You cannot manage the valve registry',
    );
    const valveId = assertId(id, 'id');
    const expected = parseExpectedDate(dto);
    const name = textInput(dto.name, 'name', 120);
    const code = textInput(dto.code, 'code', 40).toUpperCase();
    let updated: RawRow | null;
    try {
      updated = await queryOne<RawRow>(
        this.prisma,
        Prisma.sql`
          UPDATE valves
          SET name = ${name},
              code = ${code},
              location = ${pointSql(dto.location, 'location')},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${valveId} AND updated_at = ${expected}
          RETURNING id
        `,
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('code is already registered');
      }
      throw error;
    }
    if (!updated) {
      await this.assertStillExists('valves', valveId, 'Valve');
      throw new ConflictException(
        'Valve was modified by another request, reload and retry',
      );
    }
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`${VALVE_SELECT} WHERE v.id = ${valveId} LIMIT 1`,
    );
    if (!row) {
      throw new InternalServerErrorException('Valve could not be read');
    }
    await this.auditService.record(
      {
        action: 'maintenance.valve_updated',
        entityType: 'Valve',
        entityId: valveId,
        metadata: { name, code },
      },
      actor,
    );
    return this.mapValve(row);
  }

  async changeValveState(
    id: string,
    dto: ChangeValveStateDto,
    actor: AuthenticatedUser,
  ): Promise<ValveStateChangeResultDto> {
    this.assertRole(actor, VALVE_OPERATOR_ROLES, 'You cannot operate valves');
    const valveId = assertId(id, 'id');
    const expected =
      dto.expectedUpdatedAt === undefined && dto.updatedAt === undefined
        ? null
        : parseExpectedDate(dto);
    const changed = await runInTransaction(this.prisma, async (client) => {
      const current = await queryOne<RawRow>(
        client,
        Prisma.sql`${VALVE_SELECT} WHERE v.id = ${valveId} LIMIT 1 FOR UPDATE OF v`,
      );
      if (!current) {
        throw new NotFoundException('Valve was not found');
      }
      if (
        expected !== null &&
        toDate(rowValue(current, 'updatedAt'), 'updatedAt').getTime() !==
          expected.getTime()
      ) {
        throw new ConflictException(
          'Valve was modified by another request, reload and retry',
        );
      }
      const isOpen = toBoolean(rowValue(current, 'isOpen'));
      let change;
      try {
        change = assertStateChange(isOpen, dto.isOpen);
      } catch (error) {
        if (error instanceof RepeatedValveStateError) {
          throw new ConflictException(error.message);
        }
        throw error;
      }
      const updated = await queryOne<RawRow>(
        client,
        Prisma.sql`
          UPDATE valves
          SET is_open = ${dto.isOpen},
              last_changed_at = CURRENT_TIMESTAMP,
              last_changed_by_id = ${actor.id},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${valveId}
          RETURNING last_changed_at AS "lastChangedAt"
        `,
      );
      if (!updated) {
        throw new InternalServerErrorException(
          'Valve state could not be saved',
        );
      }
      return {
        change,
        changedAt: toDate(rowValue(updated, 'lastChangedAt'), 'lastChangedAt'),
      };
    });
    await this.auditService.record(
      {
        action: changed.change.action,
        entityType: 'Valve',
        entityId: valveId,
        metadata: {
          from: changed.change.from,
          to: changed.change.to,
          changedAt: changed.changedAt.toISOString(),
        },
      },
      actor,
    );
    return {
      id: valveId,
      position: changed.change.to,
      previousPosition: changed.change.from,
      changedAt: changed.changedAt.toISOString(),
      changedById: actor.id,
    };
  }

  private async assertKebeleExists(kebeleId: string): Promise<void> {
    const row = await queryOne<RawRow>(
      this.prisma,
      Prisma.sql`SELECT id FROM kebeles WHERE id = ${kebeleId} LIMIT 1`,
    );
    if (!row) {
      throw new BadRequestException('kebeleId does not reference a Kebele');
    }
  }

  private async assertStillExists(
    table: 'pipelines' | 'valves',
    id: string,
    label: string,
  ): Promise<void> {
    const row = await queryOne<RawRow>(
      this.prisma,
      table === 'pipelines'
        ? Prisma.sql`SELECT id FROM pipelines WHERE id = ${id} LIMIT 1`
        : Prisma.sql`SELECT id FROM valves WHERE id = ${id} LIMIT 1`,
    );
    if (!row) {
      throw new NotFoundException(`${label} was not found`);
    }
  }
}
