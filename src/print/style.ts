// Print styles are plain data (JSON files in ./styles), so adding a look is a new file, not new code.
// Every size is in millimetres on an A2 sheet; other sizes scale everything by the paper size
// (see paper.ts), so an A1 print looks like an enlarged A2.

import type { FontRef } from './types';

export const FRAME_KINDS = ['antique', 'nautical', 'simple'] as const;
export const COMPASS_KINDS = ['ornate', 'nautical', 'simple'] as const;
export const ARROW_KINDS = ['barb', 'triangle', 'none'] as const;
export const MARK_KINDS = ['town', 'dot', 'ring'] as const;
export const CARTOUCHE_KINDS = ['scroll', 'framed', 'plain'] as const;
export const SCALEBAR_KINDS = ['checkered', 'simple'] as const;
export const PROJECTION_PREFS = ['auto', 'mercator'] as const;
export const TEXTURE_KINDS = ['wood', 'leather'] as const;

export interface PrintStyle {
  id: string;
  name: string;
  description?: string;
  fonts: {
    /** Family name in the cartouche. */
    title: FontRef;
    /** Headings: legend title, country names, compass letters. */
    heading: FontRef;
    /** Body text: dedication, legend rows, place names. */
    body: FontRef;
    /** Italic: oceans, dates along routes, scale bar. */
    italic: FontRef;
  };
  /** Write the title and headings in capitals. */
  uppercaseTitles: boolean;
  paper: {
    color: string;
    /** Fine grain of the paper (0 = none, 1 = strong). */
    grain: number;
    /** Size of the grain: noise frequency per millimetre. */
    grainFrequency: number;
    /** Large faded stains (0 = none). */
    stains: number;
    /** Darkening towards the edges (0 = none). */
    vignette: number;
    /** Colour of the grain, stains and vignette. */
    ageColor: string;
    /**
     * A material instead of plain paper, laid over the whole sheet like the grain: `wood` (long
     * grain lines and growth rings, for a pyrography look) or `leather` (a pebbled, embossed hide).
     */
    texture?: { kind: (typeof TEXTURE_KINDS)[number]; strength: number; color: string };
  };
  ink: {
    main: string;
    faint: string;
    accent: string;
    /** Wobble of the lines, as if drawn by hand, in mm (0 = perfectly smooth). */
    wobble: number;
  };
  map: {
    sea: string;
    land: string;
    coast: { color: string; width: number };
    /** Engraved lines that follow the coast out to sea. */
    waterLines: { count: number; spacing: number; width: number; color: string; opacity: number };
    /** Shading along the inside of the coast. */
    landShade: { color: string; width: number; opacity: number };
    borders: { color: string; width: number; dash: number[] };
    graticule: { step: number; color: string; width: number; dash: number[] };
    /** Lines radiating from the compass rose across the sea, as on portolan charts (0 = none). */
    rhumbLines: {
      count: number;
      colors: string[];
      width: number;
      opacity: number;
      /**
       * Roses on a hidden circle around the middle of the map, each sending out the same lines, as on
       * medieval portolan charts (16 is the classic number; 0 or absent = only the compass's lines).
       */
      network?: number;
    };
    projection: (typeof PROJECTION_PREFS)[number];
  };
  routes: {
    /** One ink per generation, oldest first; generations in between are blended. */
    inks: string[];
    minWidth: number;
    maxWidth: number;
    /** Start each route thinner, like a pen stroke. */
    taper: boolean;
    arrow: (typeof ARROW_KINDS)[number];
    arrowSize: number;
    opacity: number;
    /** A light line under each route so it stands off the map (empty = none). */
    halo: string;
    haloWidth: number;
    dateSize: number;
    /** Size of the surname lettered along routes (defaults to 1.6 × dateSize). */
    surnameSize?: number;
  };
  marks: { kind: (typeof MARK_KINDS)[number]; size: number; fill: string; stroke: string };
  labels: {
    placeSize: number;
    placeColor: string;
    countrySize: number;
    countryColor: string;
    countryLetterSpacing: number;
    oceanSize: number;
    oceanColor: string;
    oceanLetterSpacing: number;
    /** Light outline behind text so it reads over lines (empty = none). */
    halo: string;
  };
  flags: {
    radius: number;
    ring: string;
    ringWidth: number;
    /** Second, outer ring (empty = none). */
    outerRing: string;
    /** How much to age the flag colours towards sepia (0..1). */
    tone: number;
    labelSize: number;
    leader: string;
  };
  cartouche: {
    kind: (typeof CARTOUCHE_KINDS)[number];
    fill: string;
    stroke: string;
    titleSize: number;
    subtitleSize: number;
    dedicationSize: number;
    /** Width as a share of the map frame width. */
    maxWidthShare: number;
  };
  legend: { fill: string; stroke: string; titleSize: number; rowSize: number };
  frame: {
    kind: (typeof FRAME_KINDS)[number];
    color: string;
    /** Distance from the paper edge to the outer line. */
    margin: number;
    /** Width of the band between the outer and inner lines (degree marks go here). */
    band: number;
    outerWidth: number;
    innerWidth: number;
    degreeLabels: boolean;
  };
  compass: { kind: (typeof COMPASS_KINDS)[number]; size: number; fill: string; dark: string; accent: string };
  scaleBar: { kind: (typeof SCALEBAR_KINDS)[number]; length: number };
}

/**
 * Smallest sizes on an A2 sheet, in mm, whatever a style says, so nothing on the print is too
 * small to read or see at arm's length. Smaller sheets scale these by the square root of their
 * size (not linearly), so an A3 keeps relatively larger text than an exact reduction of an A2.
 */
export const MIN_SIZES = {
  title: 15,
  subtitle: 6,
  dedication: 4.6,
  legendTitle: 5.6,
  legendRow: 4.4,
  place: 4.2,
  country: 6,
  ocean: 7,
  date: 3.8,
  surname: 5,
  flagLabel: 3.8,
  degree: 2.8,
  scale: 3.6,
  route: 1.2,
  arrow: 6,
  mark: 2.6,
  flag: 8,
} as const;

/** A style size (mm on A2) for a sheet `k` times A2's size, never below the minimum for its role. */
export const sized = (role: keyof typeof MIN_SIZES, value: number, k: number) => Math.max(value * k, MIN_SIZES[role] * Math.sqrt(k));

const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\([\d.,\s%]+\)|none|transparent|[a-z]+)$/i;

/**
 * Checks a style loaded from JSON. Returns a list of problems (empty if it's fine), so a broken
 * style file is reported clearly instead of producing a broken print.
 */
export function validateStyle(s: unknown): string[] {
  const errors: string[] = [];
  const get = (path: string): unknown =>
    path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), s);
  const str = (path: string) => {
    if (typeof get(path) !== 'string' || !(get(path) as string).length) errors.push(`${path} must be a non-empty string`);
  };
  const color = (path: string, allowEmpty = false) => {
    const v = get(path);
    if (allowEmpty && v === '') return;
    if (typeof v !== 'string' || !COLOR_RE.test(v.trim())) errors.push(`${path} must be a colour (got ${JSON.stringify(v)})`);
  };
  const num = (path: string, min = 0, max = Infinity) => {
    const v = get(path);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      errors.push(`${path} must be a number between ${min} and ${max} (got ${JSON.stringify(v)})`);
  };
  const bool = (path: string) => {
    if (typeof get(path) !== 'boolean') errors.push(`${path} must be true or false`);
  };
  const oneOf = (path: string, allowed: readonly string[]) => {
    if (!allowed.includes(get(path) as string)) errors.push(`${path} must be one of ${allowed.join(', ')}`);
  };
  const nums = (path: string) => {
    const v = get(path);
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'number' || x < 0)) errors.push(`${path} must be a list of numbers`);
  };
  const colors = (path: string, minLen: number) => {
    const v = get(path);
    if (!Array.isArray(v) || v.length < minLen) errors.push(`${path} must list at least ${minLen} colour(s)`);
    else v.forEach((_, i) => color(`${path}.${i}`));
  };

  if (!s || typeof s !== 'object') return ['style must be an object'];
  str('id');
  str('name');
  for (const f of ['title', 'heading', 'body', 'italic']) {
    str(`fonts.${f}.family`);
    if (get(`fonts.${f}.weight`) !== undefined) num(`fonts.${f}.weight`, 100, 900);
    if (get(`fonts.${f}.style`) !== undefined) oneOf(`fonts.${f}.style`, ['normal', 'italic']);
    if (get(`fonts.${f}.widthFactor`) !== undefined) num(`fonts.${f}.widthFactor`, 0.2, 1.2);
  }
  bool('uppercaseTitles');
  color('paper.color');
  num('paper.grain', 0, 1);
  num('paper.grainFrequency', 0.01, 10);
  num('paper.stains', 0, 1);
  num('paper.vignette', 0, 1);
  color('paper.ageColor');
  if (get('paper.texture') !== undefined) {
    oneOf('paper.texture.kind', TEXTURE_KINDS);
    num('paper.texture.strength', 0, 1);
    color('paper.texture.color');
  }
  color('ink.main');
  color('ink.faint');
  color('ink.accent');
  num('ink.wobble', 0, 2);
  color('map.sea');
  color('map.land');
  color('map.coast.color');
  num('map.coast.width', 0, 5);
  num('map.waterLines.count', 0, 12);
  num('map.waterLines.spacing', 0, 10);
  num('map.waterLines.width', 0, 5);
  color('map.waterLines.color');
  num('map.waterLines.opacity', 0, 1);
  color('map.landShade.color');
  num('map.landShade.width', 0, 20);
  num('map.landShade.opacity', 0, 1);
  color('map.borders.color');
  num('map.borders.width', 0, 5);
  nums('map.borders.dash');
  num('map.graticule.step', 1, 90);
  color('map.graticule.color');
  num('map.graticule.width', 0, 5);
  nums('map.graticule.dash');
  num('map.rhumbLines.count', 0, 64);
  if ((get('map.rhumbLines.count') as number) > 0) colors('map.rhumbLines.colors', 1);
  num('map.rhumbLines.width', 0, 5);
  num('map.rhumbLines.opacity', 0, 1);
  if (get('map.rhumbLines.network') !== undefined) num('map.rhumbLines.network', 0, 32);
  oneOf('map.projection', PROJECTION_PREFS);
  colors('routes.inks', 1);
  num('routes.minWidth', 0.05, 20);
  num('routes.maxWidth', 0.05, 30);
  if ((get('routes.maxWidth') as number) < (get('routes.minWidth') as number)) errors.push('routes.maxWidth must be at least routes.minWidth');
  bool('routes.taper');
  oneOf('routes.arrow', ARROW_KINDS);
  num('routes.arrowSize', 0, 30);
  num('routes.opacity', 0, 1);
  color('routes.halo', true);
  num('routes.haloWidth', 0, 10);
  num('routes.dateSize', 0.5, 20);
  if (get('routes.surnameSize') !== undefined) num('routes.surnameSize', 0.5, 30);
  oneOf('marks.kind', MARK_KINDS);
  num('marks.size', 0.1, 20);
  color('marks.fill');
  color('marks.stroke');
  num('labels.placeSize', 0.5, 30);
  color('labels.placeColor');
  num('labels.countrySize', 0.5, 40);
  color('labels.countryColor');
  num('labels.countryLetterSpacing', 0, 20);
  num('labels.oceanSize', 0.5, 60);
  color('labels.oceanColor');
  num('labels.oceanLetterSpacing', 0, 30);
  color('labels.halo', true);
  num('flags.radius', 1, 50);
  color('flags.ring');
  num('flags.ringWidth', 0, 10);
  color('flags.outerRing', true);
  num('flags.tone', 0, 1);
  num('flags.labelSize', 0.5, 20);
  color('flags.leader');
  oneOf('cartouche.kind', CARTOUCHE_KINDS);
  color('cartouche.fill');
  color('cartouche.stroke');
  num('cartouche.titleSize', 1, 80);
  num('cartouche.subtitleSize', 1, 40);
  num('cartouche.dedicationSize', 1, 30);
  num('cartouche.maxWidthShare', 0.1, 0.9);
  color('legend.fill');
  color('legend.stroke');
  num('legend.titleSize', 1, 40);
  num('legend.rowSize', 1, 30);
  oneOf('frame.kind', FRAME_KINDS);
  color('frame.color');
  num('frame.margin', 0, 60);
  num('frame.band', 0, 40);
  num('frame.outerWidth', 0, 10);
  num('frame.innerWidth', 0, 10);
  bool('frame.degreeLabels');
  oneOf('compass.kind', COMPASS_KINDS);
  num('compass.size', 5, 200);
  color('compass.fill');
  color('compass.dark');
  color('compass.accent');
  oneOf('scaleBar.kind', SCALEBAR_KINDS);
  num('scaleBar.length', 10, 300);
  return errors;
}

/** Every distinct font a style uses. */
export function styleFonts(style: PrintStyle): FontRef[] {
  const seen = new Map<string, FontRef>();
  for (const f of Object.values(style.fonts)) seen.set(fontKey(f), f);
  return [...seen.values()];
}

export const fontKey = (f: FontRef) => `${f.family}|${f.weight ?? 400}|${f.style ?? 'normal'}`;

const slug = (family: string) => family.toLowerCase().replace(/\s+/g, '-');

/** Path of the font file inside node_modules (@fontsource packages, Latin subset, WOFF2). */
export function fontPackagePath(f: FontRef): string {
  const s = slug(f.family);
  return `@fontsource/${s}/files/${s}-latin-${f.weight ?? 400}-${f.style ?? 'normal'}.woff2`;
}

/** @font-face rules for the given fonts, with each file given as a URL (usually a data: URL). */
export function fontFaceCss(faces: { font: FontRef; url: string }[]): string {
  return faces
    .map(
      ({ font, url }) =>
        `@font-face{font-family:'${font.family}';font-style:${font.style ?? 'normal'};font-weight:${font.weight ?? 400};src:url(${url}) format('woff2');}`,
    )
    .join('\n');
}
