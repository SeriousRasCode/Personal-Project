export type ValvePosition = 'OPEN' | 'CLOSED';

export interface ValveStateChange {
  from: ValvePosition;
  to: ValvePosition;
  action: 'valve.opened' | 'valve.closed';
}

export class RepeatedValveStateError extends Error {
  constructor(readonly position: ValvePosition) {
    super(`Valve is already ${position.toLowerCase()}`);
    this.name = 'RepeatedValveStateError';
  }
}

export function valvePosition(isOpen: boolean): ValvePosition {
  return isOpen ? 'OPEN' : 'CLOSED';
}

export function assertStateChange(
  currentIsOpen: boolean,
  requestedIsOpen: boolean,
): ValveStateChange {
  const from = valvePosition(currentIsOpen);
  const to = valvePosition(requestedIsOpen);
  if (from === to) {
    throw new RepeatedValveStateError(to);
  }
  return {
    from,
    to,
    action: requestedIsOpen ? 'valve.opened' : 'valve.closed',
  };
}
