import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import {
  PageResult,
  PaginationQueryDto,
  paginated,
} from '../../common/dto/pagination.dto.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { Prisma } from '../../generated/prisma/client.js';
import { UserRole } from '../../generated/prisma/enums.js';
import { assertPoint, pointSql } from '../geography/geometry.js';
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
} from '../geography/raw.js';
import { mapPoint } from '../geography/types.js';
import {
  getApplicationTimezone,
  parseDateOnly,
} from '../geography/date-only.js';
import { CreateStandpipeDto, UpdateStandpipeDto } from './dto/standpipe.dto.js';
import {
  ListOperatorsQueryDto,
  ListStandpipesQueryDto,
} from './dto/standpipe-query.dto.js';
import {
  PublicStandpipeResponseDto,
  StandpipeOperatorDto,
  StandpipeResponseDto,
} from './dto/standpipe-response.dto.js';

const STANDPIPE_SELECT = Prisma.sql`
  SELECT
    s.id,
    s.kebele_id AS "kebeleId",
    s.neighborhood_id AS "neighborhoodId",
    s.operator_profile_id AS "operatorProfileId",
    s.code,
    s.name,
    CASE WHEN s.location IS NULL THEN NULL ELSE ST_X(s.location) END AS "locationLongitude",
    CASE WHEN s.location IS NULL THEN NULL ELSE ST_Y(s.location) END AS "locationLatitude",
    CASE WHEN s.location IS NULL THEN NULL ELSE ST_AsGeoJSON(s.location)::json END AS "locationGeoJson",
    s.elevation_meters AS "elevationMeters",
    s.capacity_liters_per_minute AS "capacityLitersPerMinute",
    s.installed_at AS "installedAt",
    s.is_active AS "isActive",
    s.created_at AS "createdAt",
    s.updated_at AS "updatedAt",
    op.id AS "operatorDetailId",
    op.user_id AS "operatorUserId",
    op.operator_code AS "operatorCode",
    op.license_number AS "operatorLicenseNumber",
    op.is_active AS "operatorIsActive",
    ou.display_name AS "operatorDisplayName"
  FROM standpipes s
  LEFT JOIN standpipe_operator_profiles op ON op.id = s.operator_profile_id
  LEFT JOIN users ou ON ou.id = op.user_id
`;

const PUBLIC_STANDPIPE_SELECT = Prisma.sql`
  SELECT
    s.id,
    s.kebele_id AS "kebeleId",
    s.neighborhood_id AS "neighborhoodId",
    s.code,
    s.name,
    CASE WHEN s.location IS NULL THEN NULL ELSE ST_X(s.location) END AS "locationLongitude",
    CASE WHEN s.location IS NULL THEN NULL ELSE ST_Y(s.location) END AS "locationLatitude",
    CASE WHEN s.location IS NULL THEN NULL ELSE ST_AsGeoJSON(s.location)::json END AS "locationGeoJson"
  FROM standpipes s
  JOIN kebeles AS public_kebele ON public_kebele.id = s.kebele_id
  LEFT JOIN neighborhoods AS public_neighborhood
    ON public_neighborhood.id = s.neighborhood_id
   AND public_neighborhood.kebele_id = s.kebele_id
`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function normalizePagination(
  pagination: PaginationQueryDto,
): PaginationQueryDto {
  const normalized = new PaginationQueryDto();
  normalized.page = pagination.page ?? 1;
  normalized.limit = pagination.limit ?? 20;
  return normalized;
}

function parseDate(value: unknown, fieldName: string): Date | null {
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

function parseExpectedDate(dto: UpdateStandpipeDto): Date {
  const value = dto.expectedUpdatedAt ?? dto.updatedAt;
  const expected = parseDate(value, 'expectedUpdatedAt');
  if (expected === null) {
    throw new BadRequestException('expectedUpdatedAt is required for updates');
  }
  const legacy = parseDate(dto.updatedAt, 'updatedAt');
  if (
    dto.expectedUpdatedAt !== undefined &&
    dto.updatedAt !== undefined &&
    legacy?.getTime() !== expected.getTime()
  ) {
    throw new BadRequestException('updatedAt aliases must match');
  }
  return expected;
}

function decimalInput(
  value: unknown,
  fieldName: string,
  minimum: number,
  maximum: number,
  allowNull = false,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null && allowNull) {
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
  if (
    Math.abs(numberValue * 100 - Math.round(numberValue * 100)) >
    Number.EPSILON * Math.max(1, Math.abs(numberValue * 100))
  ) {
    throw new BadRequestException(
      `${fieldName} must have at most two decimals`,
    );
  }
  return numberValue;
}

function textInput(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${fieldName} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new BadRequestException(`${fieldName} is required`);
  }
  return normalized;
}

@Injectable()
export class StandpipesService {
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

  private assertRoles(
    actor: AuthenticatedUser,
    allowed: readonly UserRole[],
    message: string,
  ): void {
    if (!allowed.includes(actor.role)) {
      throw new ForbiddenException(message);
    }
  }

  private assertReadRole(actor: AuthenticatedUser): void {
    this.assertRoles(
      actor,
      [
        UserRole.ADMIN,
        UserRole.DISPATCHER,
        UserRole.FIELD_TECHNICIAN,
        UserRole.STANDPIPE_OPERATOR,
      ],
      'This role cannot access Standpipes',
    );
  }

  private assertWriteRole(actor: AuthenticatedUser): void {
    this.assertRoles(
      actor,
      [UserRole.ADMIN, UserRole.DISPATCHER],
      'This role cannot modify Standpipes',
    );
  }

  private async operatorProfileForUser(
    client: PrismaService | TransactionClient,
    userId: string,
  ): Promise<string | null> {
    const row = await queryOne<RawRow>(
      this.raw(client),
      Prisma.sql`
        SELECT op.id
        FROM standpipe_operator_profiles op
        JOIN users u ON u.id = op.user_id
        WHERE op.user_id = ${userId}
          AND op.is_active = TRUE
          AND u.role = CAST(${UserRole.STANDPIPE_OPERATOR} AS "UserRole")
          AND u.status = CAST('ACTIVE' AS "UserStatus")
        LIMIT 1
      `,
    );
    if (!row) {
      return null;
    }
    return toStringValue(rowValue(row, 'id'), 'operator profile id');
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

  private async assertOperatorReference(
    client: PrismaService | TransactionClient,
    operatorProfileId: string,
  ): Promise<void> {
    const row = await queryOne<RawRow>(
      this.raw(client),
      Prisma.sql`
        SELECT
          op.id,
          op.is_active AS "operatorIsActive",
          u.status AS "userStatus"
        FROM standpipe_operator_profiles op
        JOIN users u ON u.id = op.user_id
        WHERE op.id = ${operatorProfileId}
          AND u.role = CAST(${UserRole.STANDPIPE_OPERATOR} AS "UserRole")
        LIMIT 1
      `,
    );
    if (!row) {
      throw new NotFoundException(
        `Operator profile ${operatorProfileId} was not found`,
      );
    }
    if (rowValue(row, 'operatorIsActive') === false) {
      throw new BadRequestException('An inactive operator cannot be assigned');
    }
    if (
      toStringValue(rowValue(row, 'userStatus'), 'operator user status') !==
      'ACTIVE'
    ) {
      throw new BadRequestException(
        'Only active operator users can be assigned',
      );
    }
  }

  private async validateReferences(
    client: PrismaService | TransactionClient,
    values: {
      kebeleId: string;
      neighborhoodId?: string | null;
      operatorProfileId?: string | null;
    },
  ): Promise<void> {
    await this.assertKebeleReference(client, values.kebeleId);
    if (values.neighborhoodId !== undefined && values.neighborhoodId !== null) {
      await this.assertNeighborhoodReference(
        client,
        values.neighborhoodId,
        values.kebeleId,
      );
    }
    if (
      values.operatorProfileId !== undefined &&
      values.operatorProfileId !== null
    ) {
      await this.assertOperatorReference(client, values.operatorProfileId);
    }
  }

  private mapOperator(row: RawRow): StandpipeOperatorDto | null {
    const profileId = rowValue(row, 'operatorProfileId', 'operator_profile_id');
    if (profileId === null || profileId === undefined) {
      return null;
    }
    const id = toStringValue(
      rowValue(row, 'operatorDetailId', 'operatorDetailId'),
      'operator profile id',
    );
    const userId = toStringValue(
      rowValue(row, 'operatorUserId', 'operatorUserId'),
      'operator user id',
    );
    return {
      id,
      userId,
      operatorCode: toStringValue(
        rowValue(row, 'operatorCode', 'operatorCode'),
        'operator code',
      ),
      licenseNumber: this.nullableString(
        rowValue(row, 'operatorLicenseNumber', 'operatorLicenseNumber'),
      ),
      isActive: toBoolean(
        rowValue(row, 'operatorIsActive', 'operatorIsActive'),
      ),
      user: {
        id: userId,
        displayName: toStringValue(
          rowValue(row, 'operatorDisplayName', 'operatorDisplayName'),
          'operator display name',
        ),
      },
    };
  }

  private mapStandpipe(row: RawRow): StandpipeResponseDto {
    const location = mapPoint(row, 'location');
    if (location === null) {
      throw new InternalServerErrorException('Standpipe location is missing');
    }
    return {
      id: toStringValue(rowValue(row, 'id'), 'standpipe id'),
      kebeleId: toStringValue(
        rowValue(row, 'kebeleId', 'kebele_id'),
        'standpipe kebeleId',
      ),
      neighborhoodId: this.nullableString(
        rowValue(row, 'neighborhoodId', 'neighborhood_id'),
      ),
      operatorProfileId: this.nullableString(
        rowValue(row, 'operatorProfileId', 'operator_profile_id'),
      ),
      code: toStringValue(rowValue(row, 'code'), 'standpipe code'),
      name: toStringValue(rowValue(row, 'name'), 'standpipe name'),
      location,
      elevationMeters: toNullableNumber(
        rowValue(row, 'elevationMeters', 'elevation_meters'),
      ),
      capacityLitersPerMinute: toNullableNumber(
        rowValue(row, 'capacityLitersPerMinute', 'capacity_liters_per_minute'),
      ),
      installedAt: toNullableDate(
        rowValue(row, 'installedAt', 'installed_at'),
        'installedAt',
      ),
      isActive: toBoolean(rowValue(row, 'isActive', 'is_active')),
      createdAt: toDate(rowValue(row, 'createdAt', 'created_at'), 'createdAt'),
      updatedAt: toDate(rowValue(row, 'updatedAt', 'updated_at'), 'updatedAt'),
      operator: this.mapOperator(row),
    };
  }

  private mapPublicStandpipe(row: RawRow): PublicStandpipeResponseDto {
    const location = mapPoint(row, 'location');
    if (location === null) {
      throw new InternalServerErrorException('Standpipe location is missing');
    }
    return {
      id: toStringValue(rowValue(row, 'id'), 'standpipe id'),
      kebeleId: toStringValue(
        rowValue(row, 'kebeleId', 'kebele_id'),
        'standpipe kebeleId',
      ),
      neighborhoodId: this.nullableString(
        rowValue(row, 'neighborhoodId', 'neighborhood_id'),
      ),
      code: toStringValue(rowValue(row, 'code'), 'standpipe code'),
      name: toStringValue(rowValue(row, 'name'), 'standpipe name'),
      location,
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

  private assertExpectedVersion(row: RawRow, expected: Date): void {
    const actual = toDate(
      rowValue(row, 'updatedAt', 'updated_at'),
      'updatedAt',
    );
    if (actual.getTime() !== expected.getTime()) {
      throw new ConflictException('Standpipe was updated by another request');
    }
  }

  private buildWhere(
    query: ListStandpipesQueryDto,
    actor: AuthenticatedUser,
    operatorProfileId: string | null,
  ): Prisma.Sql {
    if (query.assignedToMe === true && query.unassigned === true) {
      throw new BadRequestException(
        'assignedToMe and unassigned cannot both be true',
      );
    }
    const conditions: Prisma.Sql[] = [];
    if (actor.role === UserRole.STANDPIPE_OPERATOR) {
      if (operatorProfileId === null) {
        return Prisma.sql`FALSE`;
      }
      if (
        query.operatorProfileId !== undefined &&
        query.operatorProfileId !== operatorProfileId
      ) {
        throw new ForbiddenException(
          'Operators may only list their assigned Standpipes',
        );
      }
      conditions.push(Prisma.sql`s.operator_profile_id = ${operatorProfileId}`);
    } else if (query.operatorProfileId !== undefined) {
      conditions.push(
        Prisma.sql`s.operator_profile_id = ${query.operatorProfileId}`,
      );
    }
    if (query.assignedToMe === true) {
      conditions.push(
        operatorProfileId === null
          ? Prisma.sql`FALSE`
          : Prisma.sql`s.operator_profile_id = ${operatorProfileId}`,
      );
    }
    if (query.unassigned === true) {
      conditions.push(Prisma.sql`s.operator_profile_id IS NULL`);
    }
    if (query.kebeleId !== undefined) {
      conditions.push(Prisma.sql`s.kebele_id = ${query.kebeleId}`);
    }
    if (query.neighborhoodId !== undefined) {
      conditions.push(Prisma.sql`s.neighborhood_id = ${query.neighborhoodId}`);
    }
    if (actor.role === UserRole.STANDPIPE_OPERATOR) {
      conditions.push(Prisma.sql`s.is_active = TRUE`);
    } else if (query.isActive !== undefined) {
      conditions.push(Prisma.sql`s.is_active = ${query.isActive}`);
    }
    if (query.search !== undefined) {
      const pattern = `%${query.search.trim()}%`;
      conditions.push(
        Prisma.sql`(LOWER(s.name) LIKE LOWER(${pattern}) OR LOWER(s.code) LIKE LOWER(${pattern}))`,
      );
    }
    return whereSql(conditions);
  }

  private buildPublicWhere(query: ListStandpipesQueryDto): Prisma.Sql {
    if (
      query.operatorProfileId !== undefined ||
      query.assignedToMe !== undefined ||
      query.unassigned !== undefined
    ) {
      throw new BadRequestException(
        'Operator filters are not available for public Standpipe reads',
      );
    }
    const conditions: Prisma.Sql[] = [
      Prisma.sql`s.is_active = TRUE`,
      Prisma.sql`public_kebele.is_active = TRUE`,
      Prisma.sql`(s.neighborhood_id IS NULL OR public_neighborhood.is_active = TRUE)`,
    ];
    if (query.kebeleId !== undefined) {
      conditions.push(Prisma.sql`s.kebele_id = ${query.kebeleId}`);
    }
    if (query.neighborhoodId !== undefined) {
      conditions.push(Prisma.sql`s.neighborhood_id = ${query.neighborhoodId}`);
    }
    if (query.search !== undefined) {
      const pattern = `%${query.search.trim()}%`;
      conditions.push(
        Prisma.sql`(LOWER(s.name) LIKE LOWER(${pattern}) OR LOWER(s.code) LIKE LOWER(${pattern}))`,
      );
    }
    return whereSql(conditions);
  }

  async findAll(
    query: ListStandpipesQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PageResult<StandpipeResponseDto>> {
    this.assertReadRole(actor);
    const pagination = normalizePagination(query);
    const operatorProfileId =
      actor.role === UserRole.STANDPIPE_OPERATOR
        ? await this.operatorProfileForUser(this.prismaService, actor.id)
        : null;
    const where = this.buildWhere(query, actor, operatorProfileId);
    const client = this.raw();
    const [rows, countRow] = await Promise.all([
      queryRows<RawRow>(
        client,
        Prisma.sql`${STANDPIPE_SELECT} WHERE ${where} ORDER BY s.name ASC, s.id ASC LIMIT ${pagination.take} OFFSET ${pagination.skip}`,
      ),
      queryOne<RawRow>(
        client,
        Prisma.sql`SELECT COUNT(*)::int AS "count" FROM standpipes s WHERE ${where}`,
      ),
    ]);
    const total = toNumber(rowValue(countRow ?? {}, 'count'), 'count');
    return paginated(
      rows.map((row) => this.mapStandpipe(row)),
      total,
      pagination,
    );
  }

  async findPublicAll(
    query: ListStandpipesQueryDto = new ListStandpipesQueryDto(),
  ): Promise<PageResult<PublicStandpipeResponseDto>> {
    const pagination = normalizePagination(query);
    const where = this.buildPublicWhere(query);
    const client = this.raw();
    const [rows, countRow] = await Promise.all([
      queryRows<RawRow>(
        client,
        Prisma.sql`
          ${PUBLIC_STANDPIPE_SELECT}
          WHERE ${where}
          ORDER BY s.name ASC, s.id ASC
          LIMIT ${pagination.take} OFFSET ${pagination.skip}
        `,
      ),
      queryOne<RawRow>(
        client,
        Prisma.sql`
          SELECT COUNT(*)::int AS "count"
          FROM standpipes s
          JOIN kebeles AS public_kebele ON public_kebele.id = s.kebele_id
          LEFT JOIN neighborhoods AS public_neighborhood
            ON public_neighborhood.id = s.neighborhood_id
           AND public_neighborhood.kebele_id = s.kebele_id
          WHERE ${where}
        `,
      ),
    ]);
    const total = toNumber(rowValue(countRow ?? {}, 'count'), 'count');
    return paginated(
      rows.map((row) => this.mapPublicStandpipe(row)),
      total,
      pagination,
    );
  }

  async findPublicOne(id: string): Promise<PublicStandpipeResponseDto> {
    const standpipeId = assertId(id, 'id');
    const row = await queryOne<RawRow>(
      this.raw(),
      Prisma.sql`
        ${PUBLIC_STANDPIPE_SELECT}
        WHERE s.id = ${standpipeId}
          AND s.is_active = TRUE
          AND public_kebele.is_active = TRUE
          AND (
            s.neighborhood_id IS NULL
            OR public_neighborhood.is_active = TRUE
          )
        LIMIT 1
      `,
    );
    if (!row) {
      throw new NotFoundException(`Standpipe ${standpipeId} was not found`);
    }
    return this.mapPublicStandpipe(row);
  }

  async findOne(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<StandpipeResponseDto> {
    this.assertReadRole(actor);
    const standpipeId = assertId(id, 'id');
    const row = await queryOne<RawRow>(
      this.raw(),
      Prisma.sql`${STANDPIPE_SELECT} WHERE s.id = ${standpipeId} LIMIT 1`,
    );
    if (!row) {
      throw new NotFoundException(`Standpipe ${standpipeId} was not found`);
    }
    if (actor.role === UserRole.STANDPIPE_OPERATOR) {
      const operatorProfileId = await this.operatorProfileForUser(
        this.prismaService,
        actor.id,
      );
      if (
        rowValue(row, 'isActive', 'is_active') !== true ||
        operatorProfileId === null ||
        this.nullableString(rowValue(row, 'operatorProfileId')) !==
          operatorProfileId
      ) {
        throw new NotFoundException(`Standpipe ${standpipeId} was not found`);
      }
    }
    return this.mapStandpipe(row);
  }

  async create(
    dto: CreateStandpipeDto,
    actor: AuthenticatedUser,
  ): Promise<StandpipeResponseDto> {
    this.assertWriteRole(actor);
    if (dto.operatorProfileId !== undefined && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only administrators can assign operators');
    }
    const kebeleId = assertId(dto.kebeleId, 'kebeleId');
    const neighborhoodId = optionalId(dto.neighborhoodId, 'neighborhoodId');
    const operatorProfileId = optionalId(
      dto.operatorProfileId,
      'operatorProfileId',
    );
    assertPoint(dto.location, 'location');
    const elevationMeters = decimalInput(
      dto.elevationMeters,
      'elevationMeters',
      -9999999.99,
      9999999.99,
      true,
    );
    const capacityLitersPerMinute = decimalInput(
      dto.capacityLitersPerMinute,
      'capacityLitersPerMinute',
      0.01,
      99999999.99,
      true,
    );
    const installedAt = parseDateOnly(
      dto.installedAt,
      'installedAt',
      this.timezone(),
      undefined,
      true,
    );
    const id = randomUUID();
    return runInTransaction(this.prismaService, async (client) => {
      await this.validateReferences(client, {
        kebeleId,
        neighborhoodId,
        operatorProfileId,
      });
      const inserted = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`
          INSERT INTO standpipes
            (id, kebele_id, neighborhood_id, operator_profile_id, code, name,
             location, elevation_meters, capacity_liters_per_minute, installed_at,
             is_active, created_at, updated_at)
          VALUES
            (${id}, ${kebeleId}, ${neighborhoodId ?? null},
             ${operatorProfileId ?? null}, ${textInput(dto.code, 'code')},
             ${textInput(dto.name, 'name')}, ${pointSql(dto.location, 'location')},
             ${elevationMeters ?? null}, ${capacityLitersPerMinute ?? null},
             ${installedAt}, ${dto.isActive ?? true},
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id
        `,
      );
      if (!inserted) {
        throw new InternalServerErrorException(
          'Standpipe could not be created',
        );
      }
      const row = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`${STANDPIPE_SELECT} WHERE s.id = ${id} LIMIT 1`,
      );
      if (!row) {
        throw new InternalServerErrorException(
          'Created Standpipe could not be read',
        );
      }
      return this.mapStandpipe(row);
    });
  }

  async update(
    id: string,
    dto: UpdateStandpipeDto,
    actor: AuthenticatedUser,
  ): Promise<StandpipeResponseDto> {
    this.assertWriteRole(actor);
    if (dto.operatorProfileId !== undefined && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only administrators can assign operators');
    }
    const standpipeId = assertId(id, 'id');
    const expected = parseExpectedDate(dto);
    return runInTransaction(this.prismaService, async (client) => {
      const current = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`${STANDPIPE_SELECT} WHERE s.id = ${standpipeId} LIMIT 1 FOR UPDATE OF s`,
      );
      if (!current) {
        throw new NotFoundException(`Standpipe ${standpipeId} was not found`);
      }
      this.assertExpectedVersion(current, expected);
      const kebeleId =
        dto.kebeleId === undefined
          ? toStringValue(rowValue(current, 'kebeleId'), 'kebeleId')
          : assertId(dto.kebeleId, 'kebeleId');
      const neighborhoodId =
        dto.neighborhoodId === undefined
          ? this.nullableString(rowValue(current, 'neighborhoodId'))
          : optionalId(dto.neighborhoodId, 'neighborhoodId');
      const operatorProfileId =
        dto.operatorProfileId === undefined
          ? this.nullableString(rowValue(current, 'operatorProfileId'))
          : optionalId(dto.operatorProfileId, 'operatorProfileId');
      if (dto.kebeleId !== undefined) {
        await this.assertKebeleReference(client, kebeleId);
      }
      if (
        (dto.kebeleId !== undefined || dto.neighborhoodId !== undefined) &&
        neighborhoodId !== undefined &&
        neighborhoodId !== null
      ) {
        await this.assertNeighborhoodReference(
          client,
          neighborhoodId,
          kebeleId,
        );
      }
      if (
        dto.operatorProfileId !== undefined &&
        operatorProfileId !== undefined &&
        operatorProfileId !== null
      ) {
        await this.assertOperatorReference(client, operatorProfileId);
      }
      if (dto.location !== undefined) {
        assertPoint(dto.location, 'location');
      }
      const assignments: Prisma.Sql[] = [];
      if (dto.kebeleId !== undefined) {
        assignments.push(Prisma.sql`kebele_id = ${kebeleId}`);
      }
      if (dto.neighborhoodId !== undefined) {
        assignments.push(
          neighborhoodId === null
            ? Prisma.sql`neighborhood_id = NULL`
            : Prisma.sql`neighborhood_id = ${neighborhoodId}`,
        );
      }
      if (dto.operatorProfileId !== undefined) {
        assignments.push(
          operatorProfileId === null
            ? Prisma.sql`operator_profile_id = NULL`
            : Prisma.sql`operator_profile_id = ${operatorProfileId}`,
        );
      }
      if (dto.code !== undefined) {
        assignments.push(Prisma.sql`code = ${textInput(dto.code, 'code')}`);
      }
      if (dto.name !== undefined) {
        assignments.push(Prisma.sql`name = ${textInput(dto.name, 'name')}`);
      }
      if (dto.location !== undefined) {
        assignments.push(
          Prisma.sql`location = ${pointSql(dto.location, 'location')}`,
        );
      }
      if (dto.elevationMeters !== undefined) {
        assignments.push(
          Prisma.sql`elevation_meters = ${decimalInput(dto.elevationMeters, 'elevationMeters', -9999999.99, 9999999.99, true)}`,
        );
      }
      if (dto.capacityLitersPerMinute !== undefined) {
        assignments.push(
          Prisma.sql`capacity_liters_per_minute = ${decimalInput(dto.capacityLitersPerMinute, 'capacityLitersPerMinute', 0.01, 99999999.99, true)}`,
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
          UPDATE standpipes AS s
          SET ${joinSql(assignments, Prisma.sql`, `)}
          WHERE s.id = ${standpipeId} AND date_trunc('milliseconds', s.updated_at) = ${expected}
          RETURNING s.id
        `,
      );
      if (!updated) {
        throw new ConflictException('Standpipe was updated by another request');
      }
      const result = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`${STANDPIPE_SELECT} WHERE s.id = ${standpipeId} LIMIT 1`,
      );
      if (!result) {
        throw new InternalServerErrorException(
          'Updated Standpipe could not be read',
        );
      }
      return this.mapStandpipe(result);
    });
  }

  async assignOperator(
    id: string,
    operatorProfileId: string | null,
    expectedUpdatedAt: string,
    actor: AuthenticatedUser,
  ): Promise<StandpipeResponseDto> {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only administrators can assign operators');
    }
    return this.update(
      id,
      {
        operatorProfileId,
        expectedUpdatedAt,
      },
      actor,
    );
  }

  async deactivate(
    id: string,
    dto: { expectedUpdatedAt?: string; updatedAt?: string },
    actor: AuthenticatedUser,
  ): Promise<StandpipeResponseDto> {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only administrators can deactivate Standpipes',
      );
    }
    const standpipeId = assertId(id, 'id');
    const expected = parseExpectedDate(dto);
    return runInTransaction(this.prismaService, async (client) => {
      const current = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`${STANDPIPE_SELECT} WHERE s.id = ${standpipeId} LIMIT 1 FOR UPDATE OF s`,
      );
      if (!current) {
        throw new NotFoundException(`Standpipe ${standpipeId} was not found`);
      }
      this.assertExpectedVersion(current, expected);
      if (toBoolean(rowValue(current, 'isActive', 'is_active'))) {
        const updated = await queryOne<RawRow>(
          this.raw(client),
          Prisma.sql`
            UPDATE standpipes AS s
            SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE s.id = ${standpipeId}
              AND date_trunc('milliseconds', s.updated_at) = ${expected}
            RETURNING s.id
          `,
        );
        if (!updated) {
          throw new ConflictException(
            'Standpipe was updated by another request',
          );
        }
      }
      const result = await queryOne<RawRow>(
        this.raw(client),
        Prisma.sql`${STANDPIPE_SELECT} WHERE s.id = ${standpipeId} LIMIT 1`,
      );
      if (!result) {
        throw new InternalServerErrorException(
          'Deactivated Standpipe could not be read',
        );
      }
      return this.mapStandpipe(result);
    });
  }

  async listOperators(
    query: ListOperatorsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PageResult<StandpipeOperatorDto>> {
    this.assertRoles(
      actor,
      [UserRole.ADMIN, UserRole.DISPATCHER],
      'This role cannot list operators',
    );
    if (
      query.page < 1 ||
      query.limit < 1 ||
      query.limit > 100 ||
      !Number.isInteger(query.page) ||
      !Number.isInteger(query.limit)
    ) {
      throw new BadRequestException('Invalid operator pagination');
    }
    const pagination = normalizePagination(query);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`u.role = CAST(${UserRole.STANDPIPE_OPERATOR} AS "UserRole")`,
      Prisma.sql`u.status = CAST('ACTIVE' AS "UserStatus")`,
    ];
    if (query.isActive !== undefined) {
      conditions.push(Prisma.sql`op.is_active = ${query.isActive}`);
    }
    if (query.search !== undefined) {
      const pattern = `%${query.search.trim()}%`;
      conditions.push(
        Prisma.sql`(LOWER(op.operator_code) LIKE LOWER(${pattern}) OR LOWER(u.display_name) LIKE LOWER(${pattern}) OR LOWER(op.license_number) LIKE LOWER(${pattern}))`,
      );
    }
    const where = whereSql(conditions);
    const client = this.raw();
    const [rows, countRow] = await Promise.all([
      queryRows<RawRow>(
        client,
        Prisma.sql`
          SELECT
            op.id,
            op.user_id AS "userId",
            op.operator_code AS "operatorCode",
            op.license_number AS "licenseNumber",
            op.is_active AS "isActive",
            u.id AS "userDetailId",
            u.display_name AS "displayName"
          FROM standpipe_operator_profiles op
          JOIN users u ON u.id = op.user_id
          WHERE ${where}
          ORDER BY op.operator_code ASC, op.id ASC
          LIMIT ${pagination.take} OFFSET ${pagination.skip}
        `,
      ),
      queryOne<RawRow>(
        client,
        Prisma.sql`
          SELECT COUNT(*)::int AS "count"
          FROM standpipe_operator_profiles op
          JOIN users u ON u.id = op.user_id
          WHERE ${where}
        `,
      ),
    ]);
    const total = toNumber(rowValue(countRow ?? {}, 'count'), 'count');
    const items = rows.map((row) => {
      const userId = toStringValue(rowValue(row, 'userId'), 'operator userId');
      return {
        id: toStringValue(rowValue(row, 'id'), 'operator id'),
        userId,
        operatorCode: toStringValue(
          rowValue(row, 'operatorCode'),
          'operatorCode',
        ),
        licenseNumber: this.nullableString(rowValue(row, 'licenseNumber')),
        isActive: toBoolean(rowValue(row, 'isActive')),
        user: {
          id: userId,
          displayName: toStringValue(
            rowValue(row, 'displayName'),
            'operator displayName',
          ),
        },
      };
    });
    return paginated(items, total, pagination);
  }
}
