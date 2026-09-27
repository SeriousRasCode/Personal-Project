import { ScheduleStatus, WindowStatus } from '../../generated/prisma/enums.js';

export const SCHEDULE_TRANSITIONS: Readonly<
  Record<ScheduleStatus, readonly ScheduleStatus[]>
> = {
  [ScheduleStatus.DRAFT]: [ScheduleStatus.PUBLISHED, ScheduleStatus.CANCELLED],
  [ScheduleStatus.PUBLISHED]: [ScheduleStatus.ACTIVE, ScheduleStatus.CANCELLED],
  [ScheduleStatus.ACTIVE]: [ScheduleStatus.COMPLETED, ScheduleStatus.CANCELLED],
  [ScheduleStatus.COMPLETED]: [],
  [ScheduleStatus.CANCELLED]: [],
};

export const WINDOW_TRANSITIONS: Readonly<
  Record<WindowStatus, readonly WindowStatus[]>
> = {
  [WindowStatus.SCHEDULED]: [WindowStatus.OPENED, WindowStatus.CANCELLED],
  [WindowStatus.OPENED]: [WindowStatus.CLOSED, WindowStatus.CANCELLED],
  [WindowStatus.CLOSED]: [WindowStatus.CANCELLED],
  [WindowStatus.CANCELLED]: [],
};

export class InvalidTransitionError extends Error {
  constructor(entity: string, from: string, to: string) {
    super(`Invalid ${entity} transition from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransitionScheduleStatus(
  from: ScheduleStatus,
  to: ScheduleStatus,
): boolean {
  return SCHEDULE_TRANSITIONS[from].includes(to);
}

export function transitionScheduleStatus(
  from: ScheduleStatus,
  to: ScheduleStatus,
): ScheduleStatus {
  if (!canTransitionScheduleStatus(from, to)) {
    throw new InvalidTransitionError('schedule', from, to);
  }

  return to;
}

export function canTransitionWindowStatus(
  from: WindowStatus,
  to: WindowStatus,
): boolean {
  return WINDOW_TRANSITIONS[from].includes(to);
}

export function transitionWindowStatus(
  from: WindowStatus,
  to: WindowStatus,
): WindowStatus {
  if (!canTransitionWindowStatus(from, to)) {
    throw new InvalidTransitionError('window', from, to);
  }

  return to;
}

export const assertScheduleTransition = transitionScheduleStatus;
export const assertWindowTransition = transitionWindowStatus;
