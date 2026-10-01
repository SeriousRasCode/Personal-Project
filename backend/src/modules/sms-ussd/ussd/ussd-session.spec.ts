import { describe, expect, it } from 'vitest';
import {
  USSD_HELP_STEP,
  USSD_MAIN_STEP,
  USSD_SCHEDULE_STEP,
  USSD_STANDPIPES_STEP,
  USSD_MAX_MESSAGE_LENGTH,
  clampMessage,
  helpMessage,
  mainMenuMessage,
  navigate,
  normaliseInput,
  scheduleMessage,
  standpipesMessage,
} from './ussd-session.js';

describe('normaliseInput', () => {
  it('strips the USSD framing', () => {
    expect(normaliseInput('*1#')).toBe('1');
    expect(normaliseInput('1#')).toBe('1');
    expect(normaliseInput(' 2 ')).toBe('2');
    expect(normaliseInput('')).toBe('');
  });
});

describe('navigate', () => {
  it('opens each main menu entry', () => {
    expect(navigate(USSD_MAIN_STEP, '*1#')).toEqual({
      step: USSD_STANDPIPES_STEP,
      done: false,
      invalid: false,
    });
    expect(navigate(USSD_MAIN_STEP, '2')).toEqual({
      step: USSD_SCHEDULE_STEP,
      done: false,
      invalid: false,
    });
    expect(navigate(USSD_MAIN_STEP, '3')).toEqual({
      step: USSD_HELP_STEP,
      done: false,
      invalid: false,
    });
  });

  it('ends the session on cancel', () => {
    expect(navigate(USSD_MAIN_STEP, '0')).toEqual({
      step: USSD_MAIN_STEP,
      done: true,
      invalid: false,
    });
    expect(navigate(USSD_STANDPIPES_STEP, '0').done).toBe(true);
  });

  it('returns to the main menu from a submenu', () => {
    expect(navigate(USSD_STANDPIPES_STEP, '*')).toEqual({
      step: USSD_MAIN_STEP,
      done: false,
      invalid: false,
    });
  });

  it('repeats the current menu when nothing was entered', () => {
    expect(navigate(USSD_MAIN_STEP, '')).toEqual({
      step: USSD_MAIN_STEP,
      done: false,
      invalid: false,
    });
    expect(navigate(USSD_SCHEDULE_STEP, '')).toEqual({
      step: USSD_MAIN_STEP,
      done: false,
      invalid: false,
    });
  });

  it('flags an unknown selection and keeps the current menu', () => {
    expect(navigate(USSD_MAIN_STEP, '9')).toEqual({
      step: USSD_MAIN_STEP,
      done: false,
      invalid: true,
    });
    expect(navigate(USSD_HELP_STEP, '5')).toEqual({
      step: USSD_HELP_STEP,
      done: false,
      invalid: true,
    });
  });
});

describe('messages', () => {
  it('clamps long text to the USSD screen limit', () => {
    expect(clampMessage('x'.repeat(600)).length).toBe(USSD_MAX_MESSAGE_LENGTH);
    expect(clampMessage('short')).toBe('short');
  });

  it('renders the main menu with all entries', () => {
    const message = mainMenuMessage();
    expect(message).toContain('HydroJimma Water');
    expect(message).toContain('1. My water points');
    expect(message).toContain('0. Cancel');
  });

  it('explains when no water point is linked', () => {
    expect(standpipesMessage([])).toContain('No water point is linked');
  });

  it('renders standpipes with their flow status', () => {
    const message = standpipesMessage([
      { code: 'SP-1', name: 'Hill', kebele: 'Ginjo', status: 'FULL_FLOW' },
      { code: 'SP-2', name: 'River', kebele: 'Ginjo', status: 'UNKNOWN' },
    ]);
    expect(message).toContain('SP-1 full_flow (Ginjo)');
    expect(message).toContain('SP-2 flow unknown (Ginjo)');
  });

  it('caps the standpipe list and reports the remainder', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      code: `SP-${index}`,
      name: `n${index}`,
      kebele: 'Ginjo',
      status: 'DRY',
    }));
    expect(standpipesMessage(rows)).toContain('+2 more in the app');
  });

  it('explains when no window is scheduled', () => {
    expect(scheduleMessage([])).toContain('No rationing window');
  });

  it('renders windows with a time range', () => {
    const message = scheduleMessage([
      { standpipeCode: 'SP-1', timeRange: '06:00-12:00', status: 'OPENED' },
      { standpipeCode: '-', timeRange: '12:00-18:00', status: 'SCHEDULED' },
    ]);
    expect(message).toContain('SP-1 06:00-12:00 opened');
    expect(message).toContain('Area 12:00-18:00 scheduled');
  });

  it('renders the help screen', () => {
    expect(helpMessage()).toContain('HydroJimma Water');
    expect(helpMessage()).toContain('0. Back');
  });
});
