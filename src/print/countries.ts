// Which country a place is in, and what it's called, from the Natural Earth countries in world-atlas.

import { geoBounds, geoCentroid, geoContains, geoArea } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson';
import isoCountries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import pt from 'i18n-iso-countries/langs/pt.json';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Lang } from './types';

isoCountries.registerLocale(en);
isoCountries.registerLocale(pt);

export interface Country {
  /** ISO 3166-1 alpha-2, lower case (as flag-icons names its files); '' if it has none. */
  code: string;
  name: string;
  feature: Feature<Geometry>;
  bounds: [[number, number], [number, number]];
}

/** Natural Earth units without an ISO numeric code. */
const NAME_CODES: Record<string, string> = { Kosovo: 'xk', 'N. Cyprus': 'cy', Somaliland: 'so' };

/** Shorter or more familiar names than the ISO ones. */
const SHORT_NAMES: Record<Lang, Record<string, string>> = {
  en: { us: 'United States', gb: 'United Kingdom', ru: 'Russia', kr: 'South Korea', kp: 'North Korea', ir: 'Iran', sy: 'Syria', bo: 'Bolivia', ve: 'Venezuela', tz: 'Tanzania', cd: 'DR Congo', la: 'Laos', vn: 'Vietnam', md: 'Moldova', mk: 'North Macedonia', cv: 'Cabo Verde', tw: 'Taiwan' },
  pt: { us: 'Estados Unidos', gb: 'Reino Unido', ru: 'Rússia', cd: 'RD Congo', cv: 'Cabo Verde' },
};

/** Country name for a code in the chosen language. */
export function countryName(code: string, lang: Lang, fallback = ''): string {
  if (!code) return fallback;
  return SHORT_NAMES[lang][code] ?? isoCountries.getName(code.toUpperCase(), lang) ?? fallback;
}

/**
 * Fixes polygons wound the wrong way. d3 reads a ring's direction to tell inside from outside, so a
 * reversed ring means "the whole globe except this island" and floods the map (Natural Earth 1:10m
 * has a few such degenerate islets in the Maldives). Any polygon covering more than half the globe
 * is turned the right way round.
 */
export function repairWinding<G extends Geometry>(g: G): G {
  const fix = (rings: Polygon['coordinates']) =>
    geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI ? rings.map((r) => [...r].reverse()) : rings;
  if (g.type === 'Polygon') return { ...g, coordinates: fix((g as Polygon).coordinates) };
  if (g.type === 'MultiPolygon') return { ...g, coordinates: (g as MultiPolygon).coordinates.map(fix) };
  if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map(repairWinding) };
  return g;
}

/** A topology object as GeoJSON with its winding repaired. */
export function topoFeatures(topology: Topology, name: string): FeatureCollection<Geometry, { name?: string }> {
  const raw = feature(topology, topology.objects[name] as GeometryCollection) as FeatureCollection<Geometry, { name?: string }> | Feature<Geometry, { name?: string }>;
  const features = raw.type === 'FeatureCollection' ? raw.features : [raw];
  return { type: 'FeatureCollection', features: features.map((f) => ({ ...f, geometry: f.geometry && repairWinding(f.geometry) })) };
}

export function loadCountries(topology: Topology): Country[] {
  const fc = topoFeatures(topology, 'countries');
  return fc.features.map((f) => {
    const name = f.properties?.name ?? '';
    const code = (f.id !== undefined ? isoCountries.numericToAlpha2(String(f.id)) : undefined)?.toLowerCase() ?? NAME_CODES[name] ?? '';
    return { code, name, feature: f, bounds: geoBounds(f) as [[number, number], [number, number]] };
  });
}

const inBounds = (c: Country, lon: number, lat: number) => {
  const [[w, s], [e, n]] = c.bounds;
  if (lat < s - 0.01 || lat > n + 0.01) return false;
  return w <= e ? lon >= w - 0.01 && lon <= e + 0.01 : lon >= w || lon <= e; // bounds may cross the antimeridian
};

/** Aliases people write for countries in place names. */
const ALIASES: Record<string, string> = {
  usa: 'us', 'u.s.a.': 'us', 'united states': 'us', eua: 'us', 'estados unidos': 'us', england: 'gb', scotland: 'gb',
  wales: 'gb', 'northern ireland': 'gb', uk: 'gb', 'great britain': 'gb', brasil: 'br', holland: 'nl', azores: 'pt',
  açores: 'pt', madeira: 'pt',
};

/** Country from the last part of a place name ("Braga, Portugal" → pt), if it's recognisable. */
export function countryFromName(place: string): string {
  const last = place.split(',').map((s) => s.trim()).filter(Boolean).pop()?.toLowerCase();
  if (!last) return '';
  if (ALIASES[last]) return ALIASES[last];
  const code = isoCountries.getAlpha2Code(last, 'en') ?? isoCountries.getAlpha2Code(last, 'pt');
  return code?.toLowerCase() ?? '';
}

/**
 * Finds countries for places. Tries the map first (towns on the coast can fall just outside the
 * generalised coastline, so it also looks a little way around them), then the place name.
 */
export class CountryLocator {
  readonly countries: Country[];
  private cache = new Map<string, string>();

  constructor(topology: Topology) {
    this.countries = loadCountries(topology);
  }

  codeAt(lon: number, lat: number): string {
    for (const c of this.countries) if (inBounds(c, lon, lat) && geoContains(c.feature, [lon, lat])) return c.code;
    return '';
  }

  locate(p: { lat: number; lon: number; place?: string }): string {
    const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}|${p.place ?? ''}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let code = this.codeAt(p.lon, p.lat);
    if (!code) {
      // Look around the point, nearest first.
      search: for (const r of [0.1, 0.25, 0.5]) {
        for (let a = 0; a < 8; a++) {
          const ang = (a * Math.PI) / 4;
          code = this.codeAt(p.lon + r * Math.cos(ang), p.lat + r * Math.sin(ang));
          if (code) break search;
        }
      }
    }
    if (!code && p.place) code = countryFromName(p.place);
    this.cache.set(key, code);
    return code;
  }

  byCode(code: string): Country | undefined {
    return this.countries.find((c) => c.code === code);
  }

  /** Where to write a country's name: the centre of its largest piece of land. */
  labelPoint(code: string): [number, number] | null {
    const c = this.byCode(code);
    if (!c) return null;
    const g = c.feature.geometry;
    if (g.type === 'Polygon') return geoCentroid(c.feature);
    if (g.type === 'MultiPolygon') {
      const polys = (g as MultiPolygon).coordinates.map((coords) => ({ type: 'Polygon', coordinates: coords }) as Polygon);
      const biggest = polys.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
      return geoCentroid(biggest);
    }
    return null;
  }
}
