import { UserRole } from '../../generated/prisma/enums.js';

export const NOTIFICATION_TEMPLATES = {
  leakReported: 'leak.reported',
  leakStatusChanged: 'leak.status_changed',
  workOrderCreated: 'work_order.created',
  workOrderStatusChanged: 'work_order.status_changed',
  waterOpened: 'rotation_window.opened',
  waterClosed: 'rotation_window.closed',
} as const;

export type NotificationTemplate =
  (typeof NOTIFICATION_TEMPLATES)[keyof typeof NOTIFICATION_TEMPLATES];

export interface NotificationAudience {
  kebeleId?: string;
  standpipeId?: string;
  roles?: UserRole[];
  userIds?: string[];
}

export interface NotificationPlan {
  template: NotificationTemplate;
  audience: NotificationAudience;
  excludeUserIds: string[];
  title: string;
  body: string;
}

export interface OutboxEventLike {
  eventType: string;
  payload: Record<string, unknown>;
}

function text(
  payload: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = payload[key];
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return fallback;
}

function userIds(values: unknown[]): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      ids.add(value.trim());
    }
  }
  return [...ids];
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

const LEAK_REPORTED_AUDIENCE: NotificationAudience = {
  roles: [UserRole.DISPATCHER, UserRole.ADMIN],
};

export function resolveNotificationPlan(
  event: OutboxEventLike,
): NotificationPlan | null {
  const { payload } = event;

  if (
    event.eventType === NOTIFICATION_TEMPLATES.waterOpened ||
    event.eventType === NOTIFICATION_TEMPLATES.waterClosed
  ) {
    const kebeleId = text(payload, 'kebeleId', '');
    if (!kebeleId) return null;
    const opened = event.eventType === NOTIFICATION_TEMPLATES.waterOpened;
    return {
      template: opened
        ? NOTIFICATION_TEMPLATES.waterOpened
        : NOTIFICATION_TEMPLATES.waterClosed,
      audience: {
        kebeleId,
        standpipeId: text(payload, 'standpipeId', '') || undefined,
      },
      excludeUserIds: [],
      title: opened ? 'Water service is open' : 'Water service has closed',
      body: opened
        ? `Your area’s water service window is open until ${text(payload, 'endsAt', 'the scheduled closing time')}. Check your taps and avoid leaving them unattended.`
        : 'Your area’s water service window has closed. Please close unattended taps.',
    };
  }

  if (event.eventType === NOTIFICATION_TEMPLATES.leakReported) {
    const severity = text(payload, 'severity', 'UNKNOWN');
    const code = text(payload, 'clusterCode', 'a new cluster');
    return {
      template: NOTIFICATION_TEMPLATES.leakReported,
      audience: LEAK_REPORTED_AUDIENCE,
      excludeUserIds: userIds([payload['actorId']]),
      title: `New leak reported (${severity})`,
      body: `A ${severity.toLowerCase()} leak was reported to ${code} and needs triage.`,
    };
  }

  if (event.eventType === NOTIFICATION_TEMPLATES.leakStatusChanged) {
    const status = text(payload, 'to', 'UPDATED');
    return {
      template: NOTIFICATION_TEMPLATES.leakStatusChanged,
      audience: {
        userIds: userIds([
          ...list(payload['reporterIds']),
          payload['reporterId'],
        ]),
      },
      excludeUserIds: [],
      title: `Your leak is now ${status.toLowerCase()}`,
      body: text(
        payload,
        'note',
        `The water utility marked your leak as ${status.toLowerCase()}.`,
      ),
    };
  }

  if (event.eventType === NOTIFICATION_TEMPLATES.workOrderCreated) {
    return {
      template: NOTIFICATION_TEMPLATES.workOrderCreated,
      audience: {
        userIds: userIds([payload['createdById'], payload['assignedToId']]),
      },
      excludeUserIds: userIds([payload['actorId']]),
      title: 'Work order created',
      body: `Work order ${text(payload, 'code', '')} was opened for repair.`.trim(),
    };
  }

  if (event.eventType === NOTIFICATION_TEMPLATES.workOrderStatusChanged) {
    const status = text(payload, 'toStatus', 'UPDATED');
    return {
      template: NOTIFICATION_TEMPLATES.workOrderStatusChanged,
      audience: {
        userIds: userIds([payload['createdById'], payload['assignedToId']]),
      },
      excludeUserIds: userIds([payload['actorId']]),
      title: `Work order is now ${status.toLowerCase()}`,
      body: text(payload, 'note', `The work order moved to ${status}.`),
    };
  }

  return null;
}

export function resolveRecipientIds(plan: NotificationPlan): string[] {
  return userIds(plan.audience.userIds ?? []).filter(
    (id) => !plan.excludeUserIds.includes(id),
  );
}
