import type { Plugin } from "vite";

const cache = new Map<string, [number, number][]>();
const MAX_STOPS = 25;
const MAX_CACHED = 500;

function parse(coords: string): string | null {
  // An empty part must not read as 0.
  const points = coords
    .split(";")
    .map((pair) => pair.split(",").map((n) => (n.trim() ? Number(n) : NaN)));
  const valid =
    points.length >= 2 &&
    points.length <= MAX_STOPS &&
    points.every(
      (p) => p.length === 2 && Math.abs(p[0] ?? NaN) <= 180 && Math.abs(p[1] ?? NaN) <= 90,
    );
  return valid ? points.map((p) => p.join(",")).join(";") : null;
}

/** GET /api/directions?coords=lng,lat;lng,lat: a walking route from OSRM, cached. */
export function directionsRoute(): Plugin {
  return {
    name: "directions-route",
    configureServer(server) {
      server.middlewares.use("/api/directions", async (req, res) => {
        const key = parse(
          new URL(req.url ?? "", "http://localhost").searchParams.get("coords") ?? "",
        );
        if (!key) return res.writeHead(400).end(`coords must be 2 to ${MAX_STOPS} lng,lat pairs`);
        try {
          let points = cache.get(key);
          if (!points) {
            const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${key}?overview=full&geometries=geojson`;
            const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
            const data = (await response.json()) as {
              routes?: { geometry?: { coordinates?: [number, number][] } }[];
            };
            const line = data.routes?.[0]?.geometry?.coordinates ?? [];
            if (line.length < 2) throw new Error("no route");
            if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
            cache.set(key, (points = line.map(([lng, lat]) => [lat, lng])));
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(points));
        } catch {
          res.writeHead(502).end("Walking directions are unavailable");
        }
      });
    },
  };
}
