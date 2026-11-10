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
  /** Map layout (src/print/layouts/*.json): geographic, close-up, storybook, medallions. */
  layoutId: string;
  /** Decorative border (src/print/borders/*.json); undefined = the style's own frame. */
  borderId?: string;
  /** Paper finish (src/print/finishes/*.json); undefined = the style's own paper. */
  finishId?: string;
  /** Size of the flag roundels relative to the style's (1 = as designed). */
  flagScale: number;
  /**
   * Essential (the default): a few main routes, the direct line ranked first. Detailed: every move.
   * Orders saved before this choice existed have none and are drawn detailed, as their preview was.
   */
  routes?: 'essential' | 'detailed';
  /** Most routes in essential mode; undefined = the renderer's default for the paper size. */
  maxRoutes?: number;
  show: Required<PrintOptions['show']>;
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
const FLAGS = ['both', 'origins', 'all', 'none'] as const;
const SHOW_KEYS = ['dates', 'placeNames', 'countryNames', 'oceanNames', 'compass', 'scaleBar', 'legend', 'graticule', 'surnames'] as const;

/** The option ids the renderer knows (from the JSON files), to check a design against. */
export interface DesignOptionIds {
  styles: readonly string[];
  layouts: readonly string[];
  borders: readonly string[];
  finishes: readonly string[];
}
const MAX_PLACES = 5000;

export class DesignError extends Error {}

function maxRoutes(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 30) throw new DesignError('design.maxRoutes must be a whole number between 1 and 30');
  return v as number;
}

function flagScale(v: unknown): number {
  if (v === undefined || v === null || v === '') return 1;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.5 || v > 2) throw new DesignError('design.flagScale must be a number between 0.5 and 2');
  return v;
}

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

/** Optional id: missing or "" = none (the style's own); anything else must be known. */
function optionalId(v: unknown, allowed: readonly string[], field: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (!allowed.includes(v as string)) throw new DesignError(`design.${field} must be one of ${allowed.join(', ')} (or empty)`);
  return v as string;
}

/** Checks and normalises a design sent by a browser against the options the server knows. */
export function parseDesign(v: unknown, ids: DesignOptionIds): DesignSpec {
  const styleIds = ids.styles;
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
    layoutId: pick(v.layoutId, ids.layouts, 'layoutId', ids.layouts[0]),
    borderId: optionalId(v.borderId, ids.borders, 'borderId'),
    finishId: optionalId(v.finishId, ids.finishes, 'finishId'),
    flagScale: flagScale(v.flagScale),
    routes: pick(v.routes, ['essential', 'detailed'] as const, 'routes', 'essential'),
    maxRoutes: maxRoutes(v.maxRoutes),
    show: {
      ...(Object.fromEntries(SHOW_KEYS.map((k) => [k, show[k] === undefined ? true : show[k] === true])) as Omit<Required<PrintOptions['show']>, 'flags'>),
      flags: pick(show.flags, FLAGS, 'show.flags', 'both'),
    },
    selection: {
      rootId: (sel.rootId as string | undefined) || undefined,
      branch: pick(sel.branch, BRANCHES, 'selection.branch', 'all'),
      generations,
    },
    places,
  };
}

/** The design in words, for the order page, the production sheet and operations. */
export function describeDesign(
  d: DesignSpec,
  names: { styles: { id: string; name: string }[]; layouts: { id: string; name: string }[]; borders: { id: string; name: string }[]; finishes: { id: string; name: string }[] },
) {
  const name = (list: { id: string; name: string }[], id: string | undefined, fallback: string) => (id ? (list.find((x) => x.id === id)?.name ?? id) : fallback);
  const scale = d.flagScale ?? 1;
  const flags = { both: 'both ends of each move', origins: 'countries people left', all: 'every country with a birth', none: 'none' }[d.show.flags];
  return {
    style: name(names.styles, d.styleId, d.styleId),
    // Orders placed before layouts existed have none: they were geographic.
    layout: name(names.layouts, d.layoutId ?? names.layouts[0]?.id, 'Geographic'),
    border: name(names.borders, d.borderId, 'style’s own frame'),
    finish: name(names.finishes, d.finishId, 'style’s own paper'),
    flags: d.show.flags === 'none' ? 'no flags' : `${flags}, ${scale === 1 ? 'medium' : scale < 1 ? 'small' : scale < 1.45 ? 'large' : 'extra large'}`,
    surnames: d.show.surnames !== false,
    routes:
      (d.routes ?? 'detailed') === 'essential'
        ? `essential (a few main routes${d.maxRoutes ? `, at most ${d.maxRoutes}` : ''})`
        : 'detailed (every move)',
  };
}
