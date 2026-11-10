// Shared types for the heritage map print. Everything here is plain data, so the renderer can run
// in the browser (preview) and on a server (final output) alike.

import type { Topology } from 'topojson-specification';
import type { Flow } from '../flows';
import type { BorderSpec, FinishSpec } from './borders';
import type { LayoutSpec } from './layouts';
import type { PrintStyle } from './style';

export type Pt = [number, number];

/** A person who appears on the print: someone with a known place of birth (or baptism). */
export interface PrintPerson {
  id: string;
  name: string;
  surname: string;
  sex?: 'M' | 'F' | 'U';
  birthYear?: number;
  /** Generation, 0 = most recent (see generations.ts). */
  gen: number;
  lat: number;
  lon: number;
  /** Place name as written in the file, e.g. "Braga, Portugal". */
  place: string;
}

/** What gets drawn: the people on the map and the moves between their birthplaces. */
export interface PrintData {
  people: PrintPerson[];
  /** Moves from `computeFlows` (src/flows.ts), already filtered to the chosen branches and generations. */
  flows: Flow[];
  /** The person the print is centred on and their ancestors; their moves rank higher in essential routes. */
  directLine?: string[];
}

export type PaperSize = 'A3' | 'A2' | 'A1';
export type Orientation = 'landscape' | 'portrait';
export type AreaId = 'family' | 'world' | 'atlantic' | 'europe' | 'iberia' | 'south-america' | 'north-america' | 'africa';
export type Lang = 'pt' | 'en';

export interface PrintOptions {
  style: PrintStyle;
  paper: PaperSize;
  orientation: Orientation;
  area: AreaId;
  lang: Lang;
  title: string;
  /** Usually the span of years, e.g. "1790 – 1998". */
  subtitle: string;
  dedication: string;
  show: {
    /** Year labels along the routes. */
    dates: boolean;
    /** Names of the towns where people were born. */
    placeNames: boolean;
    /**
     * Flag roundels: at each country people moved away from, at both ends of the moves, every
     * country with a birth, or none.
     */
    flags: 'origins' | 'both' | 'all' | 'none';
    /** The family's surname lettered along each route (on unless set to false). */
    surnames?: boolean;
    countryNames: boolean;
    oceanNames: boolean;
    compass: boolean;
    scaleBar: boolean;
    legend: boolean;
    graticule: boolean;
  };
  /** How the map is laid out (layouts/*.json); the geographic layout if not given. */
  layout?: LayoutSpec;
  /** Decorative border (borders/*.json); the style's own frame if not given. */
  border?: BorderSpec;
  /** Finish on the paper (finishes/*.json); just the style's own ageing if not given. */
  finish?: FinishSpec;
  /** Size of the flag roundels relative to the style's (1 = as designed). */
  flagScale?: number;
  /**
   * Essential (the default): a few main routes between countries (or medallions), each merging
   * everyone who made that move. Detailed: every move, generation by generation.
   */
  routes?: 'essential' | 'detailed';
  /** Most routes in essential mode (by default 5 on A3, 7 on A2, 8 on A1). */
  maxRoutes?: number;
  /** Size of the root <svg> element in pixels (for rasterising); defaults to the paper size in mm. */
  pixelSize?: { width: number; height: number };
}

/** Measures text width in millimetres. The browser passes one backed by canvas and the real fonts. */
export type MeasureText = (text: string, font: FontRef, sizeMm: number, letterSpacingMm?: number) => number;

export interface FontRef {
  family: string;
  weight?: number;
  style?: 'normal' | 'italic';
  /** Average advance of a character as a share of the font size, for estimating widths without the font. */
  widthFactor?: number;
}

/** Data the renderer needs but doesn't load itself, so the same code runs in the browser and on a server. */
export interface PrintAssets {
  /** world-atlas countries topology (Natural Earth admin-0, 50m or 10m), with `countries` and `land` objects. */
  topology: Topology;
  /** Raw SVG of square (1x1) flags, keyed by lower-case ISO 3166-1 alpha-2 code. */
  flags: Record<string, string>;
  /** @font-face rules with the fonts embedded (data: URLs); empty for an on-screen preview with fonts already loaded. */
  fontCss: string;
  measure?: MeasureText;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
