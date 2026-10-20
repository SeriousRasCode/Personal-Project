import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkOrdersService } from './work-orders.service.js';
import { UserRole } from '../../generated/prisma/enums.js';

describe('work order record access', () => {
  function setup(assignedToId: string | null) {
    const prisma = {
      workOrder: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'order', assignedToId, assignedTo: null }),
      },
      workOrderActivity: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const service = new WorkOrdersService(prisma as never, {} as never);
    return { service, prisma };
  }
  for (const role of [UserRole.FIELD_TECHNICIAN, UserRole.STANDPIPE_OPERATOR]) {
    it(`${role} cannot read another person's order or history`, async () => {
      const { service, prisma } = setup('someone-else');
      const actor = { id: 'me', role };
      await expect(
        service.findWorkOrder('order', actor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.listActivities('order', {} as never, actor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.workOrderActivity.findMany).not.toHaveBeenCalled();
    });
    it(`${role} can read their own order`, async () => {
      const { service } = setup('me');
      await expect(
        service.findWorkOrder('order', { id: 'me', role }),
      ).resolves.toMatchObject({ id: 'order' });
    });
  }
  for (const role of [UserRole.ADMIN, UserRole.DISPATCHER]) {
    it(`${role} can read orders assigned to others`, async () => {
      const { service } = setup('someone-else');
      await expect(
        service.findWorkOrder('order', { id: 'me', role }),
      ).resolves.toMatchObject({ id: 'order' });
    });
  }
});
