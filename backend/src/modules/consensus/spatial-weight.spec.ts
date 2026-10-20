import { describe, it, expect } from 'vitest';
import { spatialWeight } from './spatial-weight.js';
describe('spatial evidence weights', () => {
  it('keeps direct observations strongest', () => {
    expect(spatialWeight(0, true)).toBe(1);
    expect(spatialWeight(0, false)).toBe(0.5);
  });
  it('decays with distance', () => {
    expect(spatialWeight(100, false)).toBeGreaterThan(
      spatialWeight(400, false),
    );
  });
  it('rejects invalid and out-of-range evidence', () => {
    for (const distance of [501, -1, NaN, Infinity])
      expect(spatialWeight(distance, false)).toBe(0);
  });
});
