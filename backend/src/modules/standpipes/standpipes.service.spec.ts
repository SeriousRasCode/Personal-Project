import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { UserRole, UserStatus } from '../../generated/prisma/enums.js';
import { ListStandpipesQueryDto } from './dto/standpipe-query.dto.js';
import { UpdateStandpipeDto } from './dto/standpipe.dto.js';
import { StandpipesService } from './standpipes.service.js';

const standpipeId = '11111111-1111-4111-8111-111111111111';
const kebeleId = '22222222-2222-4222-8222-222222222222';
const neighborhoodId = '33333333-3333-4333-8333-333333333333';
const otherNeighborhoodId = '44444444-4444-4444-8444-444444444444';
const operatorId = '55555555-5555-4555-8555-555555555555';
const operatorUserId = '66666666-6666-4666-8666-666666666666';
const timestamp = new Date('2026-09-25T10:00:00.000Z');

function actor(role: UserRole, id = operatorUserId): AuthenticatedUser {
  return {
    id,
    phone: '+251700000000',
    displayName: role,
    role,
    status: UserStatus.ACTIVE,
    locale: 'en',
    lastLoginAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function standpipeRow(
  operatorProfileId: string | null = operatorId,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: standpipeId,
    kebeleId,
    neighborhoodId,
    operatorProfileId,
    code: 'SP-1',
    name: 'Standpipe 1',
    locationLongitude: 36.8,
    locationLatitude: 7.6,
    locationGeoJson: { type: 'Point', coordinates: [36.8, 7.6] },
    elevationMeters: '1200.25',
    capacityLitersPerMinute: '15.50',
    installedAt: new Date('2026-01-01T00:00:00.000Z'),
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    operatorDetailId: operatorProfileId,
    operatorUserId: operatorProfileId === null ? null : operatorUserId,
    operatorCode: operatorProfileId === null ? null : 'OP-1',
    operatorLicenseNumber: operatorProfileId === null ? null : 'LIC-1',
    operatorIsActive: operatorProfileId === null ? null : true,
    operatorDisplayName: operatorProfileId === null ? null : 'Operator One',
    ...overrides,
  };
}

describe('StandpipesService', () => {
  const queryRaw = vi.fn();
  const service = new StandpipesService(
    {
      $queryRaw: queryRaw,
      $transaction: vi.fn((callback: (client: unknown) => unknown) =>
        callback({ $queryRaw: queryRaw }),
      ),
    } as unknown as PrismaService,
    new ConfigService({ appTimezone: 'Africa/Addis_Ababa' }),
  );

  beforeEach(() => {
    queryRaw.mockReset();
  });

  it('restricts operator lists to the active operator profile', async () => {
    queryRaw
      .mockResolvedValueOnce([{ id: operatorId }])
      .mockResolvedValueOnce([standpipeRow()])
      .mockResolvedValueOnce([{ count: 1 }]);

    const result = await service.findAll(
      new ListStandpipesQueryDto(),
      actor(UserRole.STANDPIPE_OPERATOR),
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].operator).toEqual(
      expect.objectContaining({
        id: operatorId,
        user: { id: operatorUserId, displayName: 'Operator One' },
      }),
    );
    const listQuery = queryRaw.mock.calls[1]?.[0] as {
      text: string;
      values: unknown[];
    };
    expect(listQuery.text).toContain('s.operator_profile_id');
    expect(listQuery.values).toContain(operatorId);
  });

  it('hides unassigned Standpipes from operators', async () => {
    queryRaw
      .mockResolvedValueOnce([standpipeRow(null)])
      .mockResolvedValueOnce([{ id: operatorId }]);

    await expect(
      service.findOne(standpipeId, actor(UserRole.STANDPIPE_OPERATOR)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns only active, sanitized fields for public reads', async () => {
    queryRaw
      .mockResolvedValueOnce([standpipeRow(operatorId, { isActive: false })])
      .mockResolvedValueOnce([{ count: 1 }]);

    const result = await service.findPublicAll(new ListStandpipesQueryDto());

    expect(result.items[0]).toEqual({
      id: standpipeId,
      kebeleId,
      neighborhoodId,
      code: 'SP-1',
      name: 'Standpipe 1',
      location: { longitude: 36.8, latitude: 7.6 },
    });
    const listQuery = queryRaw.mock.calls[0]?.[0] as {
      text: string;
      values: unknown[];
    };
    expect(listQuery.text).toContain('s.is_active = TRUE');
    expect(listQuery.text).toContain('ORDER BY s.name ASC, s.id ASC');
    expect(listQuery.text).not.toContain('operatorLicenseNumber');
  });

  it('deactivates without issuing a hard delete', async () => {
    queryRaw
      .mockResolvedValueOnce([standpipeRow()])
      .mockResolvedValueOnce([{ id: standpipeId }])
      .mockResolvedValueOnce([standpipeRow(operatorId, { isActive: false })]);

    const result = await service.deactivate(
      standpipeId,
      { expectedUpdatedAt: timestamp.toISOString() },
      actor(UserRole.ADMIN),
    );

    expect(result.isActive).toBe(false);
    const statements = queryRaw.mock.calls.map(
      (call) => (call[0] as { text: string }).text,
    );
    expect(
      statements.some((statement) =>
        statement.includes('DELETE FROM standpipes'),
      ),
    ).toBe(false);
    expect(
      statements.some((statement) => statement.includes('UPDATE standpipes')),
    ).toBe(true);
  });

  it('prevents dispatchers from assigning operators', async () => {
    await expect(
      service.assignOperator(
        standpipeId,
        operatorId,
        timestamp.toISOString(),
        actor(UserRole.DISPATCHER),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a Neighborhood from another Kebele', async () => {
    queryRaw
      .mockResolvedValueOnce([{ id: kebeleId, isActive: true }])
      .mockResolvedValueOnce([
        {
          id: otherNeighborhoodId,
          kebeleId: otherNeighborhoodId,
          isActive: true,
        },
      ]);

    await expect(
      service.create(
        {
          kebeleId,
          neighborhoodId: otherNeighborhoodId,
          code: 'SP-2',
          name: 'Standpipe 2',
          location: { longitude: 36.8, latitude: 7.6 },
        },
        actor(UserRole.ADMIN),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects null and non-boolean DTO filters', async () => {
    const updateErrors = await validate(
      plainToInstance(UpdateStandpipeDto, {
        expectedUpdatedAt: null,
        isActive: null,
        name: null,
      }),
    );
    expect(updateErrors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['expectedUpdatedAt', 'isActive', 'name']),
    );

    const queryErrors = await validate(
      plainToInstance(ListStandpipesQueryDto, {
        isActive: 'yes',
        assignedToMe: null,
      }),
    );
    expect(queryErrors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['isActive', 'assignedToMe']),
    );
  });
});
