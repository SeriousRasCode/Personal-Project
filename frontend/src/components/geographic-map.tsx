import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapPoint } from "../lib/monitoring";
import "./geographic-map.css";
const jimma: L.LatLngTuple = [7.673, 36.835];
export function NetworkMap({
  points,
  onSelect,
  selectedId,
  onInspect,
}: {
  points: MapPoint[];
  onSelect: (id: string) => void;
  selectedId?: string;
  onInspect?: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    markers = useRef(new Map<string, L.CircleMarker>()),
    layer = useRef<L.LayerGroup | null>(null),
    select = useRef(onSelect),
    inspect = useRef(onInspect),
    signature = useRef("");
  const [tilesFailed, setTilesFailed] = useState(false),
    [expanded, setExpanded] = useState(false);
  select.current = onSelect;
  inspect.current = onInspect;
  const located = points.filter(
    (point) =>
      point.latitude != null &&
      point.longitude != null &&
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      Math.abs(point.latitude) <= 90 &&
      Math.abs(point.longitude) <= 180,
  );
  function fit() {
    const instance = map.current;
    if (!instance) return;
    if (located.length)
      instance.fitBounds(
        L.latLngBounds(
          located.map((point) => [point.latitude!, point.longitude!]),
        ),
        { padding: [48, 48], maxZoom: 16, animate: false },
      );
    else instance.setView(jimma, 13, { animate: false });
  }
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, {
      center: jimma,
      zoom: 13,
      scrollWheelZoom: false,
      keyboard: true,
      zoomAnimation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    map.current = instance;
    const url =
      import.meta.env.VITE_MAP_TILE_URL ||
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
    const attribution =
      import.meta.env.VITE_MAP_ATTRIBUTION ||
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    const tiles = L.tileLayer(url, {
      attribution,
      maxZoom: 19,
      referrerPolicy: "strict-origin-when-cross-origin",
    }).addTo(instance);
    tiles.on("tileerror", () => setTilesFailed(true));
    layer.current = L.layerGroup().addTo(instance);
    L.control.scale({ imperial: false }).addTo(instance);
    const observer = new ResizeObserver(() =>
      instance.invalidateSize({ animate: false }),
    );
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
      layer.current = null;
      signature.current = "";
    };
  }, []);
  useEffect(() => {
    const instance = map.current,
      group = layer.current;
    if (!instance || !group) return;
    group.clearLayers();
    markers.current.clear();
    for (const point of located) {
      const color = point.stale ? "#788b8a" : point.color;
      L.circle([point.latitude!, point.longitude!], {
        radius: 90,
        color,
        weight: 0,
        fillColor: color,
        fillOpacity: point.stale ? 0.06 : 0.12,
        interactive: false,
      }).addTo(group);
      const marker = L.circleMarker([point.latitude!, point.longitude!], {
        radius: point.id === selectedId ? 11 : 8,
        color: point.id === selectedId ? "#113e42" : "#ffffff",
        weight: 3,
        fillColor: color,
        fillOpacity: 1,
      }).addTo(group);
      const popup = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = point.name;
      popup.append(title);
      const value = document.createElement("p");
      value.textContent =
        point.label + (point.stale ? " · Stale / unavailable" : "");
      popup.append(value);
      const coords = document.createElement("p");
      coords.textContent = `${point.latitude!.toFixed(5)}, ${point.longitude!.toFixed(5)}`;
      popup.append(coords);
      const action = document.createElement("button");
      action.type = "button";
      action.className = "button button-primary";
      action.textContent = "Inspect observation";
      action.onclick = () => (inspect.current || select.current)(point.id);
      popup.append(action);
      const link = document.createElement("a");
      link.href = `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=17/${point.latitude}/${point.longitude}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open location ↗";
      popup.append(link);
      marker.bindPopup(popup);
      marker.on("click", () => select.current(point.id));
      markers.current.set(point.id, marker);
      const element = marker.getElement();
      if (element) {
        element.setAttribute("tabindex", "0");
        element.setAttribute("role", "button");
        element.setAttribute(
          "aria-label",
          `${point.name}: ${point.label}${point.stale ? " (stale)" : ""}`,
        );
        element.addEventListener("keydown", (event) => {
          if (
            event instanceof KeyboardEvent &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            marker.openPopup();
            select.current(point.id);
          }
        });
      }
    }
    const next = located
      .map((point) => `${point.id}:${point.latitude}:${point.longitude}`)
      .sort()
      .join("|");
    if (next !== signature.current) {
      signature.current = next;
      fit();
    }
  }, [points, selectedId]);
  useEffect(() => {
    const marker = selectedId ? markers.current.get(selectedId) : null;
    if (marker && map.current) {
      map.current.panTo(marker.getLatLng(), { animate: false });
      marker.openPopup();
    }
  }, [selectedId, points]);
  return (
    <div
      className={`network-map ${expanded ? "is-expanded" : ""}`}
      data-tour-target="network-map"
    >
      <div className="network-map-tools">
        <div>
          <strong>Jimma network map</strong>
          <small>
            {located.length} located · {points.length - located.length} missing
            coordinates
          </small>
        </div>
        <div>
          <button type="button" className="button button-outline" onClick={fit}>
            Fit observations
          </button>
          <button
            type="button"
            className="button button-outline"
            onClick={() => setExpanded((value) => !value)}
            aria-pressed={expanded}
          >
            {expanded ? "Compact map" : "Expand map"}
          </button>
        </div>
      </div>
      <div
        ref={container}
        className="network-map-canvas"
        role="region"
        aria-label="Interactive geographic observation map. Pan with arrow keys, zoom with plus and minus, or use the observation list."
      />
      {tilesFailed && (
        <p className="network-map-warning" role="status">
          Street tiles could not be loaded. Observation markers, coordinates and
          the list remain available. Check your connection or configured tile
          provider.
        </p>
      )}
      {!located.length && (
        <p className="network-map-empty" role="status">
          Showing Jimma as geographic context. No observations match the current
          layer or filters; no measurement values are invented.
        </p>
      )}
      <p className="network-map-caption">
        Drag to pan; use + / − to zoom. Select a marker or a record below for
        details. Halos mark observation locations, not a continuous hydraulic
        model.
      </p>
    </div>
  );
}
