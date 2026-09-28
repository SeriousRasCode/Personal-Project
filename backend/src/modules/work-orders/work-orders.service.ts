import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { paginated, type PageResult } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  UserRole,
  UserStatus,
  WorkOrderStatus,
} from '../../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import {
  CreateWorkOrderDto,
  ListWorkOrderActivitiesQueryDto,
  ListWorkOrdersQueryDto,
  UpdateWorkOrderDto,
  UpdateWorkOrderStatusDto,
  WorkOrderAssigneeDto,
} from './dto/work-order.dto.js';
import {
  WorkOrderActivityResponseDto,
  WorkOrderResponseDto,
} from './dto/work-order-response.dto.js';
import {
  assertWorkOrderTransition,
  canActOnWorkOrder,
  isSupervisoryRole,
  nextWorkOrderTimestamps,
} from './work-order-status.js';

export const WORK_ORDER_OUTBOX_EVENT_TYPES = {
  workOrderCreated: 'work_order.created',
  workOrderStatusChanged: 'work_order.status_changed',
} as const;

const ASSIGNABLE_ROLES: readonly UserRole[] = [
  UserRole.FIELD_TECHNICIAN,
  UserRole.STANDPIPE_OPERATOR,
  UserRole.DISPATCHER,
];

export interface WorkOrderActor {
  id: string;
  role: UserRole;
}

const WORK_ORDER_INCLUDE = {
  assignedTo: { select: { id: true, displayName: true, role: true } },
} satisfies Prisma.WorkOrderInclude;

type WorkOrderWithAssignee = Prisma.WorkOrderGetPayload<{
  include: typeof WORK_ORDER_INCLUDE;
}>;

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private inTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  private workOrderCode(id: string): string {
    return `WO-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }

  private async assertAssignable(assignedToId: string | null): Promise<void> {
    if (assignedToId === null) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: assignedToId },
      select: { role: true, status: true },
    });

    if (!user) {
      throw new BadRequestException('assignedToId does not reference a user');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('The assignee is not an active user');
    }

    if (!ASSIGNABLE_ROLES.includes(user.role)) {
      throw new BadRequestException(
        'A work order can only be assigned to a field technician, standpipe operator, or dispatcher',
      );
    }
  }

  private assertExpectedVersion(
    expectedUpdatedAt: Date,
    actualUpdatedAt: Date,
  ): void {
    if (expectedUpdatedAt.getTime() !== actualUpdatedAt.getTime()) {
      throw new ConflictException(
        'The work order was modified by someone else, reload and retry',
      );
    }
  }

  async createWorkOrder(
    dto: CreateWorkOrderDto,
    actor: WorkOrderActor,
  ): Promise<WorkOrderResponseDto> {
    const assignedToId = dto.assignedToId ?? null;
    await this.assertAssignable(assignedToId);

    if (dto.leakClusterId) {
      const cluster = await this.prisma.leakCluster.findUnique({
        where: { id: dto.leakClusterId },
        select: { id: true },
      });
      if (!cluster) {
        throw new BadRequestException('leakClusterId does not exist');
      }
    }

    const id = randomUUID();
    const status =
      assignedToId === null ? WorkOrderStatus.OPEN : WorkOrderStatus.ASSIGNED;

    const created = await this.inTransaction(async (tx) => {
      const workOrder = await tx.workOrder.create({
        data: {
          id,
          code: this.workOrderCode(id),
          leakClusterId: dto.leakClusterId ?? null,
          createdById: actor.id,
          assignedToId,
          title: dto.title.trim(),
          description: dto.description.trim(),
          priority: dto.priority,
          status,
          scheduledFor: dto.scheduledFor ?? null,
        },
        include: WORK_ORDER_INCLUDE,
      });

      await tx.workOrderActivity.create({
        data: {
          workOrderId: workOrder.id,
          actorId: actor.id,
          fromStatus: null,
          toStatus: status,
          note: null,
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'WorkOrder',
          aggregateId: workOrder.id,
          eventType: WORK_ORDER_OUTBOX_EVENT_TYPES.workOrderCreated,
          payload: {
            workOrderId: workOrder.id,
            leakClusterId: workOrder.leakClusterId,
            assignedToId: workOrder.assignedToId,
            priority: workOrder.priority,
            status: workOrder.status,
          },
        },
      });

      return workOrder;
    });

    await this.audit.record(
      {
        action: 'work_order.created',
        entityType: 'WorkOrder',
        entityId: created.id,
        metadata: {
          code: created.code,
          leakClusterId: created.leakClusterId,
          assignedToId: created.assignedToId,
          priority: created.priority,
        },
      },
      actor,
    );

    return this.mapWorkOrder(created);
  }

  async listWorkOrders(
    query: ListWorkOrdersQueryDto,
    actor: WorkOrderActor,
  ): Promise<PageResult<WorkOrderResponseDto>> {
    const where: Prisma.WorkOrderWhereInput = {};

    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.priority !== undefined) {
      where.priority = query.priority;
    }
    if (query.leakClusterId !== undefined) {
      where.leakClusterId = query.leakClusterId;
    }
    if (query.assignedToId !== undefined) {
      where.assignedToId = query.assignedToId;
    }

    if (!isSupervisoryRole(actor.role)) {
      where.assignedToId = actor.id;
    }

    const [rows, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        include: WORK_ORDER_INCLUDE,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    return paginated(
      rows.map((row) => this.mapWorkOrder(row)),
      total,
      query,
    );
  }

  async findWorkOrder(id: string): Promise<WorkOrderResponseDto> {
    const row = await this.prisma.workOrder.findUnique({
      where: { id },
      include: WORK_ORDER_INCLUDE,
    });

    if (!row) {
      throw new NotFoundException('Work order not found');
    }

    return this.mapWorkOrder(row);
  }

  async listActivities(
    workOrderId: string,
    query: ListWorkOrderActivitiesQueryDto,
  ): Promise<PageResult<WorkOrderActivityResponseDto>> {
    await this.assertExists(workOrderId);

    const where: Prisma.WorkOrderActivityWhereInput = { workOrderId };
    const [rows, total] = await Promise.all([
      this.prisma.workOrderActivity.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.workOrderActivity.count({ where }),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        workOrderId: row.workOrderId,
        actorId: row.actorId,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        note: row.note,
        createdAt: row.createdAt,
      })),
      total,
      query,
    );
  }

  async updateWorkOrder(
    id: string,
    dto: UpdateWorkOrderDto,
    actor: WorkOrderActor,
  ): Promise<WorkOrderResponseDto> {
    if (!isSupervisoryRole(actor.role)) {
      throw new ForbiddenException(
        'Only dispatchers and admins can edit a work order',
      );
    }

    await this.assertExists(id);

    if (dto.assignedToId !== undefined) {
      await this.assertAssignable(dto.assignedToId ?? null);
    }

    const updated = await this.inTransaction(async (tx) => {
      const existing = await tx.workOrder.findUnique({
        where: { id },
        include: WORK_ORDER_INCLUDE,
      });
      if (!existing) {
        throw new NotFoundException('Work order not found');
      }
      this.assertExpectedVersion(dto.expectedUpdatedAt, existing.updatedAt);

      const data: Prisma.WorkOrderUpdateInput = {};

      if (dto.title !== undefined) {
        data.title = dto.title.trim();
      }
      if (dto.description !== undefined) {
        data.description = dto.description.trim();
      }
      if (dto.priority !== undefined) {
        data.priority = dto.priority;
      }
      if (dto.scheduledFor !== undefined) {
        data.scheduledFor = dto.scheduledFor;
      }
      if (dto.assignedToId !== undefined) {
        data.assignedTo =
          dto.assignedToId === null
            ? { disconnect: true }
            : { connect: { id: dto.assignedToId } };
      }

      return tx.workOrder.update({
        where: { id },
        data,
        include: WORK_ORDER_INCLUDE,
      });
    });

    await this.audit.record(
      {
        action: 'work_order.updated',
        entityType: 'WorkOrder',
        entityId: id,
        metadata: {
          title: updated.title,
          priority: updated.priority,
          assignedToId: updated.assignedToId,
          scheduledFor: updated.scheduledFor?.toISOString() ?? null,
        },
      },
      actor,
    );

    return this.mapWorkOrder(updated);
  }

  async updateStatus(
    id: string,
    dto: UpdateWorkOrderStatusDto,
    actor: WorkOrderActor,
    now: Date = new Date(),
  ): Promise<WorkOrderResponseDto> {
    await this.assertExists(id);

    const note = dto.note?.trim() ?? null;

    if (dto.assignedToId !== undefined) {
      await this.assertAssignable(dto.assignedToId ?? null);
    }

    const updated = await this.inTransaction(async (tx) => {
      const existing = await tx.workOrder.findUnique({
        where: { id },
        include: WORK_ORDER_INCLUDE,
      });
      if (!existing) {
        throw new NotFoundException('Work order not found');
      }

      this.assertExpectedVersion(dto.expectedUpdatedAt, existing.updatedAt);

      if (
        !canActOnWorkOrder(
          actor.role,
          actor.id,
          {
            assignedToId: existing.assignedToId,
            status: existing.status,
          },
          dto.status,
        )
      ) {
        throw new ForbiddenException(
          'You are not allowed to move this work order to that status',
        );
      }

      const assignedToId = dto.assignedToId ?? existing.assignedToId;
      const resolutionNote =
        dto.status === WorkOrderStatus.COMPLETED ||
        dto.status === WorkOrderStatus.CANCELLED
          ? (note ?? existing.resolutionNote)
          : existing.resolutionNote;

      assertWorkOrderTransition({
        from: existing.status,
        to: dto.status,
        assignedToId,
        resolutionNote,
      });

      const timestamps = nextWorkOrderTimestamps(
        {
          from: existing.status,
          to: dto.status,
          assignedToId,
          resolutionNote,
          startedAt: existing.startedAt,
          completedAt: existing.completedAt,
        },
        now,
      );

      const workOrder = await tx.workOrder.update({
        where: { id },
        data: {
          status: dto.status,
          assignedToId,
          resolutionNote,
          startedAt: timestamps.startedAt,
          completedAt: timestamps.completedAt,
        },
        include: WORK_ORDER_INCLUDE,
      });

      if (existing.status !== dto.status) {
        await tx.workOrderActivity.create({
          data: {
            workOrderId: id,
            actorId: actor.id,
            fromStatus: existing.status,
            toStatus: dto.status,
            note,
          },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'WorkOrder',
            aggregateId: id,
            eventType: WORK_ORDER_OUTBOX_EVENT_TYPES.workOrderStatusChanged,
            payload: {
              workOrderId: id,
              fromStatus: existing.status,
              toStatus: dto.status,
              assignedToId,
              note,
            },
          },
        });
      }

      return workOrder;
    });

    await this.audit.record(
      {
        action: 'work_order.status_changed',
        entityType: 'WorkOrder',
        entityId: id,
        metadata: { to: dto.status, note },
      },
      actor,
    );

    return this.mapWorkOrder(updated);
  }

  private async assertExists(id: string): Promise<void> {
    const existing = await this.prisma.workOrder.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Work order not found');
    }
  }

  private mapWorkOrder(row: WorkOrderWithAssignee): WorkOrderResponseDto {
    const assignee: WorkOrderAssigneeDto | null =
      row.assignedTo === null
        ? null
        : {
            id: row.assignedTo.id,
            displayName: row.assignedTo.displayName,
            role: row.assignedTo.role,
          };

    return {
      id: row.id,
      code: row.code,
      leakClusterId: row.leakClusterId,
      createdById: row.createdById,
      assignedToId: row.assignedToId,
      assignee,
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      scheduledFor: row.scheduledFor,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      resolutionNote: row.resolutionNote,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
