export const USSD_MAIN_STEP = 'main';
export const USSD_STANDPIPES_STEP = 'standpipes';
export const USSD_SCHEDULE_STEP = 'schedule';
export const USSD_HELP_STEP = 'help';
export const USSD_UNREGISTERED_STEP = 'unregistered';

export const USSD_BACK_INPUT = '*';
export const USSD_CANCEL_INPUT = '0';

export const USSD_MAX_MESSAGE_LENGTH = 480;

export interface UssdNavigation {
  step: string;
  done: boolean;
  invalid: boolean;
}

export interface UssdStandpipeLine {
  code: string;
  name: string;
  kebele: string;
  status: string;
}

export interface UssdWindowLine {
  standpipeCode: string;
  timeRange: string;
  status: string;
}

/**
 * Strips the USSD framing so `*1#`, `1#`, and `1` all mean the same selection.
 */
export function normaliseInput(input: string): string {
  const trimmed = input.trim();
  const withoutHash = trimmed.replace(/#+$/, '');
  const withoutStar = withoutHash.replace(/^\*+/, '');
  return withoutStar.trim();
}

export function navigate(step: string, rawInput: string): UssdNavigation {
  const input = normaliseInput(rawInput);

  if (input === USSD_CANCEL_INPUT) {
    return { step: USSD_MAIN_STEP, done: true, invalid: false };
  }

  if (step === USSD_MAIN_STEP) {
    switch (input) {
      case '1':
        return { step: USSD_STANDPIPES_STEP, done: false, invalid: false };
      case '2':
        return { step: USSD_SCHEDULE_STEP, done: false, invalid: false };
      case '3':
        return { step: USSD_HELP_STEP, done: false, invalid: false };
      case '':
        return { step, done: false, invalid: false };
      default:
        return { step, done: false, invalid: true };
    }
  }

  if (input === USSD_BACK_INPUT || input === '') {
    return { step: USSD_MAIN_STEP, done: false, invalid: false };
  }

  return { step, done: false, invalid: true };
}

export function clampMessage(message: string): string {
  if (message.length <= USSD_MAX_MESSAGE_LENGTH) {
    return message;
  }
  return `${message.slice(0, USSD_MAX_MESSAGE_LENGTH - 1).trimEnd()}…`;
}

export function mainMenuMessage(): string {
  return clampMessage(
    [
      'HydroJimma Water',
      '1. My water points',
      '2. Today`s rationing',
      '3. Help and contact',
      '0. Cancel',
    ].join('\n'),
  );
}

export function invalidInputMessage(): string {
  return clampMessage('Sorry, that option is not available.\n0. Cancel');
}

export function goodbyeMessage(): string {
  return clampMessage('Thank you for calling HydroJimma Water.');
}

export function unregisteredMessage(): string {
  return clampMessage(
    [
      'This service needs a registered account.',
      'Send HELP to 80000 to register, then dial again.',
      '0. Cancel',
    ].join('\n'),
  );
}

export function helpMessage(): string {
  return clampMessage(
    [
      'HydroJimma Water',
      'Water point problems: call 80000.',
      'Emergency leaks: dial *99# and press 1.',
      'Office hours 08:00-18:00.',
      '0. Back',
    ].join('\n'),
  );
}

export function standpipesMessage(rows: UssdStandpipeLine[]): string {
  if (rows.length === 0) {
    return clampMessage('No water point is linked to your number.\n0. Back');
  }

  const lines = rows.slice(0, 4).map((row, index) => {
    const flow =
      row.status === 'UNKNOWN' ? 'flow unknown' : row.status.toLowerCase();
    return `${index + 1}. ${row.code} ${flow} (${row.kebele})`;
  });
  const overflow =
    rows.length > 4 ? `\n+${rows.length - 4} more in the app` : '';

  return clampMessage(
    [`Your water points:`, ...lines, `${overflow}`, '0. Back'].join('\n'),
  );
}

export function scheduleMessage(lines: UssdWindowLine[]): string {
  if (lines.length === 0) {
    return clampMessage(
      'No rationing window is scheduled for your area today.\n0. Back',
    );
  }

  const rendered = lines.slice(0, 4).map((line) => {
    const label = line.standpipeCode === '-' ? 'Area' : line.standpipeCode;
    return `${label} ${line.timeRange} ${line.status.toLowerCase()}`;
  });

  return clampMessage(['Rationing today:', ...rendered, '0. Back'].join('\n'));
}
