import { defineComponent } from "@open-intelligent-ui/react";
import { lazy, Suspense, useState } from "react";
import { z } from "zod/v4";
import { usePlace } from "./places";
import { stop, useRoute, type Stop } from "./route";
import "./travel.css";

// The map library is large, so it loads with the first map.
const RouteMapView = lazy(() => import("./RouteMap").then((m) => ({ default: m.RouteMapView })));

/** A photo of the place, or a neutral placeholder; `optional` photos are left out when there is none. */
function Photo({ title, at, optional = false }: { title: string; at?: Stop; optional?: boolean }) {
  const place = usePlace(title, at?.lat, at?.lng);
  const [failed, setFailed] = useState<string | null>(null);
  const src = place?.photos.find((p) => p !== failed);
  if (src) return <img src={src} alt={title} loading="lazy" onError={() => setFailed(src)} />;
  if (optional && place !== undefined) return null;
  return (
    <div className="travel-photo-empty" role="img" aria-label={title}>
      {place !== undefined && (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
        </svg>
      )}
    </div>
  );
}

export const PhotoStrip = defineComponent({
  name: "photo-strip",
  description:
    "Row of up to 3 photos, one per Wikipedia article title (exact English title, e.g. `Golden Gate Bridge`).",
  props: z.object({ places: z.array(z.string()).max(3) }),
  component: ({ props }) => (
    <div className="travel-photos">
      {props.places.map((title) => (
        <Photo key={title} title={title} optional />
      ))}
    </div>
  ),
});

export const RouteMap = defineComponent({
  name: "route-map",
  description:
    "Map of the route: numbered pins in visiting order, a walking line between them, and category filters. Pass the same stops to itinerary.",
  props: z.object({ stops: z.array(stop) }),
  component: function RouteMapElement({ props }) {
    const route = useRoute(props.stops);
    return (
      <Suspense fallback={<div className="travel-map" />}>
        <RouteMapView stops={route.active} />
      </Suspense>
    );
  },
});

export const Itinerary = defineComponent({
  name: "itinerary",
  description:
    "The stops in order with a photo, time and note each; the user can remove and restore stops.",
  props: z.object({ stops: z.array(stop) }),
  component: function ItineraryElement({ props }) {
    const route = useRoute(props.stops);
    let number = 0;
    return (
      <ol className="travel-itinerary">
        {route.all.map((s) => {
          const removed = route.isRemoved(s);
          return (
            <li key={s.name} className={removed ? "removed" : undefined}>
              <Photo title={s.wikiTitle} at={s} />
              <div>
                <span className="travel-meta">
                  {removed ? "Removed" : `${++number}${s.time ? ` · ${s.time}` : ""}`}
                </span>
                <strong>{s.name}</strong>
                {s.note && <p>{s.note}</p>}
              </div>
              <button type="button" onClick={() => route.toggle(s)}>
                {removed ? "Restore" : "Remove"}
              </button>
            </li>
          );
        })}
      </ol>
    );
  },
});

export const Suggestions = defineComponent({
  name: "suggestions",
  description:
    "Extra places the user can add to the route with one tap. Give 2 or 3 not already in it.",
  props: z.object({ stops: z.array(stop) }),
  component: function SuggestionsElement({ props }) {
    const route = useRoute([]);
    return (
      <div className="travel-suggestions">
        {props.stops.map((s: Stop) => (
          <div key={s.name}>
            <Photo title={s.wikiTitle} at={s} />
            <strong>{s.name}</strong>
            <button type="button" disabled={route.isAdded(s)} onClick={() => route.add(s)}>
              {route.isAdded(s) ? "Added to my route" : "+ Add to my route"}
            </button>
          </div>
        ))}
      </div>
    );
  },
});

export const travelComponents = [PhotoStrip, RouteMap, Itinerary, Suggestions];
