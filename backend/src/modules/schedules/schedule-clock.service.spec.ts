import { describe, it, expect, vi } from 'vitest';
import { ScheduleClock } from './schedule-clock.service.js';
describe('schedule clock', () => {
  it('does not overlap ticks and can run again after completion', async () => {
    let release: () => void = () => {};
    const reconcileDueWindows = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const clock = new ScheduleClock({ reconcileDueWindows } as never);
    const first = clock.tick();
    await clock.tick();
    expect(reconcileDueWindows).toHaveBeenCalledTimes(1);
    release();
    await first;
    await clock.tick();
    expect(reconcileDueWindows).toHaveBeenCalledTimes(2);
  });
  it('releases its local lock after a failure for the next retry', async () => {
    const reconcileDueWindows = vi
      .fn()
      .mockRejectedValueOnce(new Error('conflict'))
      .mockResolvedValue(undefined);
    const clock = new ScheduleClock({ reconcileDueWindows } as never);
    await clock.tick();
    await clock.tick();
    expect(reconcileDueWindows).toHaveBeenCalledTimes(2);
  });
});
