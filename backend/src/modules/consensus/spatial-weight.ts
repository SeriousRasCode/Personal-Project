export const SPATIAL_RADIUS_METERS = 500;
// Nearby reports are supporting evidence, never as strong as an on-site observation.
export function spatialWeight(distanceMeters: number, direct: boolean): number {
  if (direct) return 1;
  if (
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0 ||
    distanceMeters > SPATIAL_RADIUS_METERS
  )
    return 0;
  return 0.5 * Math.exp(-distanceMeters / 200);
}
