export type MapPoint = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  value: number | null;
  label: string;
  color: string;
  stale: boolean;
};
export function projectPoints(points: MapPoint[]) {
  const located = points.filter(
    (point) =>
      point.latitude != null &&
      point.longitude != null &&
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude),
  );
  if (!located.length) return [];
  const lons = located.map((point) => point.longitude!),
    lats = located.map((point) => point.latitude!);
  const minLon = Math.min(...lons),
    maxLon = Math.max(...lons),
    minLat = Math.min(...lats),
    maxLat = Math.max(...lats);
  const centerLon = (maxLon + minLon) / 2,
    centerLat = (maxLat + minLat) / 2;
  const lonCorrection = Math.cos((centerLat * Math.PI) / 180);
  const scale = Math.min(
    640 / Math.max((maxLon - minLon) * lonCorrection, 0.005),
    340 / Math.max(maxLat - minLat, 0.005),
  );
  return located.map((point) => ({
    ...point,
    x: 380 + (point.longitude! - centerLon) * lonCorrection * scale,
    y: 210 - (point.latitude! - centerLat) * scale,
  }));
}
export function pressureColor(value: number | null) {
  return value == null
    ? "#7c8d88"
    : value < 1.5
      ? "#d75a4a"
      : value > 5
        ? "#b68516"
        : "#22866c";
}
export function isStale(observedAt: string | null, now = Date.now()) {
  return (
    !observedAt ||
    !Number.isFinite(Date.parse(observedAt)) ||
    now - Date.parse(observedAt) > 60 * 60 * 1000
  );
}
