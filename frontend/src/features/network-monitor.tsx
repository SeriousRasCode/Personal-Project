import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useCollection } from "../lib/use-collection";
import { isStale, pressureColor, type MapPoint } from "../lib/monitoring";
import { human, when } from "../lib/dispatch";
import { FormField, FormFeedback, RecordPicker } from "../components/forms";
import { NetworkMap } from "../components/geographic-map";
type PressurePoint = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  pressure: number | null;
  observedAt: string | null;
  source: string | null;
  status: string;
  standpipeId: string | null;
};
type FlowPoint = {
  standpipeId: string;
  name: string;
  locationLatitude: number | null;
  locationLongitude: number | null;
  tapStatus: string;
  tapConfidence: number;
  tapSampleCount: number;
  tapLastObservedAt: string | null;
  waitMinutes: number | null;
  queueLastCalculatedAt: string | null;
};
type Reading = {
  id: string;
  pressureBar: number;
  observedAt: string;
  source: string;
};
export function NetworkMonitor() {
  const [area, setArea] = useState(""),
    [search, setSearch] = useState(""),
    [freshOnly, setFreshOnly] = useState(false),
    [mode, setMode] = useState<"pressure" | "flow">("pressure"),
    [selected, setSelected] = useState(""),
    [history, setHistory] = useState<Reading[]>([]),
    [historyError, setHistoryError] = useState(""),
    [stats, setStats] = useState<{
      averagePressureBar: number | null;
      minimumPressureBar: number | null;
      maximumPressureBar: number | null;
      sampleCount: number;
    } | null>(null),
    [updated, setUpdated] = useState("");
  const pressure = useCollection<PressurePoint>(
    `/telemetry/pressure-map${area ? "?kebeleId=" + area : ""}`,
    30000,
  );
  const flow = useCollection<FlowPoint>(
    area
      ? `/consensus/kebeles/${area}/standpipes`
      : "/public/standpipes?limit=1",
    area ? 30000 : 0,
  );
  useEffect(() => {
    if (!pressure.loading && !pressure.error)
      setUpdated(new Date().toLocaleTimeString());
  }, [pressure.loading, pressure.error]);
  useEffect(() => {
    setSelected("");
    setHistory([]);
    setStats(null);
  }, [area, mode]);
  useEffect(() => {
    let active = true;
    setHistoryError("");
    setHistory([]);
    setStats(null);
    if (!selected || mode !== "pressure") return;
    const load = () =>
      Promise.all([
        api<{ items: Reading[] }>(
          `/telemetry/readings?sensorId=${selected}&limit=100`,
        ),
        api<typeof stats>(
          `/telemetry/pressure-stats?sensorId=${selected}&windowMinutes=1440`,
        ),
      ])
        .then(([readings, summary]) => {
          if (active) {
            setHistory(readings.items);
            setStats(summary);
          }
        })
        .catch((failure) => {
          if (active) setHistoryError(failure.message);
        });
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selected, mode]);
  const points: MapPoint[] =
    mode === "pressure"
      ? pressure.items.map((point) => ({
          id: point.id,
          name: point.name,
          latitude: point.latitude,
          longitude: point.longitude,
          value: point.pressure,
          label:
            point.pressure == null
              ? "No measurement"
              : `${point.pressure} bar · ${human(point.source || "unknown")}`,
          color: pressureColor(point.pressure),
          stale: point.status !== "ACTIVE" || isStale(point.observedAt),
        }))
      : area
        ? flow.items.map((point) => ({
            id: point.standpipeId,
            name: point.name,
            latitude: point.locationLatitude,
            longitude: point.locationLongitude,
            value: point.tapConfidence,
            label: `${human(point.tapStatus)} · ${Math.round(point.tapConfidence * 100)}% confidence`,
            color:
              point.tapStatus === "FULL_FLOW"
                ? "#22866c"
                : point.tapStatus === "TRICKLE"
                  ? "#b68516"
                  : point.tapStatus === "DRY"
                    ? "#d75a4a"
                    : "#7c8d88",
            stale: isStale(point.tapLastObservedAt),
          }))
        : [];
  const selectedFlow = flow.items.find(
      (point) => point.standpipeId === selected,
    ),
    selectedPressure = pressure.items.find((point) => point.id === selected);
  const samples = [...history].reverse(),
    max = Math.max(1, ...samples.map((reading) => reading.pressureBar));
  const filtered = points.filter(
    (point) =>
      (!freshOnly || !point.stale) &&
      `${point.name} ${point.label}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="panel dispatch-page">
      <h2>Live network observations</h2>
      <div className="dispatch-toolbar">
        <RecordPicker
          endpoint="/kebeles"
          name="monitorArea"
          label="Service area"
          required={false}
          hint="All areas for measured pressure; choose an area to inspect crowd consensus."
          onChange={setArea}
        />
        <FormField label="Observation layer">
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="pressure">Measured pressure (bar)</option>
            <option value="flow">Crowdsourced flow consensus</option>
          </select>
        </FormField>
        <button
          className="button button-outline"
          onClick={() => {
            void pressure.reload();
            if (area) void flow.reload();
          }}
        >
          Refresh observations
        </button>
      </div>
      <p>
        Refreshes every 30 seconds while visible. Last pressure refresh:{" "}
        {updated || "waiting"}. Flow consensus does not measure pressure in bar.
      </p>
      <FormFeedback error={pressure.error || (area ? flow.error : "")} />
      <div className="dispatch-toolbar">
        <FormField label="Find an observation">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, flow condition or pressure"
          />
        </FormField>
        <FormField label="Observation freshness">
          <select
            value={freshOnly ? "fresh" : "all"}
            onChange={(event) => setFreshOnly(event.target.value === "fresh")}
          >
            <option value="all">All observations, including stale</option>
            <option value="fresh">Recent observations only</option>
          </select>
        </FormField>
      </div>
      {mode === "flow" && !area ? (
        <p>Choose a service area to load flow and queue consensus.</p>
      ) : (
        <>
          <NetworkMap
            points={filtered}
            selectedId={selected}
            onSelect={setSelected}
            onInspect={(id) => {
              setSelected(id);
              requestAnimationFrame(() => {
                document
                  .getElementById("network-observation-detail")
                  ?.scrollIntoView({
                    block: "start",
                    behavior: matchMedia("(prefers-reduced-motion: reduce)")
                      .matches
                      ? "instant"
                      : "smooth",
                  });
              });
            }}
          />
          <div className="dispatch-toolbar">
            <span>
              ● Green: {mode === "pressure" ? "1.5–5 bar" : "full flow"}
            </span>
            <span>● Amber: {mode === "pressure" ? ">5 bar" : "trickle"}</span>
            <span>● Red: {mode === "pressure" ? "<1.5 bar" : "dry"}</span>
          </div>
          <p>
            {filtered.length} of {points.length} observations shown. Gray
            markers represent stale or unavailable observations.
          </p>
          <div className="network-results" data-tour-target="map-results">
            {filtered.map((point) => (
              <button
                key={point.id}
                className={`dispatch-record ${point.id === selected ? "is-selected" : ""}`}
                onClick={() => setSelected(point.id)}
              >
                <strong>{point.name}</strong>
                <span>
                  {point.label}
                  {point.stale ? " · Stale / unavailable" : ""}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {selectedPressure && mode === "pressure" && (
        <article id="network-observation-detail">
          <h3>{selectedPressure.name} · Pressure history</h3>
          <p>
            Latest observation: {when(selectedPressure.observedAt)} ·{" "}
            {human(selectedPressure.source || "unknown")}
          </p>
          <FormFeedback error={historyError} />
          {stats && (
            <div className="dispatch-metrics">
              <article>
                24h average
                <strong>{stats.averagePressureBar ?? "—"} bar</strong>
              </article>
              <article>
                24h range
                <strong>
                  {stats.minimumPressureBar ?? "—"} –{" "}
                  {stats.maximumPressureBar ?? "—"}
                </strong>
              </article>
              <article>
                24h samples<strong>{stats.sampleCount}</strong>
              </article>
            </div>
          )}
          {samples.length > 0 && (
            <svg
              className="dispatch-chart"
              viewBox="0 0 700 160"
              role="img"
              aria-label="Pressure history in bar, oldest to newest"
            >
              <polyline
                fill="none"
                stroke="#278467"
                strokeWidth="3"
                points={samples
                  .map(
                    (reading, index) =>
                      `${25 + (index / Math.max(1, samples.length - 1)) * 650},${135 - (reading.pressureBar / max) * 110}`,
                  )
                  .join(" ")}
              />
              <text x="8" y="18" fill="currentColor">
                {max.toFixed(2)} bar
              </text>
              <text x="8" y="155" fill="currentColor">
                0 bar · oldest → newest
              </text>
            </svg>
          )}
          <details>
            <summary>
              View pressure readings ({history.length} most recent)
            </summary>
            {history.map((reading) => (
              <p key={reading.id}>
                {when(reading.observedAt)} — {reading.pressureBar} bar ·{" "}
                {human(reading.source)}
              </p>
            ))}
          </details>
        </article>
      )}
      {mode === "flow" && selectedFlow && (
        <article id="network-observation-detail">
          <h3>{selectedFlow.name}</h3>
          <p>
            {human(selectedFlow.tapStatus)} · {selectedFlow.tapSampleCount}{" "}
            weighted reports · {Math.round(selectedFlow.tapConfidence * 100)}%
            confidence
          </p>
          <p>Last flow observation: {when(selectedFlow.tapLastObservedAt)}</p>
          <p>
            Queue estimate:{" "}
            {selectedFlow.waitMinutes == null
              ? "Unavailable"
              : `${selectedFlow.waitMinutes} minutes`}{" "}
            · updated {when(selectedFlow.queueLastCalculatedAt)}
          </p>
        </article>
      )}
    </section>
  );
}
