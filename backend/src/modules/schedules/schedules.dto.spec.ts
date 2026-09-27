import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  RotationWindowInputDto,
  UpdateRotationScheduleDto,
} from './schedules.dto.js';

async function validationErrors<T extends object>(
  value: unknown,
  type: new () => T,
) {
  return validate(plainToInstance(type, value));
}

describe('schedules DTO validation', () => {
  it.each(['updatedAt', 'kebeleId', 'name', 'startsOn', 'endsOn', 'windows'])(
    'rejects null for non-nullable update field %s',
    async (field) => {
      const errors = await validationErrors(
        {
          updatedAt: '2026-09-25T00:00:00.000Z',
          [field]: null,
        },
        UpdateRotationScheduleDto,
      );

      expect(errors.some((error) => error.property === field)).toBe(true);
    },
  );

  it('allows omitted update fields and nullable notes', async () => {
    const errors = await validationErrors(
      {
        updatedAt: '2026-09-25T00:00:00.000Z',
        notes: null,
      },
      UpdateRotationScheduleDto,
    );

    expect(errors).toHaveLength(0);
  });

  it('rejects pressure values outside the database range and precision', async () => {
    const errors = await validationErrors(
      {
        standpipeId: null,
        startsAt: '2026-09-25T08:00:00.000Z',
        endsAt: '2026-09-25T09:00:00.000Z',
        minimumPressureBar: 0.0001,
        maximumPressureBar: 10000,
      },
      RotationWindowInputDto,
    );

    expect(errors.length).toBeGreaterThan(0);
  });
});
