import {
  assertStateChange,
  RepeatedValveStateError,
  valvePosition,
  ValvePosition,
} from './valve-state.js';
import { describe, expect, it } from 'vitest';

describe('valvePosition', () => {
  it('maps the stored flag to a position', () => {
    expect(valvePosition(true)).toBe('OPEN');
    expect(valvePosition(false)).toBe('CLOSED');
  });
});

describe('assertStateChange', () => {
  it('opens a closed valve', () => {
    expect(assertStateChange(false, true)).toEqual({
      from: 'CLOSED',
      to: 'OPEN',
      action: 'valve.opened',
    });
  });

  it('closes an open valve', () => {
    expect(assertStateChange(true, false)).toEqual({
      from: 'OPEN',
      to: 'CLOSED',
      action: 'valve.closed',
    });
  });

  it('rejects reopening a valve that is already open', () => {
    expect(() => assertStateChange(true, true)).toThrow(
      RepeatedValveStateError,
    );
  });

  it('rejects closing a valve that is already closed', () => {
    expect(() => assertStateChange(false, false)).toThrow(
      RepeatedValveStateError,
    );
  });

  it('carries the current position on the error', () => {
    try {
      assertStateChange(true, true);
      expect.unreachable('expected a repeated state error');
    } catch (error) {
      expect(error).toBeInstanceOf(RepeatedValveStateError);
      expect((error as RepeatedValveStateError).position).toBe<ValvePosition>(
        'OPEN',
      );
      expect((error as RepeatedValveStateError).message).toBe(
        'Valve is already open',
      );
    }
  });
});
