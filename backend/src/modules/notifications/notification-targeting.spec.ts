import { describe, expect, it } from 'vitest';
import { UserRole } from '../../generated/prisma/enums.js';
import {
  NOTIFICATION_TEMPLATES,
  resolveNotificationPlan,
  resolveRecipientIds,
} from './notification-targeting.js';

const reporterId = '00000000-0000-0000-0000-000000000001';
const dispatcherId = '00000000-0000-0000-0000-000000000002';
const technicianId = '00000000-0000-0000-0000-000000000003';

function planFor(eventType: string, payload: Record<string, unknown>) {
  const plan = resolveNotificationPlan({ eventType, payload });
  if (plan === null) {
    throw new Error(`expected a plan for ${eventType}`);
  }
  return plan;
}

describe('resolveNotificationPlan', () => {
  it('ignores an event it does not own', () => {
    expect(
      resolveNotificationPlan({ eventType: 'unknown', payload: {} }),
    ).toBeNull();
    expect(
      resolveNotificationPlan({
        eventType: 'tap_status.reported',
        payload: {},
      }),
    ).toBeNull();
  });

  it('routes a new leak to dispatchers and admins', () => {
    const plan = planFor(NOTIFICATION_TEMPLATES.leakReported, {
      severity: 'CRITICAL',
      clusterCode: 'LEAK-ABC123',
      actorId: reporterId,
    });

    expect(plan.audience.roles).toEqual([UserRole.DISPATCHER, UserRole.ADMIN]);
    expect(plan.title).toContain('CRITICAL');
    expect(plan.body).toContain('critical');
    expect(plan.body).toContain('LEAK-ABC123');
  });

  it('survives a leak event with no cluster code', () => {
    const plan = planFor(NOTIFICATION_TEMPLATES.leakReported, {});

    expect(plan.title).toBe('New leak reported (UNKNOWN)');
  });

  it('does not notify a leak reporter about their own report', () => {
    const plan = planFor(NOTIFICATION_TEMPLATES.leakReported, {
      actorId: dispatcherId,
    });

    expect(plan.excludeUserIds).toEqual([dispatcherId]);
  });

  it('routes a leak status change to the reporter', () => {
    const plan = planFor(NOTIFICATION_TEMPLATES.leakStatusChanged, {
      from: 'OPEN',
      to: 'RESOLVED',
      reporterId,
      note: 'The pipe was replaced.',
    });

    expect(resolveRecipientIds(plan)).toEqual([reporterId]);
    expect(plan.title).toBe('Your leak is now resolved');
    expect(plan.body).toBe('The pipe was replaced.');
  });

  it('falls back to generic copy when a status change has no note', () => {
    const plan = planFor(NOTIFICATION_TEMPLATES.leakStatusChanged, {
      to: 'TRIAGED',
    });

    expect(plan.body).toContain('triaged');
  });

  it('drops a missing reporter instead of notifying nobody', () => {
    const plan = planFor(NOTIFICATION_TEMPLATES.leakStatusChanged, {
      to: 'TRIAGED',
      reporterId: null,
    });

    expect(resolveRecipientIds(plan)).toEqual([]);
  });

  it('notifies the creator and the assignee about a new work order', () => {
    const plan = planFor(NOTIFICATION_TEMPLATES.workOrderCreated, {
      code: 'WO-ABC123',
      createdById: dispatcherId,
      assignedToId: technicianId,
      actorId: dispatcherId,
    });

    expect(resolveRecipientIds(plan)).toEqual([technicianId]);
    expect(plan.body).toContain('WO-ABC123');
  });

  it('deduplicates a creator who is also the assignee', () => {
    const plan = planFor(NOTIFICATION_TEMPLATES.workOrderCreated, {
      createdById: dispatcherId,
      assignedToId: dispatcherId,
    });

    expect(resolveRecipientIds(plan)).toEqual([dispatcherId]);
  });

  it('notifies both parties about a status change', () => {
    const plan = planFor(NOTIFICATION_TEMPLATES.workOrderStatusChanged, {
      code: 'WO-ABC123',
      createdById: dispatcherId,
      assignedToId: technicianId,
      toStatus: 'IN_PROGRESS',
      actorId: technicianId,
    });

    expect(resolveRecipientIds(plan)).toEqual([dispatcherId]);
    expect(plan.title).toBe('Work order is now in_progress');
  });

  it('never returns a duplicate recipient', () => {
    const plan = planFor(NOTIFICATION_TEMPLATES.workOrderStatusChanged, {
      createdById: technicianId,
      assignedToId: technicianId,
    });

    expect(resolveRecipientIds(plan)).toEqual([technicianId]);
  });

  it('ignores blank identifiers', () => {
    const plan = planFor(NOTIFICATION_TEMPLATES.workOrderStatusChanged, {
      createdById: '   ',
      assignedToId: technicianId,
    });

    expect(resolveRecipientIds(plan)).toEqual([technicianId]);
  });
});
