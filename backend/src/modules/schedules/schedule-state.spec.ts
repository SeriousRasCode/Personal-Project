import { describe, expect, it } from 'vitest';
import { ScheduleStatus, WindowStatus } from '../../generated/prisma/enums.js';
import {
  canTransitionScheduleStatus,
  canTransitionWindowStatus,
  transitionScheduleStatus,
  transitionWindowStatus,
} from './schedule-state.js';

describe('schedule state transitions', () => {
  it('allows the lifecycle transitions', () => {
    expect(
      transitionScheduleStatus(ScheduleStatus.DRAFT, ScheduleStatus.PUBLISHED),
    ).toBe(ScheduleStatus.PUBLISHED);
    expect(
      transitionScheduleStatus(ScheduleStatus.PUBLISHED, ScheduleStatus.ACTIVE),
    ).toBe(ScheduleStatus.ACTIVE);
    expect(
      transitionScheduleStatus(ScheduleStatus.ACTIVE, ScheduleStatus.COMPLETED),
    ).toBe(ScheduleStatus.COMPLETED);
    expect(
      transitionScheduleStatus(ScheduleStatus.DRAFT, ScheduleStatus.CANCELLED),
    ).toBe(ScheduleStatus.CANCELLED);
  });

  it('rejects terminal and skipped transitions', () => {
    expect(
      canTransitionScheduleStatus(ScheduleStatus.DRAFT, ScheduleStatus.ACTIVE),
    ).toBe(false);
    expect(
      canTransitionScheduleStatus(
        ScheduleStatus.COMPLETED,
        ScheduleStatus.ACTIVE,
      ),
    ).toBe(false);
    expect(() =>
      transitionScheduleStatus(
        ScheduleStatus.CANCELLED,
        ScheduleStatus.PUBLISHED,
      ),
    ).toThrow();
  });
});

describe('window state transitions', () => {
  it('allows opening and closing in order', () => {
    expect(
      transitionWindowStatus(WindowStatus.SCHEDULED, WindowStatus.OPENED),
    ).toBe(WindowStatus.OPENED);
    expect(
      transitionWindowStatus(WindowStatus.OPENED, WindowStatus.CLOSED),
    ).toBe(WindowStatus.CLOSED);
  });

  it('rejects closing a scheduled window and reopening a closed window', () => {
    expect(
      canTransitionWindowStatus(WindowStatus.SCHEDULED, WindowStatus.CLOSED),
    ).toBe(false);
    expect(
      canTransitionWindowStatus(WindowStatus.CLOSED, WindowStatus.OPENED),
    ).toBe(false);
  });
});
