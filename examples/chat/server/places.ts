import type { Plugin } from "vite";

export interface Place {
  photos: string[];
}

interface Summary {
  thumbnail?: { source?: string };
}
interface MediaList {
  items?: { type?: string; srcset?: { src: string }[] }[];
}
interface SearchResult {
  query?: { pages?: { thumbnail?: { source?: string } }[] };
}
interface FilesResult {
  query?: { pages?: { title: string; index?: number; imageinfo?: { thumburl?: string }[] }[] };
}

const cache = new Map<string, Place>();
const MAX_CACHED = 500;
const HEADERS = { "User-Agent": "chat example (server-side place lookup)" };
const NOT_A_PHOTO = /\.svg|icon|logo|map|flag|seal/i;
/** The file behind a thumbnail URL, so different sizes of one photo count once. */
const fileOf = (url: string) =>
  decodeURIComponent(url.split("?")[0]?.split("/").pop() ?? "").replace(/^\d+px-/, "");

// Wikimedia answers 429 to a burst of lookups, so a failed request is tried once more.
async function get<T>(url: string, retry = true): Promise<T | undefined> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (response.status === 404) return undefined;
  if (response.ok) return (await response.json()) as T;
  if (!retry) throw new Error(`Wikimedia answered ${response.status}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return get<T>(url, false);
}

const wikipedia = <T>(path: string, title: string) =>
  get<T>(
    `https://en.wikipedia.org/api/rest_v1/page/${path}/${encodeURIComponent(title.replaceAll(" ", "_"))}`,
  );

/** Lowercase letters and digits only, so "Entoku-in", "Entokuin" and "Kōdai-ji" compare. */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** The lead photo of the top search hit, for a title that is not an article's exact name. */
async function searchPhoto(title: string): Promise<string | undefined> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: title,
    gsrnamespace: "0",
    gsrlimit: "1",
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: "640",
  });
  const result = await get<SearchResult>(`https://en.wikipedia.org/w/api.php?${params}`);
  const found = result?.query?.pages?.[0]?.thumbnail?.source;
  return found && !NOT_A_PHOTO.test(found) ? found : undefined;
}

/**
 * The nearest Commons photo taken within 300 m whose file name shares a word with the title,
 * for a place with no English article (many small temples and shrines).
 */
async function nearbyPhoto(title: string, lat: number, lng: number): Promise<string | undefined> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "geosearch",
    ggscoord: `${lat}|${lng}`,
    ggsradius: "300",
    ggslimit: "50",
    ggsnamespace: "6",
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "640",
  });
  const result = await get<FilesResult>(`https://commons.wikimedia.org/w/api.php?${params}`);
  const words = title
    .split(/[\s,()]+/)
    .map(fold)
    .filter((w) => w.length >= 4);
  const files = (result?.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const match = files.find(
    (f) =>
      /\.(jpe?g|png|webp)$/i.test(f.title) &&
      !NOT_A_PHOTO.test(f.title) &&
      words.some((w) => fold(f.title).includes(w)),
  );
  return match?.imageinfo?.[0]?.thumburl;
}

async function articlePhotos(title: string): Promise<string[]> {
  const [summary, media] = await Promise.all([
    wikipedia<Summary>("summary", title),
    wikipedia<MediaList>("media-list", title),
  ]);
  const lead = summary?.thumbnail?.source;
  const photos = lead && !NOT_A_PHOTO.test(lead) ? [lead] : [];
  for (const item of media?.items ?? []) {
    const src = item.type === "image" ? item.srcset?.[0]?.src : undefined;
    if (!src || NOT_A_PHOTO.test(src) || photos.length >= 3) continue;
    const url = src.startsWith("//") ? `https:${src}` : src;
    if (!photos.some((p) => fileOf(p) === fileOf(url))) photos.push(url);
  }
  return photos;
}

// Models write names that are not exact titles ("Hōkan-ji" for Yasaka Pagoda), which fall back
// to search, and places with no article, which fall back to photos taken nearby. Only an
// answer that did not fail is cached.
async function lookup(
  title: string,
  near?: [number, number],
): Promise<{ place: Place; final: boolean }> {
  const photos = await articlePhotos(title).catch(() => undefined);
  if (photos?.length) return { place: { photos }, final: true };
  const found =
    (await searchPhoto(title).catch(() => undefined)) ??
    (near ? await nearbyPhoto(title, ...near) : undefined);
  return { place: { photos: found ? [found] : [] }, final: photos !== undefined };
}

/** GET /api/places?title=<Wikipedia title>[&lat=&lng=]: photos of a place, cached. */
export function placesRoute(): Plugin {
  return {
    name: "places-route",
    configureServer(server) {
      server.middlewares.use("/api/places", async (req, res) => {
        const query = new URL(req.url ?? "", "http://localhost").searchParams;
        const title = query.get("title")?.trim();
        if (!title || title.length > 200) return res.writeHead(400).end("title is required");
        const lat = Number(query.get("lat") ?? NaN);
        const lng = Number(query.get("lng") ?? NaN);
        const near: [number, number] | undefined =
          Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : undefined;
        const key = near ? `${title}@${near.join(",")}` : title;
        try {
          let place = cache.get(key);
          if (!place) {
            const result = await lookup(title, near);
            place = result.place;
            if (result.final) {
              if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
              cache.set(key, place);
            }
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(place));
        } catch {
          res.writeHead(502).end("Wikipedia is unavailable");
        }
      });
    },
  };
}
