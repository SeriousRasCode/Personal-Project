import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../database/prisma.service.js';
import { ActiveSearchQueryDto } from './dto/common.dto.js';
import { parseDateOnly } from './date-only.js';
import { GeographyService } from './geography.service.js';

const kebeleId = '11111111-1111-4111-8111-111111111111';
const nextKebeleId = '22222222-2222-4222-8222-222222222222';
const neighborhoodId = '33333333-3333-4333-8333-333333333333';
const standpipeId = '44444444-4444-4444-8444-444444444444';
const timestamp = new Date('2026-09-25T10:00:00.000Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: kebeleId,
    name: 'Kebele 1',
    code: 'KB-1',
    population: 1000,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    centerLongitude: 36.8,
    centerLatitude: 7.6,
    centerGeoJson: { type: 'Point', coordinates: [36.8, 7.6] },
    boundaryGeoJson: null,
    ...overrides,
  };
}

function neighborhoodRow(overrides: Record<string, unknown> = {}) {
  return {
    id: neighborhoodId,
    kebeleId,
    name: 'Neighborhood 1',
    code: 'N-1',
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    centerLongitude: 36.8,
    centerLatitude: 7.6,
    centerGeoJson: { type: 'Point', coordinates: [36.8, 7.6] },
    boundaryGeoJson: null,
    ...overrides,
  };
}

describe('GeographyService', () => {
  const queryRaw = vi.fn();
  const service = new GeographyService(
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

  it('paginates and maps raw geography rows', async () => {
    queryRaw
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([{ count: 1 }]);
    const query = new ActiveSearchQueryDto();
    query.page = 2;
    query.limit = 10;
    query.isActive = true;

    const result = await service.findAllKebeles(query);

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: kebeleId,
          center: { longitude: 36.8, latitude: 7.6 },
        }),
      ],
      meta: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });
    const listQuery = queryRaw.mock.calls[0]?.[0] as { text: string };
    expect(listQuery.text).toContain('ORDER BY k.name ASC, k.id ASC');
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('forces public geography reads to active records and sanitizes fields', async () => {
    queryRaw
      .mockResolvedValueOnce([row({ isActive: false })])
      .mockResolvedValueOnce([{ count: 1 }]);
    const query = new ActiveSearchQueryDto();
    query.isActive = false;

    const result = await service.findPublicAllKebeles(query);

    expect(result.items[0]).toEqual({
      id: kebeleId,
      name: 'Kebele 1',
      code: 'KB-1',
      population: 1000,
      center: { longitude: 36.8, latitude: 7.6 },
      boundary: null,
    });
    const listQuery = queryRaw.mock.calls[0]?.[0] as {
      text: string;
      values: unknown[];
    };
    expect(listQuery.text).toContain('k.is_active =');
    expect(listQuery.values).toContain(true);
    expect(listQuery.values).not.toContain(false);
  });

  it('rejects stale updates with a conflict', async () => {
    queryRaw.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]);

    await expect(
      service.updateKebele(kebeleId, {
        expectedUpdatedAt: timestamp.toISOString(),
        name: 'Updated',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reparents all related Standpipes in the same optimistic transaction', async () => {
    queryRaw
      .mockResolvedValueOnce([neighborhoodRow()])
      .mockResolvedValueOnce([{ id: nextKebeleId, isActive: true }])
      .mockResolvedValueOnce([{ id: standpipeId, updatedAt: timestamp }])
      .mockResolvedValueOnce([{ id: standpipeId }])
      .mockResolvedValueOnce([{ id: neighborhoodId }])
      .mockResolvedValueOnce([neighborhoodRow({ kebeleId: nextKebeleId })]);

    const result = await service.updateNeighborhood(neighborhoodId, {
      kebeleId: nextKebeleId,
      expectedUpdatedAt: timestamp.toISOString(),
    });

    expect(result.kebeleId).toBe(nextKebeleId);
    const reparentQuery = queryRaw.mock.calls[3]?.[0] as { text: string };
    expect(reparentQuery.text).toContain('UPDATE standpipes');
    expect(reparentQuery.text).toContain('updated_at = CURRENT_TIMESTAMP');
    expect(queryRaw).toHaveBeenCalledTimes(6);
  });

  it('rolls back reparenting when a related Standpipe version changes', async () => {
    queryRaw
      .mockResolvedValueOnce([neighborhoodRow()])
      .mockResolvedValueOnce([{ id: nextKebeleId, isActive: true }])
      .mockResolvedValueOnce([{ id: standpipeId, updatedAt: timestamp }])
      .mockResolvedValueOnce([]);

    await expect(
      service.updateNeighborhood(neighborhoodId, {
        kebeleId: nextKebeleId,
        expectedUpdatedAt: timestamp.toISOString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('uses the application timezone for date-only future checks', () => {
    const current = DateTime.fromISO('2026-09-25T23:30:00Z');

    expect(
      parseDateOnly(
        '2026-09-26',
        'installedAt',
        'Africa/Addis_Ababa',
        current,
        true,
      ),
    ).toBe('2026-09-26');
    expect(() =>
      parseDateOnly(
        '2026-09-27',
        'installedAt',
        'Africa/Addis_Ababa',
        current,
        true,
      ),
    ).toThrow();
    expect(() =>
      parseDateOnly('2026-02-30', 'installedAt', 'Africa/Addis_Ababa'),
    ).toThrow();
  });
});
