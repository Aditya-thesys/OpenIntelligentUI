import { useTheme } from "@openuidev/react-ui";
import type { Feature } from "geojson";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Stop } from "./route";

const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
// Stops stream in; ask for directions once they settle.
const SETTLE_MS = 800;
// Room for the filter chips along the top edge and the attribution button in a corner.
const PADDING = { top: 64, right: 48, bottom: 48, left: 32 };
// The map is as tall as the route needs, within these bounds, so a wide route leaves no empty band.
const MIN_HEIGHT = 220;
const MAX_HEIGHT = 360;
// Pins closer than this many pixels are pushed apart so each number stays readable.
const PIN_SPACING = 26;

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

function heightFor(pins: Pin[], width: number) {
  const lngs = pins.map((p) => p.lng);
  const ys = pins.map((p) => mercatorY(p.lat));
  const spanX = ((Math.max(...lngs) - Math.min(...lngs)) * Math.PI) / 180;
  const spanY = Math.max(...ys) - Math.min(...ys);
  if (!spanX) return MAX_HEIGHT;
  const inner = (width - PADDING.left - PADDING.right) * (spanY / spanX);
  return Math.round(
    Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, inner + PADDING.top + PADDING.bottom)),
  );
}

/** Offsets each marker that would cover an earlier one to the side of it. */
function spreadMarkers(map: maplibregl.Map, markers: maplibregl.Marker[]) {
  const placed: { x: number; y: number }[] = [];
  for (const marker of markers) {
    const at = map.project(marker.getLngLat());
    let { x, y } = at;
    for (let tries = 0; tries < 8; tries++) {
      const hit = placed.find((q) => Math.hypot(q.x - x, q.y - y) < PIN_SPACING);
      if (!hit) break;
      const angle = x === hit.x && y === hit.y ? 0 : Math.atan2(y - hit.y, x - hit.x);
      x = hit.x + Math.cos(angle) * PIN_SPACING;
      y = hit.y + Math.sin(angle) * PIN_SPACING;
    }
    placed.push({ x, y });
    marker.setOffset([x - at.x, y - at.y]);
  }
}

// The dark style's labels are too faint to read on a phone.
function brightenLabels(map: maplibregl.Map) {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol" || !map.getLayoutProperty(layer.id, "text-field")) continue;
    map.setPaintProperty(layer.id, "text-color", "#b8bcc4");
    map.setPaintProperty(layer.id, "text-halo-color", "#16181c");
    map.setPaintProperty(layer.id, "text-halo-width", 1.2);
  }
}

// When each map last changed its pins. A change within STREAMING_MS of the last one is the answer
// still streaming in, so the view jumps instead of animating past pins; a later edit animates.
const changed = new WeakMap<maplibregl.Map, number>();
const STREAMING_MS = 2000;

type Pin = Pick<Stop, "name" | "lat" | "lng" | "category">;
type Line = { points: [number, number][]; walking: boolean };

function useLine(pins: Pin[]): Line | null {
  const [line, setLine] = useState<Line | null>(null);
  useEffect(() => {
    if (pins.length < 2) {
      setLine(null);
      return;
    }
    const direct: Line = { points: pins.map((p) => [p.lat, p.lng]), walking: false };
    const coords = pins.map((p) => `${p.lng},${p.lat}`).join(";");
    let current = true;
    const timer = setTimeout(() => {
      fetch(`/api/directions?coords=${coords}`)
        .then((r) => (r.ok ? (r.json() as Promise<[number, number][]>) : Promise.reject()))
        .then((points) => current && setLine({ points, walking: true }))
        .catch(() => current && setLine(direct));
    }, SETTLE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [pins]);
  return line;
}

export function RouteMapView({ stops }: { stops: Stop[] }) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const style = STYLES[useTheme().mode];
  // Stops arrive as a new array on every render; the key changes only when a pin does.
  const key = JSON.stringify(
    stops.map(({ name, lat, lng, category }) => [name, lat, lng, category]),
  );
  const pins = useMemo(
    () =>
      (JSON.parse(key) as [string, number, number, string?][]).map(
        ([name, lat, lng, category]): Pin => ({ name, lat, lng, category }),
      ),
    [key],
  );
  const line = useLine(pins);
  const categories = [...new Set(pins.flatMap((p) => (p.category ? [p.category] : [])))];

  useEffect(() => {
    if (!container.current) return;
    const canvasBox = container.current;
    canvasBox.classList.remove("ready");
    const created = new maplibregl.Map({
      container: container.current,
      style,
      center: [0, 20],
      zoom: 1,
      attributionControl: { compact: true },
    });
    // The canvas shows once its first tiles are drawn, not as a black or grey box before.
    created.once("idle", () => canvasBox.classList.add("ready"));
    created.on("load", () => {
      // The compact attribution starts expanded over the map; start it folded.
      created
        .getContainer()
        .querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show");
      if (style === STYLES.dark) brightenLabels(created);
      setMap(created);
    });
    return () => {
      setMap(null);
      created.remove();
    };
  }, [style]);

  // Markers follow the pins; the view moves only to bring a pin that is out of sight into it.
  useEffect(() => {
    if (!map || !pins.length) return;
    const markers = pins.map((p, i) => {
      const pin = document.createElement("div");
      pin.className = "travel-pin";
      pin.textContent = String(i + 1);
      pin.title = p.name;
      if (p.category) pin.dataset.category = p.category;
      const wrapper = document.createElement("div");
      wrapper.append(pin);
      return new maplibregl.Marker({ element: wrapper }).setLngLat([p.lng, p.lat]).addTo(map);
    });
    if (frame.current)
      frame.current.style.height = `${heightFor(pins, frame.current.clientWidth)}px`;
    // Also catches a width change: maplibre ignores its first resize observation, which can be
    // the answer column widening while the map loads.
    map.resize();
    // The part of the map clear of the padding, where the chips do not cover a pin. While a fit
    // is still animating, the view is not where it will end, so any new pin refits.
    const { width, height } = map.getContainer().getBoundingClientRect();
    const clear = new maplibregl.LngLatBounds(
      map.unproject([PADDING.left, height - PADDING.bottom]),
      map.unproject([width - PADDING.right, PADDING.top]),
    );
    const last = changed.get(map);
    changed.set(map, Date.now());
    if (last === undefined || map.isEasing() || pins.some((p) => !clear.contains([p.lng, p.lat]))) {
      const bounds = new maplibregl.LngLatBounds();
      pins.forEach((p) => bounds.extend([p.lng, p.lat]));
      const settled = last !== undefined && Date.now() - last > STREAMING_MS;
      map.fitBounds(bounds, { padding: PADDING, maxZoom: 15, duration: settled ? 400 : 0 });
    }
    const spread = () => spreadMarkers(map, markers);
    spread();
    map.on("zoom", spread);
    map.on("moveend", spread);
    return () => {
      map.off("zoom", spread);
      map.off("moveend", spread);
      markers.forEach((m) => m.remove());
    };
  }, [map, pins]);

  useEffect(() => {
    container.current?.querySelectorAll<HTMLElement>(".travel-pin").forEach((pin) => {
      pin.classList.toggle("dimmed", category !== null && pin.dataset.category !== category);
    });
  }, [map, pins, category]);

  useEffect(() => {
    if (!map) return;
    const data: Feature = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: (line?.points ?? []).map(([lat, lng]) => [lng, lat]),
      },
    };
    const source = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      map.addSource("route", { type: "geojson", data });
      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        paint: { "line-color": "#2563eb", "line-width": 3 },
      });
    }
    map.setPaintProperty("route", "line-dasharray", line?.walking === false ? [2, 2] : [1, 0]);
  }, [map, line]);

  return (
    <div ref={frame} className="travel-map">
      <div ref={container} className="travel-map-canvas" />
      {categories.length > 1 && (
        <div className="travel-filters">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? "all"}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c ?? "All"}
            </button>
          ))}
        </div>
      )}
      {line && !line.walking && (
        <span className="travel-map-note">Straight lines: walking directions unavailable</span>
      )}
    </div>
  );
}
