import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UserRole, WorkOrderStatus } from '../../generated/prisma/enums.js';
import {
  assertWorkOrderTransition,
  canActOnWorkOrder,
  isTerminalWorkOrderStatus,
  nextWorkOrderTimestamps,
  WORK_ORDER_STATUS_TRANSITIONS,
} from './work-order-status.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const NOTE = 'Replaced the cracked joint.';

function transition(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
  overrides: {
    assignedToId?: string | null;
    resolutionNote?: string | null;
  } = {},
) {
  return assertWorkOrderTransition({
    from,
    to,
    assignedToId:
      'assignedToId' in overrides ? (overrides.assignedToId ?? null) : 'user-1',
    resolutionNote:
      'resolutionNote' in overrides ? (overrides.resolutionNote ?? null) : NOTE,
  });
}

describe('work order status lifecycle', () => {
  it('walks a work order from open to completed', () => {
    expect(() =>
      transition(WorkOrderStatus.OPEN, WorkOrderStatus.ASSIGNED),
    ).not.toThrow();
    expect(() =>
      transition(WorkOrderStatus.ASSIGNED, WorkOrderStatus.ACKNOWLEDGED),
    ).not.toThrow();
    expect(() =>
      transition(WorkOrderStatus.ACKNOWLEDGED, WorkOrderStatus.IN_PROGRESS),
    ).not.toThrow();
    expect(() =>
      transition(WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED),
    ).not.toThrow();
  });

  it('treats completed and cancelled as terminal', () => {
    expect(isTerminalWorkOrderStatus(WorkOrderStatus.COMPLETED)).toBe(true);
    expect(isTerminalWorkOrderStatus(WorkOrderStatus.CANCELLED)).toBe(true);
    expect(isTerminalWorkOrderStatus(WorkOrderStatus.ON_HOLD)).toBe(false);
  });

  it('refuses to skip assignment', () => {
    expect(() =>
      transition(WorkOrderStatus.OPEN, WorkOrderStatus.IN_PROGRESS),
    ).toThrow(ConflictException);
  });

  it('refuses to complete before work starts', () => {
    expect(() =>
      transition(WorkOrderStatus.ACKNOWLEDGED, WorkOrderStatus.COMPLETED),
    ).toThrow(ConflictException);
  });

  it('refuses to revive a completed work order', () => {
    expect(() =>
      transition(WorkOrderStatus.COMPLETED, WorkOrderStatus.IN_PROGRESS),
    ).toThrow(ConflictException);
  });

  it('requires an assignee when marking a work order assigned', () => {
    expect(() =>
      transition(WorkOrderStatus.OPEN, WorkOrderStatus.ASSIGNED, {
        assignedToId: null,
      }),
    ).toThrow(BadRequestException);
  });

  it('requires a resolution note to complete', () => {
    expect(() =>
      transition(WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED, {
        resolutionNote: null,
      }),
    ).toThrow(/resolution note is required/);
  });

  it('requires a note to cancel', () => {
    expect(() =>
      transition(WorkOrderStatus.OPEN, WorkOrderStatus.CANCELLED, {
        resolutionNote: null,
      }),
    ).toThrow(/note is required to cancel/);
  });

  it('pauses and resumes work in progress', () => {
    expect(() =>
      transition(WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.ON_HOLD),
    ).not.toThrow();
    expect(() =>
      transition(WorkOrderStatus.ON_HOLD, WorkOrderStatus.IN_PROGRESS),
    ).not.toThrow();
  });

  it('allows cancelling from any live status', () => {
    for (const status of [
      WorkOrderStatus.OPEN,
      WorkOrderStatus.ASSIGNED,
      WorkOrderStatus.ACKNOWLEDGED,
      WorkOrderStatus.IN_PROGRESS,
      WorkOrderStatus.ON_HOLD,
    ]) {
      expect(WORK_ORDER_STATUS_TRANSITIONS[status]).toContain(
        WorkOrderStatus.CANCELLED,
      );
    }
  });

  it('treats a no-op transition as valid', () => {
    expect(() =>
      transition(WorkOrderStatus.OPEN, WorkOrderStatus.OPEN, {
        assignedToId: null,
        resolutionNote: null,
      }),
    ).not.toThrow();
  });
});

describe('work order timestamps', () => {
  it('stamps the start when work begins', () => {
    const result = nextWorkOrderTimestamps(
      {
        from: WorkOrderStatus.ACKNOWLEDGED,
        to: WorkOrderStatus.IN_PROGRESS,
        assignedToId: 'user-1',
        resolutionNote: null,
        startedAt: null,
        completedAt: null,
      },
      NOW,
    );

    expect(result.startedAt).toEqual(NOW);
    expect(result.completedAt).toBeNull();
  });

  it('keeps the original start when work is paused and resumed', () => {
    const original = new Date('2026-09-27T08:00:00.000Z');
    const result = nextWorkOrderTimestamps(
      {
        from: WorkOrderStatus.ON_HOLD,
        to: WorkOrderStatus.IN_PROGRESS,
        assignedToId: 'user-1',
        resolutionNote: null,
        startedAt: original,
        completedAt: null,
      },
      NOW,
    );

    expect(result.startedAt).toEqual(original);
  });

  it('stamps the completion when work finishes', () => {
    const result = nextWorkOrderTimestamps(
      {
        from: WorkOrderStatus.IN_PROGRESS,
        to: WorkOrderStatus.COMPLETED,
        assignedToId: 'user-1',
        resolutionNote: NOTE,
        startedAt: new Date('2026-09-27T08:00:00.000Z'),
        completedAt: null,
      },
      NOW,
    );

    expect(result.completedAt).toEqual(NOW);
  });

  it('leaves timestamps untouched for a no-op transition', () => {
    const startedAt = new Date('2026-09-27T08:00:00.000Z');
    const result = nextWorkOrderTimestamps(
      {
        from: WorkOrderStatus.IN_PROGRESS,
        to: WorkOrderStatus.IN_PROGRESS,
        assignedToId: 'user-1',
        resolutionNote: null,
        startedAt,
        completedAt: null,
      },
      NOW,
    );

    expect(result.startedAt).toEqual(startedAt);
    expect(result.completedAt).toBeNull();
  });
});

describe('work order permissions', () => {
  const order = { assignedToId: 'user-1', status: WorkOrderStatus.ASSIGNED };

  it('lets dispatchers and admins act on any work order', () => {
    expect(
      canActOnWorkOrder(
        UserRole.DISPATCHER,
        'user-2',
        order,
        WorkOrderStatus.ASSIGNED,
      ),
    ).toBe(true);
    expect(
      canActOnWorkOrder(
        UserRole.ADMIN,
        'user-2',
        order,
        WorkOrderStatus.CANCELLED,
      ),
    ).toBe(true);
  });

  it('lets the assignee progress their own work', () => {
    expect(
      canActOnWorkOrder(
        UserRole.FIELD_TECHNICIAN,
        'user-1',
        order,
        WorkOrderStatus.ACKNOWLEDGED,
      ),
    ).toBe(true);
  });

  it('does not let a technician progress someone elses work', () => {
    expect(
      canActOnWorkOrder(
        UserRole.FIELD_TECHNICIAN,
        'user-9',
        order,
        WorkOrderStatus.ACKNOWLEDGED,
      ),
    ).toBe(false);
  });

  it('does not let an assignee reassign work', () => {
    expect(
      canActOnWorkOrder(
        UserRole.FIELD_TECHNICIAN,
        'user-1',
        order,
        WorkOrderStatus.ASSIGNED,
      ),
    ).toBe(false);
  });

  it('does not let a technician cancel work', () => {
    expect(
      canActOnWorkOrder(
        UserRole.FIELD_TECHNICIAN,
        'user-1',
        order,
        WorkOrderStatus.CANCELLED,
      ),
    ).toBe(false);
  });

  it('does not let a technician act on a closed work order', () => {
    expect(
      canActOnWorkOrder(
        UserRole.FIELD_TECHNICIAN,
        'user-1',
        { ...order, status: WorkOrderStatus.COMPLETED },
        WorkOrderStatus.IN_PROGRESS,
      ),
    ).toBe(false);
  });

  it('never lets a citizen act on a work order', () => {
    expect(
      canActOnWorkOrder(
        UserRole.CITIZEN,
        'user-1',
        order,
        WorkOrderStatus.ACKNOWLEDGED,
      ),
    ).toBe(false);
  });
});
