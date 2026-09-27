import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  PageResult,
  PaginationQueryDto,
  paginated,
} from '../../common/dto/pagination.dto.js';
import {
  ActiveSearchQueryDto,
  NeighborhoodQueryDto,
  PipelineQueryDto,
  ValveQueryDto,
} from './dto/common.dto.js';
import {
  CreateKebeleDto,
  KebeleResponseDto,
  PublicKebeleResponseDto,
  UpdateKebeleDto,
} from './dto/kebele.dto.js';
import {
  CreateNeighborhoodDto,
  NeighborhoodResponseDto,
  PublicNeighborhoodResponseDto,
  UpdateNeighborhoodDto,
} from './dto/neighborhood.dto.js';
import {
  CreatePipelineDto,
  PipelineResponseDto,
  PublicPipelineResponseDto,
  UpdatePipelineDto,
} from './dto/pipeline.dto.js';
import {
  CreateValveDto,
  PublicValveResponseDto,
  UpdateValveDto,
  ValveResponseDto,
} from './dto/valve.dto.js';
import { getApplicationTimezone, parseDateOnly } from './date-only.js';
import {
  assertGeometry,
  assertPoint,
  geometrySql,
  pointSql,
} from './geometry.js';
import {
  joinSql,
  queryOne,
  queryRows,
  RawExecutor,
  RawRow,
  rowValue,
  runInTransaction,
  toBoolean,
  toDate,
  toNullableDate,
  toNullableNumber,
  toNumber,
  toStringValue,
  TransactionClient,
  whereSql,
  rawExecutor,
} from './raw.js';
import { mapGeoJson, mapPoint } from './types.js';

const KEBELE_SELECT = Prisma.sql`
  SELECT
    k.id,
    k.name,
    k.code,
    k.population,
    k.is_active AS "isActive",
    k.created_at AS "createdAt",
    k.updated_at AS "updatedAt",
    CASE WHEN k.center IS NULL THEN NULL ELSE ST_X(k.center) END AS "centerLongitude",
    CASE WHEN k.center IS NULL THEN NULL ELSE ST_Y(k.center) END AS "centerLatitude",
    CASE WHEN k.center IS NULL THEN NULL ELSE ST_AsGeoJSON(k.center)::json END AS "centerGeoJson",
    CASE WHEN k.boundary IS NULL THEN NULL ELSE ST_AsGeoJSON(k.boundary)::json END AS "boundaryGeoJson"
  FROM kebeles k
`;

const NEIGHBORHOOD_SELECT = Prisma.sql`
  SELECT
    n.id,
    n.kebele_id AS "kebeleId",
    n.name,
    n.code,
    n.is_active AS "isActive",
    n.created_at AS "createdAt",
    n.updated_at AS "updatedAt",
    CASE WHEN n.center IS NULL THEN NULL ELSE ST_X(n.center) END AS "centerLongitude",
    CASE WHEN n.center IS NULL THEN NULL ELSE ST_Y(n.center) END AS "centerLatitude",
    CASE WHEN n.center IS NULL THEN NULL ELSE ST_AsGeoJSON(n.center)::json END AS "centerGeoJson",
    CASE WHEN n.boundary IS NULL THEN NULL ELSE ST_AsGeoJSON(n.boundary)::json END AS "boundaryGeoJson"
  FROM neighborhoods n
  LEFT JOIN kebeles AS reference_kebele ON reference_kebele.id = n.kebele_id
`;

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
  LEFT JOIN kebeles AS reference_kebele ON reference_kebele.id = p.kebele_id
`;

const VALVE_SELECT = Prisma.sql`
  SELECT
    v.id,
    v.kebele_id AS "kebeleId",
    v.name,
    v.code,
    CASE WHEN v.location IS NULL THEN NULL ELSE ST_X(v.location) END AS "locationLongitude",
    CASE WHEN v.location IS NULL THEN NULL ELSE ST_Y(v.location) END AS "locationLatitude",
    CASE WHEN v.location IS NULL THEN NULL ELSE ST_AsGeoJSON(v.location)::json END AS "locationGeoJson",
    v.is_open AS "isOpen",
    v.last_changed_at AS "lastChangedAt",
    v.last_changed_by_id AS "lastChangedById",
    v.created_at AS "createdAt",
    v.updated_at AS "updatedAt"
  FROM valves v
  LEFT JOIN kebeles AS reference_kebele ON reference_kebele.id = v.kebele_id
`;

function normalizePagination(
  pagination: PaginationQueryDto,
): PaginationQueryDto {
  const normalized = new PaginationQueryDto();
  normalized.page = pagination.page ?? 1;
  normalized.limit = pagination.limit ?? 20;
  return normalized;
}

function inputDate(value: unknown, fieldName: string): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (
    !(value instanceof Date) &&
    typeof value !== 'string' &&
    typeof value !== 'number'
  ) {
    throw new BadRequestException(`${fieldName} must be a valid date`);
  }
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid date`);
  }
  return date;
}

function expectedDate(dto: {
  expectedUpdatedAt?: string;
  updatedAt?: string;
}): Date {
  const value = dto.expectedUpdatedAt ?? dto.updatedAt;
  if (!value) {
    throw new BadRequestException('expectedUpdatedAt is required for updates');
  }
  const expected = inputDate(value, 'expectedUpdatedAt');
  if (expected === null) {
    throw new BadRequestException('expectedUpdatedAt is required for updates');
  }
  if (
    dto.expectedUpdatedAt !== undefined &&
    dto.updatedAt !== undefined &&
    inputDate(dto.expectedUpdatedAt, 'expectedUpdatedAt')?.getTime() !==
      inputDate(dto.updatedAt, 'updatedAt')?.getTime()
  ) {
    throw new BadRequestException('updatedAt aliases must match');
  }
  return expected;
}

function finiteInputNumber(
  value: unknown,
  fieldName: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new BadRequestException(`${fieldName} must be finite`);
  }
  if (numberValue < minimum || numberValue > maximum) {
    throw new BadRequestException(
      `${fieldName} must be between ${minimum} and ${maximum}`,
    );
  }
  return numberValue;
}

function integerInput(
  value: unknown,
  fieldName: string,
  minimum: number,
  maximum: number,
): number | null {
  const numberValue = finiteInputNumber(value, fieldName, minimum, maximum);
  if (numberValue !== null && !Number.isInteger(numberValue)) {
    throw new BadRequestException(`${fieldName} must be an integer`);
  }
  return numberValue;
}

@Injectable()
export class GeographyService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private timezone(): string {
    return getApplicationTimezone(this.configService);
  }

  private raw(
    client: PrismaService | TransactionClient = this.prismaService,
  ): RawExecutor {
    return rawExecutor(client);
  }

  private async assertKebeleReference(
    client: PrismaService | TransactionClient,
    kebeleId: string,
  ): Promise<void> {
    const row = await queryOne<RawRow>(
      this.raw(client),
      Prisma.sql`SELECT id, is_active AS "isActive" FROM kebeles WHERE id = ${kebeleId} LIMIT 1`,
    );
    if (!row) {
      throw new NotFoundException(`Kebele ${kebeleId} was not found`);
    }
    if (rowValue(row, 'isActive') === false) {
      throw new BadRequestException('An inactive Kebele cannot be selected');
    }
  }

  private async assertNeighborhoodReference(
    client: PrismaService | TransactionClient,
    neighborhoodId: string,
    kebeleId: string,
  ): Promise<void> {
    const row = await queryOne<RawRow>(
      this.raw(client),
      Prisma.sql`
        SELECT id, kebele_id AS "kebeleId", is_active AS "isActive"
        FROM neighborhoods
        WHERE id = ${neighborhoodId}
        LIMIT 1
      `,
    );
    if (!row) {
      throw new NotFoundException(
        `Neighborhood ${neighborhoodId} was not found`,
      );
    }
    const actualKebeleId = toStringValue(
      rowValue(row, 'kebeleId', 'kebele_id'),
      'neighborhood kebeleId',
    );
    if (actualKebeleId !== kebeleId) {
      throw new BadRequestException(
        'Neighborhood does not belong to the Kebele',
      );
    }
    if (rowValue(row, 'isActive') === false) {
      throw new BadRequestException(
        'An inactive Neighborhood cannot be selected',
      );
    }
  }

  private kebeleWhere(query: ActiveSearchQueryDto): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];
    if (query.isActive !== undefined) {
      conditions.push(Prisma.sql`k.is_active = ${query.isActive}`);
    }
    if (query.search !== undefined) {
      const pattern = `%${query.search}%`;
      conditions.push(
        Prisma.sql`(LOWER(k.name) LIKE LOWER(${pattern}) OR LOWER(k.code) LIKE LOWER(${pattern}))`,
      );
    }
    return whereSql(conditions);
  }

  private neighborhoodWhere(query: {
    isActive?: boolean;
    search?: string;
    kebeleId?: string;
  }): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];
    if (query.kebeleId !== undefined) {
      conditions.push(Prisma.sql`n.kebele_id = ${query.kebeleId}`);
    }
    if (query.isActive !== undefined) {
      conditions.push(Prisma.sql`n.is_active = ${query.isActive}`);
    }
    if (query.search !== undefined) {
      const pattern = `%${query.search}%`;
      conditions.push(
        Prisma.sql`(LOWER(n.name) LIKE LOWER(${pattern}) OR LOWER(n.code) LIKE LOWER(${pattern}))`,
      );
    }
    return whereSql(conditions);
  }

  private pipelineWhere(query: {
    isActive?: boolean;
    search?: string;
    kebeleId?: string;
  }): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];
    if (query.kebeleId !== undefined) {
      conditions.push(Prisma.sql`p.kebele_id = ${query.kebeleId}`);
    }
    if (query.isActive !== undefined) {
      conditions.push(Prisma.sql`p.is_active = ${query.isActive}`);
    }
    if (query.search !== undefined) {
      const pattern = `%${query.search}%`;
      conditions.push(Prisma.sql`LOWER(p.name) LIKE LOWER(${pattern})`);
    }
    return whereSql(conditions);
  }

  private valveWhere(query: {
    isOpen?: boolean;
    search?: string;
    kebeleId?: string;
  }): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];
    if (query.kebeleId !== undefined) {
      conditions.push(Prisma.sql`v.kebele_id = ${query.kebeleId}`);
    }
    if (query.isOpen !== undefined) {
      conditions.push(Prisma.sql`v.is_open = ${query.isOpen}`);
    }
    if (query.search !== undefined) {
      const pattern = `%${query.search}%`;
      conditions.push(
        Prisma.sql`(LOWER(v.name) LIKE LOWER(${pattern}) OR LOWER(v.code) LIKE LOWER(${pattern}))`,
      );
    }
    return whereSql(conditions);
  }

  private async count(
    client: RawExecutor,
    table: Prisma.Sql,
    where: Prisma.Sql,
  ): Promise<number> {
    const row = await queryOne<RawRow>(
      client,
      Prisma.sql`SELECT COUNT(*)::int AS "count" FROM ${table} WHERE ${where}`,
    );
    return toNumber(rowValue(row ?? {}, 'count'), 'count');
  }

  private mapKebele(row: RawRow): KebeleResponseDto {
    return {
      id: toStringValue(rowValue(row, 'id'), 'kebele id'),
      name: toStringValue(rowValue(row, 'name'), 'kebele name'),
      code: toStringValue(rowValue(row, 'code'), 'kebele code'),
      population: toNullableNumber(rowValue(row, 'population')),
      isActive: toBoolean(rowValue(row, 'isActive', 'is_active')),
      createdAt: toDate(rowValue(row, 'createdAt', 'created_at'), 'createdAt'),
      updatedAt: toDate(rowValue(row, 'updatedAt', 'updated_at'), 'updatedAt'),
      center: mapPoint(row, 'center'),
      boundary: mapGeoJson(row, 'boundary', 'MultiPolygon'),
    };
  }

  private mapPublicKebele(row: RawRow): PublicKebeleResponseDto {
    return {
      id: toStringValue(rowValue(row, 'id'), 'kebele id'),
      name: toStringValue(rowValue(row, 'name'), 'kebele name'),
      code: toStringValue(rowValue(row, 'code'), 'kebele code'),
      population: toNullableNumber(rowValue(row, 'population')),
      center: mapPoint(row, 'center'),
      boundary: mapGeoJson(row, 'boundary', 'MultiPolygon'),
    };
  }

  private mapNeighborhood(row: RawRow): NeighborhoodResponseDto {
    return {
      id: toStringValue(rowValue(row, 'id'), 'neighborhood id'),
      kebeleId: toStringValue(
        rowValue(row, 'kebeleId', 'kebele_id'),
        'neighborhood kebeleId',
      ),
      name: toStringValue(rowValue(row, 'name'), 'neighborhood name'),
      code: toStringValue(rowValue(row, 'code'), 'neighborhood code'),
      isActive: toBoolean(rowValue(row, 'isActive', 'is_active')),
      createdAt: toDate(rowValue(row, 'createdAt', 'created_at'), 'createdAt'),
      updatedAt: toDate(rowValue(row, 'updatedAt', 'updated_at'), 'updatedAt'),
      center: mapPoint(row, 'center'),
      boundary: mapGeoJson(row, 'boundary', 'MultiPolygon'),
    };
  }

  private mapPublicNeighborhood(row: RawRow): PublicNeighborhoodResponseDto {
    return {
      id: toStringValue(rowValue(row, 'id'), 'neighborhood id'),
      kebeleId: toStringValue(
        rowValue(row, 'kebeleId', 'kebele_id'),
        'neighborhood kebeleId',
      ),
      name: toStringValue(rowValue(row, 'name'), 'neighborhood name'),
      code: toStringValue(rowValue(row, 'code'), 'neighborhood code'),
      center: mapPoint(row, 'center'),
      boundary: mapGeoJson(row, 'boundary', 'MultiPolygon'),
    };
  }

  private mapPipeline(row: RawRow): PipelineResponseDto {
    const path = mapGeoJson(row, 'path', 'LineString');
    if (path === null) {
      throw new InternalServerErrorException('Pipeline path is missing');
    }
    return {
      id: toStringValue(rowValue(row, 'id'), 'pipeline id'),
      kebeleId: toStringValue(
        rowValue(row, 'kebeleId', 'kebele_id'),
        'pipeline kebeleId',
      ),
      name: toStringValue(rowValue(row, 'name'), 'pipeline name'),
      material: this.nullableString(rowValue(row, 'material')),
      diameterMillimeters: toNullableNumber(
        rowValue(row, 'diameterMillimeters', 'diameter_millimeters'),
      ),
      path,
      installedAt: toNullableDate(
        rowValue(row, 'installedAt', 'installed_at'),
        'installedAt',
      ),
      isActive: toBoolean(rowValue(row, 'isActive', 'is_active')),
      createdAt: toDate(rowValue(row, 'createdAt', 'created_at'), 'createdAt'),
      updatedAt: toDate(rowValue(row, 'updatedAt', 'updated_at'), 'updatedAt'),
    };
  }

  private mapPublicPipeline(row: RawRow): PublicPipelineResponseDto {
    const path = mapGeoJson(row, 'path', 'LineString');
    if (path === null) {
      throw new InternalServerErrorException('Pipeline path is missing');
    }
    return {
      id: toStringValue(rowValue(row, 'id'), 'pipeline id'),
      kebeleId: toStringValue(
        rowValue(row, 'kebeleId', 'kebele_id'),
        'pipeline kebeleId',
      ),
      name: toStringValue(rowValue(row, 'name'), 'pipeline name'),
      path,
      installedAt: toNullableDate(
        rowValue(row, 'installedAt', 'installed_at'),
        'installedAt',
      ),
    };
  }

  private mapValve(row: RawRow): ValveResponseDto {
    const location = mapPoint(row, 'location');
    if (location === null) {
      throw new InternalServerErrorException('Valve location is missing');
    }
    return {
      id: toStringValue(rowValue(row, 'id'), 'valve id'),
      kebeleId: toStringValue(
        rowValue(row, 'kebeleId', 'kebele_id'),
        'valve kebeleId',
      ),
      name: toStringValue(rowValue(row, 'name'), 'valve name'),
      code: toStringValue(rowValue(row, 'code'), 'valve code'),
      location,
      isOpen: toBoolean(rowValue(row, 'isOpen', 'is_open')),
      lastChangedAt: toNullableDate(
        rowValue(row, 'lastChangedAt', 'last_changed_at'),
        'lastChangedAt',
      ),
      lastChangedById: this.nullableString(
        rowValue(row, 'lastChangedById', 'last_changed_by_id'),
      ),
      createdAt: toDate(rowValue(row, 'createdAt', 'created_at'), 'createdAt'),
      updatedAt: toDate(rowValue(row, 'updatedAt', 'updated_at'), 'updatedAt'),
    };
  }

  private mapPublicValve(row: RawRow): PublicValveResponseDto {
    const location = mapPoint(row, 'location');
    if (location === null) {
      throw new InternalServerErrorException('Valve location is missing');
    }
    return {
      id: toStringValue(rowValue(row, 'id'), 'valve id'),
      kebeleId: toStringValue(
        rowValue(row, 'kebeleId', 'kebele_id'),
        'valve kebeleId',
      ),
      name: toStringValue(rowValue(row, 'name'), 'valve name'),
      code: toStringValue(rowValue(row, 'code'), 'valve code'),
      location,
      isOpen: toBoolean(rowValue(row, 'isOpen', 'is_open')),
    };
  }

  private nullableString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return value.toString();
    }
    throw new InternalServerErrorException('Unexpected nullable string value');
  }

  private assertExpectedVersion(
    row: RawRow,
    expected: Date,
    entityName: string,
  ): void {
    const actual = toDate(
      rowValue(row, 'updatedAt', 'updated_at'),
      'updatedAt',
    );
    if (actual.getTime() !== expected.getTime()) {
      throw new ConflictException(
        `${entityName} was updated by another request`,
      );
    }
  }

  private async insertAndRead<T>(
    client: PrismaService | TransactionClient,
    insert: Prisma.Sql,
    id: string,
    read: (executor: RawExecutor, id: string) => Promise<T>,
  ): Promise<T> {
    const inserted = await queryOne<RawRow>(this.raw(client), insert);
    if (!inserted) {
      throw new InternalServerErrorException('The record could not be created');
    }
    return read(this.raw(client), id);
  }

  async createKebele(dto: CreateKebeleDto): Promise<KebeleResponseDto> {
    const center = dto.center ?? null;
    const boundary = dto.boundary ?? null;
    if (center !== null) {
      assertPoint(center, 'center');
    }
    if (boundary !== null) {
      assertGeometry(boundary, 'MultiPolygon', 'boundary');
    }
    const id = randomUUID();
    const centerSql =
      center === null ? Prisma.sql`NULL` : pointSql(center, 'center');
    const boundarySql =
      boundary === null
        ? Prisma.sql`NULL`
        : geometrySql(boundary, 'MultiPolygon', 'boundary');
    const insert = Prisma.sql`
      INSERT INTO kebeles
        (id, name, code, population, is_active, center, boundary, created_at, updated_at)
      VALUES
        (${id}, ${dto.name}, ${dto.code}, ${dto.population ?? null}, ${dto.isActive ?? true},
         ${centerSql}, ${boundarySql}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id
    `;
    return runInTransaction(this.prismaService, (client) =>
      this.insertAndRead(client, insert, id, async (executor) => {
        const row = await queryOne<RawRow>(
          executor,
          Prisma.sql`${KEBELE_SELECT} WHERE k.id = ${id} LIMIT 1`,
        );
        if (!row) {
          throw new InternalServerErrorException(
            'Created Kebele could not be read',
          );
        }
        return this.mapKebele(row);
      }),
    );
  }

  async findAllKebeles(
    query: ActiveSearchQueryDto = new ActiveSearchQueryDto(),
  ): Promise<PageResult<KebeleResponseDto>> {
    const pagination = normalizePagination(query);
    const where = this.kebeleWhere(query);
    const client = this.raw();
    const rows = await queryRows<RawRow>(
      client,
      Prisma.sql`${KEBELE_SELECT} WHERE ${where} ORDER BY k.name ASC, k.id ASC LIMIT ${pagination.take} OFFSET ${pagination.skip}`,
    );
    const total = await this.count(client, Prisma.sql`kebeles k`, where);
    return paginated(
      rows.map((row) => this.mapKebele(row)),
      total,
      pagination,
    );
  }

  async findPublicAllKebeles(
    query: ActiveSearchQueryDto = new ActiveSearchQueryDto(),
  ): Promise<PageResult<PublicKebeleResponseDto>> {
    const activeQuery = Object.assign(new ActiveSearchQueryDto(), query, {
      isActive: true,
    });
    const pagination = normalizePagination(activeQuery);
    const where = this.kebeleWhere(activeQuery);
    const client = this.raw();
    const rows = await queryRows<RawRow>(
      client,
      Prisma.sql`${KEBELE_SELECT} WHERE ${where} ORDER BY k.name ASC, k.id ASC LIMIT ${pagination.take} OFFSET ${pagination.skip}`,
    );
    const total = await this.count(client, Prisma.sql`kebeles k`, where);
    return paginated(
      rows.map((row) => this.mapPublicKebele(row)),
      total,
      pagination,
    );
  }

  async findOneKebele(
    id: string,
    client: PrismaService | TransactionClient = this.prismaService,
  ): Promise<KebeleResponseDto> {
    const row = await this.findKebeleRow(client, id);
    if (!row) {
      throw new NotFoundException(`Kebele ${id} was not found`);
    }
    return this.mapKebele(row);
  }

  async findPublicOneKebele(id: string): Promise<PublicKebeleResponseDto> {
    const row = await queryOne<RawRow>(
      this.raw(),
      Prisma.sql`${KEBELE_SELECT} WHERE k.id = ${id} AND k.is_active = TRUE LIMIT 1`,
    );
    if (!row) {
      throw new NotFoundException(`Kebele ${id} was not found`);
    }
    return this.mapPublicKebele(row);
  }

  private async findKebeleRow(
    client: PrismaService | TransactionClient,
    id: string,
    lock = false,
  ): Promise<RawRow | null> {
    const lockClause = lock ? Prisma.sql` FOR UPDATE OF k` : Prisma.sql``;
    return queryOne<RawRow>(
      this.raw(client),
      Prisma.sql`${KEBELE_SELECT} WHERE k.id = ${id} LIMIT 1${lockClause}`,
    );
  }

  async updateKebele(
    id: string,
    dto: UpdateKebeleDto,
  ): Promise<KebeleResponseDto> {
    const expected = expectedDate(dto);
    return runInTransaction(this.prismaService, async (client) => {
      const current = await this.findKebeleRow(client, id, true);
      if (!current) {
        throw new NotFoundException(`Kebele ${id} was not found`);
      }
      this.assertExpectedVersion(current, expected, 'Kebele');
      const assignments: Prisma.Sql[] = [];
      if (dto.name !== undefined) {
        assignments.push(Prisma.sql`name = ${dto.name}`);
      }
      if (dto.code !== undefined) {
        assignments.push(Prisma.sql`code = ${dto.code}`);
      }
      if (dto.population !== undefined) {
        assignments.push(Prisma.sql`population = ${dto.population}`);
      }
      if (dto.isActive !== undefined) {
        assignments.push(Prisma.sql`is_active = ${dto.isActive}`);
      }
      if (dto.center !== undefined) {
        assignments.push(
          dto.center === null
            ? Prisma.sql`center = NULL`
            : Prisma.sql`center = ${pointSql(dto.center, 'center')}`,
        );
      }
      if (dto.boundary !== undefined) {
        assignments.push(
          dto.boundary === null
            ? Prisma.sql`boundary = NULL`
            : Prisma.sql`boundary = ${geometrySql(dto.boundary, 'MultiPolygon', 'boundary')}`,
        );
      }
      assignments.push(Prisma.sql`updated_at = CURRENT_TIMESTAMP`);
      const updated = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`
          UPDATE kebeles AS k
          SET ${joinSql(assignments, Prisma.sql`, `)}
          WHERE k.id = ${id} AND date_trunc('milliseconds', k.updated_at) = ${expected}
          RETURNING k.id
        `,
      );
      if (!updated) {
        throw new ConflictException('Kebele was updated by another request');
      }
      const result = await this.findKebeleRow(client, id);
      if (!result) {
        throw new InternalServerErrorException(
          'Updated Kebele could not be read',
        );
      }
      return this.mapKebele(result);
    });
  }

  async removeKebele(id: string): Promise<void> {
    const deleted = await queryOne<RawRow>(
      this.raw(),
      Prisma.sql`DELETE FROM kebeles WHERE id = ${id} RETURNING id`,
    );
    if (!deleted) {
      throw new NotFoundException(`Kebele ${id} was not found`);
    }
  }

  async createNeighborhood(
    dto: CreateNeighborhoodDto,
  ): Promise<NeighborhoodResponseDto> {
    const center = dto.center ?? null;
    const boundary = dto.boundary ?? null;
    if (center !== null) {
      assertPoint(center, 'center');
    }
    if (boundary !== null) {
      assertGeometry(boundary, 'MultiPolygon', 'boundary');
    }
    const id = randomUUID();
    const centerSql =
      center === null ? Prisma.sql`NULL` : pointSql(center, 'center');
    const boundarySql =
      boundary === null
        ? Prisma.sql`NULL`
        : geometrySql(boundary, 'MultiPolygon', 'boundary');
    const insert = Prisma.sql`
      INSERT INTO neighborhoods
        (id, kebele_id, name, code, is_active, center, boundary, created_at, updated_at)
      VALUES
        (${id}, ${dto.kebeleId}, ${dto.name}, ${dto.code}, ${dto.isActive ?? true},
         ${centerSql}, ${boundarySql}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id
    `;
    return runInTransaction(this.prismaService, async (client) => {
      await this.assertKebeleReference(client, dto.kebeleId);
      return this.insertAndRead(client, insert, id, async (executor) => {
        const row = await queryOne<RawRow>(
          executor,
          Prisma.sql`${NEIGHBORHOOD_SELECT} WHERE n.id = ${id} LIMIT 1`,
        );
        if (!row) {
          throw new InternalServerErrorException(
            'Created Neighborhood could not be read',
          );
        }
        return this.mapNeighborhood(row);
      });
    });
  }

  async findAllNeighborhoods(
    query: {
      page?: number;
      limit?: number;
      isActive?: boolean;
      search?: string;
      kebeleId?: string;
    } = {},
  ): Promise<PageResult<NeighborhoodResponseDto>> {
    const pagination = normalizePagination(query as PaginationQueryDto);
    const where = this.neighborhoodWhere(query);
    const client = this.raw();
    const rows = await queryRows<RawRow>(
      client,
      Prisma.sql`${NEIGHBORHOOD_SELECT} WHERE ${where} ORDER BY n.name ASC, n.id ASC LIMIT ${pagination.take} OFFSET ${pagination.skip}`,
    );
    const total = await this.count(client, Prisma.sql`neighborhoods n`, where);
    return paginated(
      rows.map((row) => this.mapNeighborhood(row)),
      total,
      pagination,
    );
  }

  async findPublicAllNeighborhoods(
    query: NeighborhoodQueryDto = new NeighborhoodQueryDto(),
  ): Promise<PageResult<PublicNeighborhoodResponseDto>> {
    const activeQuery = Object.assign(new NeighborhoodQueryDto(), query, {
      isActive: true,
    });
    const pagination = normalizePagination(activeQuery);
    const where = whereSql([
      this.neighborhoodWhere(activeQuery),
      Prisma.sql`reference_kebele.is_active = TRUE`,
    ]);
    const client = this.raw();
    const rows = await queryRows<RawRow>(
      client,
      Prisma.sql`${NEIGHBORHOOD_SELECT} WHERE ${where} ORDER BY n.name ASC, n.id ASC LIMIT ${pagination.take} OFFSET ${pagination.skip}`,
    );
    const total = await this.count(
      client,
      Prisma.sql`neighborhoods n LEFT JOIN kebeles AS reference_kebele ON reference_kebele.id = n.kebele_id`,
      where,
    );
    return paginated(
      rows.map((row) => this.mapPublicNeighborhood(row)),
      total,
      pagination,
    );
  }

  async findOneNeighborhood(
    id: string,
    client: PrismaService | TransactionClient = this.prismaService,
  ): Promise<NeighborhoodResponseDto> {
    const row = await this.findNeighborhoodRow(client, id);
    if (!row) {
      throw new NotFoundException(`Neighborhood ${id} was not found`);
    }
    return this.mapNeighborhood(row);
  }

  async findPublicOneNeighborhood(
    id: string,
  ): Promise<PublicNeighborhoodResponseDto> {
    const row = await queryOne<RawRow>(
      this.raw(),
      Prisma.sql`
        ${NEIGHBORHOOD_SELECT}
        WHERE n.id = ${id}
          AND n.is_active = TRUE
          AND reference_kebele.is_active = TRUE
        LIMIT 1
      `,
    );
    if (!row) {
      throw new NotFoundException(`Neighborhood ${id} was not found`);
    }
    return this.mapPublicNeighborhood(row);
  }

  private async findNeighborhoodRow(
    client: PrismaService | TransactionClient,
    id: string,
    lock = false,
  ): Promise<RawRow | null> {
    const lockClause = lock ? Prisma.sql` FOR UPDATE OF n` : Prisma.sql``;
    return queryOne<RawRow>(
      this.raw(client),
      Prisma.sql`${NEIGHBORHOOD_SELECT} WHERE n.id = ${id} LIMIT 1${lockClause}`,
    );
  }

  private async reparentStandpipes(
    client: TransactionClient,
    neighborhoodId: string,
    kebeleId: string,
  ): Promise<void> {
    const related = await queryRows<RawRow>(
      this.raw(client),
      Prisma.sql`
        SELECT id, updated_at AS "updatedAt"
        FROM standpipes
        WHERE neighborhood_id = ${neighborhoodId}
        ORDER BY id ASC
        FOR UPDATE
      `,
    );
    if (related.length === 0) {
      return;
    }
    const predicates = related.map((row) => {
      const standpipeId = toStringValue(rowValue(row, 'id'), 'standpipe id');
      const updatedAt = toDate(
        rowValue(row, 'updatedAt', 'updated_at'),
        'standpipe updatedAt',
      );
      return Prisma.sql`(s.id = ${standpipeId} AND date_trunc('milliseconds', s.updated_at) = ${updatedAt})`;
    });
    const updated = await queryRows<RawRow>(
      this.raw(client),
      Prisma.sql`
        UPDATE standpipes AS s
        SET kebele_id = ${kebeleId}, updated_at = CURRENT_TIMESTAMP
        WHERE ${whereSql(predicates)}
        RETURNING s.id
      `,
    );
    if (updated.length !== related.length) {
      throw new ConflictException(
        'A related Standpipe was updated by another request',
      );
    }
  }

  async updateNeighborhood(
    id: string,
    dto: UpdateNeighborhoodDto,
  ): Promise<NeighborhoodResponseDto> {
    const expected = expectedDate(dto);
    return runInTransaction(this.prismaService, async (client) => {
      const current = await this.findNeighborhoodRow(client, id, true);
      if (!current) {
        throw new NotFoundException(`Neighborhood ${id} was not found`);
      }
      this.assertExpectedVersion(current, expected, 'Neighborhood');
      const currentKebeleId = toStringValue(
        rowValue(current, 'kebeleId', 'kebele_id'),
        'kebeleId',
      );
      const nextKebeleId = dto.kebeleId ?? currentKebeleId;
      if (dto.kebeleId !== undefined) {
        await this.assertKebeleReference(client, dto.kebeleId);
      }
      if (nextKebeleId !== currentKebeleId) {
        await this.reparentStandpipes(client, id, nextKebeleId);
      }
      const assignments: Prisma.Sql[] = [];
      if (dto.kebeleId !== undefined) {
        assignments.push(Prisma.sql`kebele_id = ${dto.kebeleId}`);
      }
      if (dto.name !== undefined) {
        assignments.push(Prisma.sql`name = ${dto.name}`);
      }
      if (dto.code !== undefined) {
        assignments.push(Prisma.sql`code = ${dto.code}`);
      }
      if (dto.isActive !== undefined) {
        assignments.push(Prisma.sql`is_active = ${dto.isActive}`);
      }
      if (dto.center !== undefined) {
        assignments.push(
          dto.center === null
            ? Prisma.sql`center = NULL`
            : Prisma.sql`center = ${pointSql(dto.center, 'center')}`,
        );
      }
      if (dto.boundary !== undefined) {
        assignments.push(
          dto.boundary === null
            ? Prisma.sql`boundary = NULL`
            : Prisma.sql`boundary = ${geometrySql(dto.boundary, 'MultiPolygon', 'boundary')}`,
        );
      }
      assignments.push(Prisma.sql`updated_at = CURRENT_TIMESTAMP`);
      const updated = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`
          UPDATE neighborhoods AS n
          SET ${joinSql(assignments, Prisma.sql`, `)}
          WHERE n.id = ${id} AND date_trunc('milliseconds', n.updated_at) = ${expected}
          RETURNING n.id
        `,
      );
      if (!updated) {
        throw new ConflictException(
          'Neighborhood was updated by another request',
        );
      }
      const result = await this.findNeighborhoodRow(client, id);
      if (!result) {
        throw new InternalServerErrorException(
          'Updated Neighborhood could not be read',
        );
      }
      if (
        dto.kebeleId !== undefined &&
        rowValue(result, 'kebeleId', 'kebele_id') !== nextKebeleId
      ) {
        throw new ConflictException(
          'Neighborhood was updated by another request',
        );
      }
      return this.mapNeighborhood(result);
    });
  }

  async removeNeighborhood(id: string): Promise<void> {
    const deleted = await queryOne<RawRow>(
      this.raw(),
      Prisma.sql`DELETE FROM neighborhoods WHERE id = ${id} RETURNING id`,
    );
    if (!deleted) {
      throw new NotFoundException(`Neighborhood ${id} was not found`);
    }
  }

  async createPipeline(dto: CreatePipelineDto): Promise<PipelineResponseDto> {
    assertGeometry(dto.path, 'LineString', 'path');
    const installedAt = parseDateOnly(
      dto.installedAt,
      'installedAt',
      this.timezone(),
      undefined,
      true,
    );
    const diameter = integerInput(
      dto.diameterMillimeters,
      'diameterMillimeters',
      1,
      5000,
    );
    const id = randomUUID();
    const insert = Prisma.sql`
      INSERT INTO pipelines
        (id, kebele_id, name, material, diameter_millimeters, path, installed_at,
         is_active, created_at, updated_at)
      VALUES
        (${id}, ${dto.kebeleId}, ${dto.name}, ${dto.material ?? null}, ${diameter},
         ${geometrySql(dto.path, 'LineString', 'path')}, ${installedAt},
         ${dto.isActive ?? true}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id
    `;
    return runInTransaction(this.prismaService, async (client) => {
      await this.assertKebeleReference(client, dto.kebeleId);
      return this.insertAndRead(client, insert, id, async (executor) => {
        const row = await queryOne<RawRow>(
          executor,
          Prisma.sql`${PIPELINE_SELECT} WHERE p.id = ${id} LIMIT 1`,
        );
        if (!row) {
          throw new InternalServerErrorException(
            'Created Pipeline could not be read',
          );
        }
        return this.mapPipeline(row);
      });
    });
  }

  async findAllPipelines(
    query: {
      page?: number;
      limit?: number;
      isActive?: boolean;
      search?: string;
      kebeleId?: string;
    } = {},
  ): Promise<PageResult<PipelineResponseDto>> {
    const pagination = normalizePagination(query as PaginationQueryDto);
    const where = this.pipelineWhere(query);
    const client = this.raw();
    const rows = await queryRows<RawRow>(
      client,
      Prisma.sql`${PIPELINE_SELECT} WHERE ${where} ORDER BY p.name ASC, p.id ASC LIMIT ${pagination.take} OFFSET ${pagination.skip}`,
    );
    const total = await this.count(client, Prisma.sql`pipelines p`, where);
    return paginated(
      rows.map((row) => this.mapPipeline(row)),
      total,
      pagination,
    );
  }

  async findPublicAllPipelines(
    query: PipelineQueryDto = new PipelineQueryDto(),
  ): Promise<PageResult<PublicPipelineResponseDto>> {
    const activeQuery = Object.assign(new PipelineQueryDto(), query, {
      isActive: true,
    });
    const pagination = normalizePagination(activeQuery);
    const where = whereSql([
      this.pipelineWhere(activeQuery),
      Prisma.sql`reference_kebele.is_active = TRUE`,
    ]);
    const client = this.raw();
    const rows = await queryRows<RawRow>(
      client,
      Prisma.sql`${PIPELINE_SELECT} WHERE ${where} ORDER BY p.name ASC, p.id ASC LIMIT ${pagination.take} OFFSET ${pagination.skip}`,
    );
    const total = await this.count(
      client,
      Prisma.sql`pipelines p LEFT JOIN kebeles AS reference_kebele ON reference_kebele.id = p.kebele_id`,
      where,
    );
    return paginated(
      rows.map((row) => this.mapPublicPipeline(row)),
      total,
      pagination,
    );
  }

  async findOnePipeline(
    id: string,
    client: PrismaService | TransactionClient = this.prismaService,
  ): Promise<PipelineResponseDto> {
    const row = await queryOne<RawRow>(
      this.raw(client),
      Prisma.sql`${PIPELINE_SELECT} WHERE p.id = ${id} LIMIT 1`,
    );
    if (!row) {
      throw new NotFoundException(`Pipeline ${id} was not found`);
    }
    return this.mapPipeline(row);
  }

  async findPublicOnePipeline(id: string): Promise<PublicPipelineResponseDto> {
    const row = await queryOne<RawRow>(
      this.raw(),
      Prisma.sql`
        ${PIPELINE_SELECT}
        WHERE p.id = ${id}
          AND p.is_active = TRUE
          AND reference_kebele.is_active = TRUE
        LIMIT 1
      `,
    );
    if (!row) {
      throw new NotFoundException(`Pipeline ${id} was not found`);
    }
    return this.mapPublicPipeline(row);
  }

  async updatePipeline(
    id: string,
    dto: UpdatePipelineDto,
  ): Promise<PipelineResponseDto> {
    const expected = expectedDate(dto);
    return runInTransaction(this.prismaService, async (client) => {
      const current = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`${PIPELINE_SELECT} WHERE p.id = ${id} LIMIT 1 FOR UPDATE OF p`,
      );
      if (!current) {
        throw new NotFoundException(`Pipeline ${id} was not found`);
      }
      this.assertExpectedVersion(current, expected, 'Pipeline');
      if (dto.kebeleId !== undefined) {
        await this.assertKebeleReference(client, dto.kebeleId);
      }
      if (dto.path !== undefined) {
        assertGeometry(dto.path, 'LineString', 'path');
      }
      const assignments: Prisma.Sql[] = [];
      if (dto.kebeleId !== undefined) {
        assignments.push(Prisma.sql`kebele_id = ${dto.kebeleId}`);
      }
      if (dto.name !== undefined) {
        assignments.push(Prisma.sql`name = ${dto.name}`);
      }
      if (dto.material !== undefined) {
        assignments.push(Prisma.sql`material = ${dto.material}`);
      }
      if (dto.diameterMillimeters !== undefined) {
        assignments.push(
          Prisma.sql`diameter_millimeters = ${integerInput(dto.diameterMillimeters, 'diameterMillimeters', 1, 5000)}`,
        );
      }
      if (dto.path !== undefined) {
        assignments.push(
          Prisma.sql`path = ${geometrySql(dto.path, 'LineString', 'path')}`,
        );
      }
      if (dto.installedAt !== undefined) {
        assignments.push(
          Prisma.sql`installed_at = ${parseDateOnly(dto.installedAt, 'installedAt', this.timezone(), undefined, true)}`,
        );
      }
      if (dto.isActive !== undefined) {
        assignments.push(Prisma.sql`is_active = ${dto.isActive}`);
      }
      assignments.push(Prisma.sql`updated_at = CURRENT_TIMESTAMP`);
      const updated = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`
          UPDATE pipelines AS p
          SET ${joinSql(assignments, Prisma.sql`, `)}
          WHERE p.id = ${id} AND date_trunc('milliseconds', p.updated_at) = ${expected}
          RETURNING p.id
        `,
      );
      if (!updated) {
        throw new ConflictException('Pipeline was updated by another request');
      }
      return this.findOnePipeline(id, client);
    });
  }

  async removePipeline(id: string): Promise<void> {
    const deleted = await queryOne<RawRow>(
      this.raw(),
      Prisma.sql`DELETE FROM pipelines WHERE id = ${id} RETURNING id`,
    );
    if (!deleted) {
      throw new NotFoundException(`Pipeline ${id} was not found`);
    }
  }

  async createValve(dto: CreateValveDto): Promise<ValveResponseDto> {
    assertPoint(dto.location, 'location');
    const id = randomUUID();
    const insert = Prisma.sql`
      INSERT INTO valves
        (id, kebele_id, name, code, location, is_open, last_changed_at,
         last_changed_by_id, created_at, updated_at)
      VALUES
        (${id}, ${dto.kebeleId}, ${dto.name}, ${dto.code},
         ${pointSql(dto.location, 'location')}, ${dto.isOpen ?? false},
         NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id
    `;
    return runInTransaction(this.prismaService, async (client) => {
      await this.assertKebeleReference(client, dto.kebeleId);
      return this.insertAndRead(client, insert, id, async (executor) => {
        const row = await queryOne<RawRow>(
          executor,
          Prisma.sql`${VALVE_SELECT} WHERE v.id = ${id} LIMIT 1`,
        );
        if (!row) {
          throw new InternalServerErrorException(
            'Created Valve could not be read',
          );
        }
        return this.mapValve(row);
      });
    });
  }

  async findAllValves(
    query: {
      page?: number;
      limit?: number;
      isOpen?: boolean;
      search?: string;
      kebeleId?: string;
    } = {},
  ): Promise<PageResult<ValveResponseDto>> {
    const pagination = normalizePagination(query as PaginationQueryDto);
    const where = this.valveWhere(query);
    const client = this.raw();
    const rows = await queryRows<RawRow>(
      client,
      Prisma.sql`${VALVE_SELECT} WHERE ${where} ORDER BY v.name ASC, v.id ASC LIMIT ${pagination.take} OFFSET ${pagination.skip}`,
    );
    const total = await this.count(client, Prisma.sql`valves v`, where);
    return paginated(
      rows.map((row) => this.mapValve(row)),
      total,
      pagination,
    );
  }

  async findPublicAllValves(
    query: ValveQueryDto = new ValveQueryDto(),
  ): Promise<PageResult<PublicValveResponseDto>> {
    const pagination = normalizePagination(query);
    const where = whereSql([
      this.valveWhere(query),
      Prisma.sql`reference_kebele.is_active = TRUE`,
    ]);
    const client = this.raw();
    const rows = await queryRows<RawRow>(
      client,
      Prisma.sql`${VALVE_SELECT} WHERE ${where} ORDER BY v.name ASC, v.id ASC LIMIT ${pagination.take} OFFSET ${pagination.skip}`,
    );
    const total = await this.count(
      client,
      Prisma.sql`valves v LEFT JOIN kebeles AS reference_kebele ON reference_kebele.id = v.kebele_id`,
      where,
    );
    return paginated(
      rows.map((row) => this.mapPublicValve(row)),
      total,
      pagination,
    );
  }

  async findOneValve(
    id: string,
    client: PrismaService | TransactionClient = this.prismaService,
  ): Promise<ValveResponseDto> {
    const row = await queryOne<RawRow>(
      this.raw(client),
      Prisma.sql`${VALVE_SELECT} WHERE v.id = ${id} LIMIT 1`,
    );
    if (!row) {
      throw new NotFoundException(`Valve ${id} was not found`);
    }
    return this.mapValve(row);
  }

  async findPublicOneValve(id: string): Promise<PublicValveResponseDto> {
    const row = await queryOne<RawRow>(
      this.raw(),
      Prisma.sql`
        ${VALVE_SELECT}
        WHERE v.id = ${id}
          AND reference_kebele.is_active = TRUE
        LIMIT 1
      `,
    );
    if (!row) {
      throw new NotFoundException(`Valve ${id} was not found`);
    }
    return this.mapPublicValve(row);
  }

  async updateValve(
    id: string,
    dto: UpdateValveDto,
    changedById?: string,
  ): Promise<ValveResponseDto> {
    const expected = expectedDate(dto);
    return runInTransaction(this.prismaService, async (client) => {
      const current = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`${VALVE_SELECT} WHERE v.id = ${id} LIMIT 1 FOR UPDATE OF v`,
      );
      if (!current) {
        throw new NotFoundException(`Valve ${id} was not found`);
      }
      this.assertExpectedVersion(current, expected, 'Valve');
      if (dto.kebeleId !== undefined) {
        await this.assertKebeleReference(client, dto.kebeleId);
      }
      if (dto.location !== undefined) {
        assertPoint(dto.location, 'location');
      }
      const assignments: Prisma.Sql[] = [];
      if (dto.kebeleId !== undefined) {
        assignments.push(Prisma.sql`kebele_id = ${dto.kebeleId}`);
      }
      if (dto.name !== undefined) {
        assignments.push(Prisma.sql`name = ${dto.name}`);
      }
      if (dto.code !== undefined) {
        assignments.push(Prisma.sql`code = ${dto.code}`);
      }
      if (dto.location !== undefined) {
        assignments.push(
          Prisma.sql`location = ${pointSql(dto.location, 'location')}`,
        );
      }
      if (dto.isOpen !== undefined) {
        assignments.push(Prisma.sql`is_open = ${dto.isOpen}`);
        assignments.push(Prisma.sql`last_changed_at = CURRENT_TIMESTAMP`);
        assignments.push(
          Prisma.sql`last_changed_by_id = ${changedById ?? null}`,
        );
      }
      assignments.push(Prisma.sql`updated_at = CURRENT_TIMESTAMP`);
      const updated = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`
          UPDATE valves AS v
          SET ${joinSql(assignments, Prisma.sql`, `)}
          WHERE v.id = ${id} AND date_trunc('milliseconds', v.updated_at) = ${expected}
          RETURNING v.id
        `,
      );
      if (!updated) {
        throw new ConflictException('Valve was updated by another request');
      }
      return this.findOneValve(id, client);
    });
  }

  async removeValve(id: string): Promise<void> {
    const deleted = await queryOne<RawRow>(
      this.raw(),
      Prisma.sql`DELETE FROM valves WHERE id = ${id} RETURNING id`,
    );
    if (!deleted) {
      throw new NotFoundException(`Valve ${id} was not found`);
    }
  }

  listKebeles(query: ActiveSearchQueryDto = new ActiveSearchQueryDto()) {
    return this.findAllKebeles(query);
  }

  getKebele(id: string) {
    return this.findOneKebele(id);
  }

  deleteKebele(id: string) {
    return this.removeKebele(id);
  }

  listNeighborhoods(
    query: Parameters<GeographyService['findAllNeighborhoods']>[0] = {},
  ) {
    return this.findAllNeighborhoods(query);
  }

  getNeighborhood(id: string) {
    return this.findOneNeighborhood(id);
  }

  deleteNeighborhood(id: string) {
    return this.removeNeighborhood(id);
  }

  listPipelines(
    query: Parameters<GeographyService['findAllPipelines']>[0] = {},
  ) {
    return this.findAllPipelines(query);
  }

  getPipeline(id: string) {
    return this.findOnePipeline(id);
  }

  deletePipeline(id: string) {
    return this.removePipeline(id);
  }

  listValves(query: Parameters<GeographyService['findAllValves']>[0] = {}) {
    return this.findAllValves(query);
  }

  getValve(id: string) {
    return this.findOneValve(id);
  }

  deleteValve(id: string) {
    return this.removeValve(id);
  }
}
