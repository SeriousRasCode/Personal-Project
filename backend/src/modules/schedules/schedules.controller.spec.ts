import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { UserRole } from '../../generated/prisma/enums.js';
import { SchedulesController } from './schedules.controller.js';
import { SchedulesService } from './schedules.service.js';
import { ListRotationSchedulesDto } from './schedules.dto.js';

describe('schedule management list', () => {
  it('requires administrative or dispatcher access and is not a public route', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, SchedulesController.prototype.listStaff),
    ).toEqual([UserRole.DISPATCHER, UserRole.ADMIN]);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        SchedulesController.prototype.listStaff,
      ),
    ).not.toBe(true);
  });

  it('passes the authenticated role to the service so drafts and versions can be included', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const controller = new SchedulesController({
      list,
    } as unknown as SchedulesService);
    const query = new ListRotationSchedulesDto();
    const request = { user: { id: 'test-admin', role: UserRole.ADMIN } };
    await controller.listStaff(query, request);
    expect(list).toHaveBeenCalledWith(query, request);
  });

  it('retains the public-only filter on the existing public endpoint', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const controller = new SchedulesController({
      list,
    } as unknown as SchedulesService);
    const query = new ListRotationSchedulesDto();
    await controller.list(query);
    expect(list).toHaveBeenCalledWith(query, { publicOnly: true });
  });
});
