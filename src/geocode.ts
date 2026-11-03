// Place-name geocoding via OpenStreetMap Nominatim.
// Usage policy: max 1 request/second, results cached locally so each place is looked up once.
// https://operations.osmfoundation.org/policies/nominatim/

export interface Coords {
  lat: number;
  lon: number;
  /** The query string that actually matched (may be a less specific variant of the place). */
  matched: string;
}

const CACHE_KEY = 'gedcom-world-map:geocache:v1';
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100;

type Cache = Record<string, Coords | null>;

function loadCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Cache;
  } catch {
    return {};
  }
}

function saveCache(cache: Cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full or unavailable — cache just won't persist */
  }
}

/**
 * Query variants from most to least specific:
 * "Hamlet, Parish, County, Country" → "Parish, County, Country" → "County, Country".
 * Never drops down to the country alone, which would be too misleading.
 */
export function placeVariants(place: string): string[] {
  const parts = place.split(',').map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  const minParts = Math.min(parts.length, 2);
  for (let i = 0; parts.length - i >= minParts; i++) out.push(parts.slice(i).join(', '));
  return out.length ? out : [place];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Geocoder {
  private cache = loadCache();
  private lastRequest = 0;

  cached(place: string): Coords | null | undefined {
    return this.cache[place];
  }

  isCached(place: string): boolean {
    return place in this.cache;
  }

  clear() {
    this.cache = {};
    saveCache(this.cache);
  }

  setManual(place: string, coords: Coords | null) {
    this.cache[place] = coords;
    saveCache(this.cache);
  }

  private async query(q: string, signal?: AbortSignal): Promise<{ lat: number; lon: number } | null> {
    const wait = this.lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequest = Date.now();
    const url = `${ENDPOINT}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (res.status === 429) {
      // Throttled: back off and retry once.
      await sleep(5000);
      return this.query(q, signal);
    }
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
    const data = (await res.json()) as { lat: string; lon: string }[];
    return data[0] ? { lat: Number(data[0].lat), lon: Number(data[0].lon) } : null;
  }

  async geocode(place: string, signal?: AbortSignal): Promise<Coords | null> {
    if (this.isCached(place)) return this.cache[place]!;
    let result: Coords | null = null;
    for (const variant of placeVariants(place)) {
      const hit = await this.query(variant, signal);
      if (hit) {
        result = { ...hit, matched: variant };
        break;
      }
    }
    this.cache[place] = result;
    saveCache(this.cache);
    return result;
  }
}
