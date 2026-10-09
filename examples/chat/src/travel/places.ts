import { useEffect, useState } from "react";
import type { Place } from "../../server/places";

const requests = new Map<string, Promise<Place | null>>();

function fetchPlace(query: string) {
  let request = requests.get(query);
  if (!request) {
    request = fetch(`/api/places?${query}`)
      .then((r) => (r.ok ? (r.json() as Promise<Place>) : null))
      .catch(() => null);
    requests.set(query, request);
  }
  return request;
}

// undefined while loading, null if unavailable. Coordinates find photos of places with no article.
export function usePlace(title: string | undefined, lat?: number, lng?: number) {
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const query = title
    ? new URLSearchParams({
        title,
        ...(lat !== undefined && lng !== undefined && { lat: String(lat), lng: String(lng) }),
      }).toString()
    : undefined;
  useEffect(() => {
    if (!query) return;
    let current = true;
    void fetchPlace(query).then((p) => current && setPlace(p));
    return () => {
      current = false;
    };
  }, [query]);
  return place;
}
