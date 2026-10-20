import { useId } from "react";
import { projectPoints, type MapPoint } from "../lib/monitoring";
export function NetworkMap({
  points,
  onSelect,
}: {
  points: MapPoint[];
  onSelect: (id: string) => void;
}) {
  const id = useId().replaceAll(":", "");
  const projected = projectPoints(points);
  if (!projected.length)
    return (
      <div className="dispatch-map-empty" role="status">
        <h3>No mapped observations yet</h3>
        <p>
          Choose a service area and the crowd-consensus layer to inspect
          reported flow, or record a measurement at a monitoring point below. No
          missing values are treated as healthy pressure.
        </p>
        {points.length > 0 && (
          <p>{points.length} observations are missing coordinates.</p>
        )}
      </div>
    );
  return (
    <>
      <svg
        className="dispatch-map"
        viewBox="0 0 760 420"
        aria-label="Geographic observation heatmap. Use the observation list below for full details."
        role="img"
      >
        <defs>
          {projected.map((point) => (
            <radialGradient key={point.id} id={id + point.id}>
              <stop offset="0%" stopColor={point.color} stopOpacity="0.45" />
              <stop offset="100%" stopColor={point.color} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        {[80, 180, 280, 380].map((y) => (
          <line
            key={y}
            x1="25"
            x2="735"
            y1={y}
            y2={y}
            stroke="#91aba1"
            strokeOpacity="0.25"
          />
        ))}
        {projected.map((point) => (
          <g key={point.id}>
            <circle
              cx={point.x}
              cy={point.y}
              r={point.stale ? 16 : 58}
              fill={point.stale ? "#7c8d88" : `url(#${id + point.id})`}
              opacity={point.stale ? 0.25 : 1}
            />
            <circle
              cx={point.x}
              cy={point.y}
              r="7"
              fill={point.stale ? "#7c8d88" : point.color}
              stroke="white"
              strokeWidth="2"
              onClick={() => onSelect(point.id)}
              style={{ cursor: "pointer" }}
            >
              <title>
                {point.name}: {point.label}
                {point.stale ? " (stale or unavailable)" : ""}
              </title>
            </circle>
            <text x={point.x + 11} y={point.y - 9}>
              {point.name.slice(0, 26)}
            </text>
          </g>
        ))}
        <text x="24" y="30">
          N ↑ · Geographic observation layer
        </text>
        <text x="24" y="400">
          {projected.length} located observations · latitude / longitude
          projection
        </text>
      </svg>
      {!projected.length && (
        <p>
          No geolocated observations are available. No values have been
          invented.
        </p>
      )}
      <p>
        Colored halos mark observations, not a continuous hydraulic model. Gray
        indicates stale or unavailable data. {points.length - projected.length}{" "}
        records have no coordinates.
      </p>
    </>
  );
}
