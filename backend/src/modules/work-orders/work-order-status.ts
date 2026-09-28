import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserRole, WorkOrderStatus } from '../../generated/prisma/enums.js';

export const WORK_ORDER_STATUS_TRANSITIONS: Record<
  WorkOrderStatus,
  WorkOrderStatus[]
> = {
  [WorkOrderStatus.OPEN]: [WorkOrderStatus.ASSIGNED, WorkOrderStatus.CANCELLED],
  [WorkOrderStatus.ASSIGNED]: [
    WorkOrderStatus.ACKNOWLEDGED,
    WorkOrderStatus.ON_HOLD,
    WorkOrderStatus.CANCELLED,
  ],
  [WorkOrderStatus.ACKNOWLEDGED]: [
    WorkOrderStatus.IN_PROGRESS,
    WorkOrderStatus.ON_HOLD,
    WorkOrderStatus.CANCELLED,
  ],
  [WorkOrderStatus.IN_PROGRESS]: [
    WorkOrderStatus.COMPLETED,
    WorkOrderStatus.ON_HOLD,
    WorkOrderStatus.CANCELLED,
  ],
  [WorkOrderStatus.ON_HOLD]: [
    WorkOrderStatus.IN_PROGRESS,
    WorkOrderStatus.CANCELLED,
  ],
  [WorkOrderStatus.COMPLETED]: [],
  [WorkOrderStatus.CANCELLED]: [],
};

export const TERMINAL_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = [
  WorkOrderStatus.COMPLETED,
  WorkOrderStatus.CANCELLED,
];

export const SUPERVISORY_ROLES: readonly UserRole[] = [
  UserRole.DISPATCHER,
  UserRole.ADMIN,
];

export const ASSIGNEE_ROLES: readonly UserRole[] = [
  UserRole.FIELD_TECHNICIAN,
  UserRole.STANDPIPE_OPERATOR,
];

const ASSIGNEE_DRIVEN_STATUSES: readonly WorkOrderStatus[] = [
  WorkOrderStatus.ACKNOWLEDGED,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.ON_HOLD,
  WorkOrderStatus.COMPLETED,
];

export interface WorkOrderTransitionInput {
  from: WorkOrderStatus;
  to: WorkOrderStatus;
  assignedToId: string | null;
  resolutionNote: string | null;
}

export interface WorkOrderTimestamps {
  startedAt: Date | null;
  completedAt: Date | null;
}

export function isTerminalWorkOrderStatus(status: WorkOrderStatus): boolean {
  return TERMINAL_WORK_ORDER_STATUSES.includes(status);
}

export function isSupervisoryRole(role: UserRole): boolean {
  return SUPERVISORY_ROLES.includes(role);
}

export function assertWorkOrderTransition(
  input: WorkOrderTransitionInput,
): void {
  const { from, to, assignedToId, resolutionNote } = input;

  if (from === to) {
    return;
  }

  if (!WORK_ORDER_STATUS_TRANSITIONS[from].includes(to)) {
    throw new ConflictException(
      `A work order cannot move from ${from} to ${to}`,
    );
  }

  if (to === WorkOrderStatus.ASSIGNED && !assignedToId) {
    throw new BadRequestException(
      'A work order must be assigned before it can be marked assigned',
    );
  }

  if (to === WorkOrderStatus.COMPLETED && !resolutionNote) {
    throw new BadRequestException(
      'A resolution note is required to complete a work order',
    );
  }

  if (to === WorkOrderStatus.CANCELLED && !resolutionNote) {
    throw new BadRequestException('A note is required to cancel a work order');
  }
}

export function nextWorkOrderTimestamps(
  input: WorkOrderTransitionInput & WorkOrderTimestamps,
  now: Date,
): WorkOrderTimestamps {
  const { from, to, startedAt, completedAt } = input;

  if (from === to) {
    return { startedAt, completedAt };
  }

  if (to === WorkOrderStatus.IN_PROGRESS && startedAt === null) {
    return { startedAt: now, completedAt };
  }

  if (to === WorkOrderStatus.COMPLETED) {
    return { startedAt, completedAt: now };
  }

  return { startedAt, completedAt };
}

export function canActOnWorkOrder(
  role: UserRole,
  actorId: string,
  workOrder: { assignedToId: string | null; status: WorkOrderStatus },
  to: WorkOrderStatus,
): boolean {
  if (isSupervisoryRole(role)) {
    return true;
  }

  if (!ASSIGNEE_ROLES.includes(role)) {
    return false;
  }

  if (workOrder.assignedToId !== actorId) {
    return false;
  }

  if (isTerminalWorkOrderStatus(workOrder.status)) {
    return false;
  }

  return ASSIGNEE_DRIVEN_STATUSES.includes(to);
}
