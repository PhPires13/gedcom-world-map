// What the customer designed in the print designer, as stored on an order. The server re-renders
// the print from this plus the tree's public view, so it holds choices, never people's data.
// The paper size is not here: it comes from the product size that was bought.

import type { Branch } from '../print/data';
import type { AreaId, Lang, Orientation, PrintOptions } from '../print/types';

export interface DesignSpec {
  styleId: string;
  orientation: Orientation;
  area: AreaId;
  lang: Lang;
  title: string;
  subtitle: string;
  dedication: string;
  show: PrintOptions['show'];
  /** Who is on the map: ids are the tree's person ids (server ids). */
  selection: { rootId?: string; branch: Branch; generations?: number[] };
  /**
   * Coordinates the designer found for place names (the map app's geocoding cache). Only places of
   * people in the tree's public view are used; the rest are ignored.
   */
  places: Record<string, { lat: number; lon: number }>;
}

const AREAS: readonly AreaId[] = ['family', 'world', 'atlantic', 'europe', 'iberia', 'south-america', 'north-america', 'africa'];
const BRANCHES: readonly Branch[] = ['all', 'ancestors', 'paternal', 'maternal'];
const FLAGS = ['origins', 'all', 'none'] as const;
const SHOW_KEYS = ['dates', 'placeNames', 'countryNames', 'oceanNames', 'compass', 'scaleBar', 'legend', 'graticule'] as const;
const MAX_PLACES = 5000;

export class DesignError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function text(v: unknown, field: string, max: number): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new DesignError(`design.${field} must be text`);
  if (v.length > max) throw new DesignError(`design.${field} is too long (max ${max} characters)`);
  return v;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], field: string, fallback: T): T {
  if (v === undefined || v === null || v === '') return fallback;
  if (!allowed.includes(v as T)) throw new DesignError(`design.${field} must be one of ${allowed.join(', ')}`);
  return v as T;
}

/** Checks and normalises a design sent by a browser. `styleIds` are the styles the server knows. */
export function parseDesign(v: unknown, styleIds: readonly string[]): DesignSpec {
  if (!isObj(v)) throw new DesignError('design must be an object');
  const show = isObj(v.show) ? v.show : {};
  const sel = isObj(v.selection) ? v.selection : {};
  const places: DesignSpec['places'] = {};
  if (v.places !== undefined) {
    if (!isObj(v.places)) throw new DesignError('design.places must map place names to {lat, lon}');
    const entries = Object.entries(v.places);
    if (entries.length > MAX_PLACES) throw new DesignError(`design.places has too many entries (max ${MAX_PLACES})`);
    for (const [name, c] of entries) {
      if (name.length > 500) continue;
      if (!isObj(c) || typeof c.lat !== 'number' || typeof c.lon !== 'number' || Math.abs(c.lat) > 90 || Math.abs(c.lon) > 180)
        throw new DesignError(`design.places["${name.slice(0, 40)}"] must be {lat, lon}`);
      places[name] = { lat: c.lat, lon: c.lon };
    }
  }
  let generations: number[] | undefined;
  if (sel.generations !== undefined && sel.generations !== null) {
    if (!Array.isArray(sel.generations) || sel.generations.some((g) => !Number.isInteger(g) || g < 0 || g > 200))
      throw new DesignError('design.selection.generations must be a list of generation numbers');
    generations = [...new Set(sel.generations as number[])].sort((a, b) => a - b);
  }
  if (sel.rootId !== undefined && sel.rootId !== null && typeof sel.rootId !== 'string') throw new DesignError('design.selection.rootId must be a person id');
  return {
    styleId: pick(v.styleId, styleIds, 'styleId', styleIds[0]),
    orientation: pick(v.orientation, ['landscape', 'portrait'] as const, 'orientation', 'landscape'),
    area: pick(v.area, AREAS, 'area', 'family'),
    lang: pick(v.lang, ['pt', 'en'] as const, 'lang', 'pt'),
    title: text(v.title, 'title', 120),
    subtitle: text(v.subtitle, 'subtitle', 120),
    dedication: text(v.dedication, 'dedication', 600),
    show: {
      ...(Object.fromEntries(SHOW_KEYS.map((k) => [k, show[k] === undefined ? true : show[k] === true])) as Omit<PrintOptions['show'], 'flags'>),
      flags: pick(show.flags, FLAGS, 'show.flags', 'origins'),
    },
    selection: {
      rootId: (sel.rootId as string | undefined) || undefined,
      branch: pick(sel.branch, BRANCHES, 'selection.branch', 'all'),
      generations,
    },
    places,
  };
}
