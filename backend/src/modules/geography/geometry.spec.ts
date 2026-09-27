import { describe, expect, it } from 'vitest';
import { isValidGeometry, isValidPoint } from './geometry.js';

const square = {
  type: 'MultiPolygon' as const,
  coordinates: [
    [
      [
        [36.8, 7.6],
        [36.9, 7.6],
        [36.9, 7.7],
        [36.8, 7.7],
        [36.8, 7.6],
      ],
    ],
  ],
};

describe('geography geometry validation', () => {
  it('accepts finite longitude and latitude pairs', () => {
    expect(isValidPoint({ longitude: 36.8319, latitude: 7.6667 })).toBe(true);
    expect(isValidPoint({ longitude: -180, latitude: -90 })).toBe(true);
  });

  it('rejects out-of-range and non-finite points', () => {
    expect(isValidPoint({ longitude: 181, latitude: 7 })).toBe(false);
    expect(isValidPoint({ longitude: 36, latitude: 91 })).toBe(false);
    expect(isValidPoint({ longitude: Number.NaN, latitude: 7 })).toBe(false);
  });

  it('accepts non-degenerate LineStrings and closed MultiPolygons', () => {
    expect(
      isValidGeometry(
        {
          type: 'LineString',
          coordinates: [
            [36.8, 7.6],
            [36.9, 7.7],
          ],
        },
        'LineString',
      ),
    ).toBe(true);
    expect(isValidGeometry(square, 'MultiPolygon')).toBe(true);
  });

  it('rejects degenerate lines, unclosed rings, and self-intersections', () => {
    expect(
      isValidGeometry(
        {
          type: 'LineString',
          coordinates: [
            [36.8, 7.6],
            [36.8, 7.6],
          ],
        },
        'LineString',
      ),
    ).toBe(false);
    expect(
      isValidGeometry(
        {
          ...square,
          coordinates: [
            [
              [
                [36.8, 7.6],
                [36.9, 7.6],
                [36.9, 7.7],
              ],
            ],
          ],
        },
        'MultiPolygon',
      ),
    ).toBe(false);
    expect(
      isValidGeometry(
        {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [0, 0],
                [1, 1],
                [0, 1],
                [1, 0],
                [0, 0],
              ],
            ],
          ],
        },
        'MultiPolygon',
      ),
    ).toBe(false);
  });
});
