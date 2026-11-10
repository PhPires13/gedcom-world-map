// The heritage map print: a pure function from the family's places and moves to an SVG document.
// No DOM, no network: everything it needs comes in through its arguments, so the same code makes
// the on-screen preview and (later) the final file on a server.

import { geoGraticule, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { CountryLocator, countryName, topoFeatures } from './countries';
import { applyFinish, drawBorder } from './borders';
import { pathLength, placeAlongCurve, routeSurnames, smoothPath } from './curvelabel';
import { frameTicks, inset, kmPerMm, makeProjection, niceScaleKm, pageSize, showsWholeSphere, sizeScale, topologyDetail } from './geo';
import { buildStorybook, medallionBanner, planVignette, type ArtMap, type LayoutSpec, type Medallion, type VignettePlan } from './layouts';
import {
  contains,
  estimateText,
  layoutCartouche,
  layoutLegend,
  overlaps,
  placeLabel,
  placePanel,
  placeRoundel,
  type LegendRow,
  type Obstacles,
  type TextLine,
  wrapText,
} from './layout';
import { compassBox, compassRose, mapFrame, panelFrame, panelOrnamentPad, rhumbLines, rule, scaleBar, scaleBarHeight } from './ornaments';
import { projectRoutes, ribbon, type RouteStroke } from './routes';
import { sized, type PrintStyle } from './style';
import { el, esc, flagSymbol, fontAttrs, linePath, n, polygonPath, roman } from './svg';
import { STRINGS, WATERS } from './text';
import type { Box, FontRef, MeasureText, PrintAssets, PrintData, PrintOptions, PrintPerson, Pt } from './types';

export interface RenderResult {
  svg: string;
  /** Sheet size in mm. */
  width: number;
  height: number;
  layout: {
    /** The map area inside the frame. */
    map: Box;
    cartouche?: Box & { lines: TextLine[] };
    legend?: Box;
    compass?: Box;
    scaleBar?: Box;
    flags: { code: string; center: Pt; r: number; anchor: Pt }[];
    marks: Pt[];
    routes: RouteStroke[];
    labels: { text: string; box: Box }[];
    /** Surnames and years lettered along routes. */
    routeLabels: { text: string; boxes: Box[]; size: number }[];
    /** The medallions of a medallion layout (empty otherwise). */
    medallions: Medallion[];
    droppedLabels: string[];
  };
  warnings: string[];
}

// Country polygons and land/borders take a moment to build from the topology; keep them per topology.
const geoCache = new WeakMap<Topology, { locator: CountryLocator; land: GeoPermissibleObjects; borders: GeoPermissibleObjects }>();
function geoFor(topology: Topology) {
  let g = geoCache.get(topology);
  if (!g) {
    const countries = topology.objects.countries as GeometryCollection;
    g = {
      locator: new CountryLocator(topology),
      land: topoFeatures(topology, 'land') as GeoPermissibleObjects,
      borders: mesh(topology, countries, (a, b) => a !== b) as GeoPermissibleObjects,
    };
    geoCache.set(topology, g);
  }
  return g;
}

const hexToRgb = (h: string) => {
  const s = h.replace('#', '');
  const full = s.length === 3 ? [...s].map((c) => c + c).join('') : s.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const rgbToHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Ink for a generation: the style's inks run from the oldest generation to the youngest. */
export function generationInk(style: PrintStyle, gen: number, minGen: number, maxGen: number): string {
  const inks = style.routes.inks;
  if (inks.length === 1 || maxGen <= minGen) return inks[inks.length - 1];
  const t = ((maxGen - gen) / (maxGen - minGen)) * (inks.length - 1);
  const i = Math.min(Math.floor(t), inks.length - 2);
  const f = t - i;
  if (!inks[i].startsWith('#') || !inks[i + 1].startsWith('#')) return inks[Math.round(t)];
  const a = hexToRgb(inks[i]);
  const b = hexToRgb(inks[i + 1]);
  return rgbToHex(a.map((v, j) => v + (b[j] - v) * f));
}

/** First part of a place name: "Braga, Portugal" → "Braga". */
const townOf = (place: string) => place.split(',')[0].trim();

const yearSpan = (years: number[]) => {
  if (!years.length) return '';
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
};

/** Defaults for the cartouche from the people on the map. */
export function defaultTexts(data: PrintData, lang: 'pt' | 'en', rootId?: string): { title: string; subtitle: string } {
  const people = data.people;
  const root = people.find((p) => p.id === rootId) ?? [...people].sort((a, b) => a.gen - b.gen)[0];
  // Luso-Brazilian names put the father's surname last ("Almeida Costa" → Costa).
  const surname = root?.surname.split(/\s+/).filter(Boolean).pop() ?? '';
  const years = people.map((p) => p.birthYear).filter((y): y is number => y !== undefined);
  return { title: surname ? STRINGS[lang].family(surname) : '', subtitle: yearSpan(years) };
}

/** The layout used when options don't name one: true geography, the chosen area. */
export const GEOGRAPHIC: LayoutSpec = { id: 'accurate', name: 'Geographic', kind: 'accurate', padding: 0.11 };

/**
 * Which Natural Earth detail the renderer needs for these options: 1:10m for zoomed-in maps
 * (and medallions, which enlarge each homeland), 1:50m otherwise.
 */
export function topologyDetailFor(data: PrintData, o: PrintOptions): '50m' | '10m' {
  const L = o.layout ?? GEOGRAPHIC;
  if (L.kind === 'vignette') return '10m';
  // Storybook countries are enlarged from a continent-wide view: 1:50m is plenty, 1:10m only bloats the file.
  if (L.kind === 'storybook') return '50m';
  const { w, h } = pageSize(o.paper, o.orientation);
  const k = sizeScale(o.paper);
  const frame = inset({ x: 0, y: 0, w, h }, ((o.border?.margin ?? o.style.frame.margin) + (o.border?.band ?? o.style.frame.band)) * k);
  const projection = makeProjection(L.fitFamily ? 'family' : o.area, data.people, frame, o.style.map.projection, L.padding);
  return topologyDetail(kmPerMm(projection, [w / 2, h / 2]));
}

export function renderHeritageMap(data: PrintData, o: PrintOptions, assets: PrintAssets): RenderResult {
  const S = o.style;
  const L = o.layout ?? GEOGRAPHIC;
  const B = o.border;
  const { w: W, h: H } = pageSize(o.paper, o.orientation);
  const k = sizeScale(o.paper);
  const measure = assets.measure ?? estimateText;
  const T = STRINGS[o.lang];
  const warnings: string[] = [];
  const { locator, land, borders } = geoFor(assets.topology);
  const upper = (s: string) => (S.uppercaseTitles ? s.toLocaleUpperCase(o.lang) : s);

  // ---------- Frame ----------
  const margin = (B ? B.margin : S.frame.margin) * k;
  const band = (B ? B.band : S.frame.band) * k;
  // A gallery caption sits under the map, in extra paper at the bottom.
  const caption = B?.caption ? captionLayout(o, S, k, W, measure) : null;
  const outer: Box = { x: margin, y: margin, w: W - 2 * margin, h: H - 2 * margin - (caption?.h ?? 0) };
  const frame = inset(outer, band);
  const inFrame = (p: Pt, pad = 0) => p[0] >= frame.x + pad && p[0] <= frame.x + frame.w - pad && p[1] >= frame.y + pad && p[1] <= frame.y + frame.h - pad;

  // ---------- The map: a true projection, or an artistic layout ----------
  const geographic = L.kind === 'accurate';
  const pref = geographic ? S.map.projection : 'auto';
  const projection = makeProjection(geographic && !L.fitFamily ? o.area : 'family', data.people, frame, pref, L.padding ?? 0.11);
  const path = geoPath(projection).digits(2);
  const sphere = geographic && !L.fitFamily && showsWholeSphere(o.area, pref);
  const project = (p: { lat: number; lon: number }): Pt | null => {
    const q = projection([p.lon, p.lat]);
    return q && Number.isFinite(q[0]) && Number.isFinite(q[1]) ? [q[0], q[1]] : null;
  };
  const drawCtx = { style: S, k, lang: o.lang, frame };
  let art: ArtMap | null = null;
  let plan: VignettePlan | null = null;
  if (L.kind === 'storybook') art = buildStorybook(data.people, locator, { ...L.storybook!, padding: L.padding ?? 0.05 }, drawCtx);
  if (L.kind === 'vignette') plan = planVignette(data.people, locator, { ...L.vignette!, padding: L.padding ?? 0.04 }, drawCtx);
  const place = (p: { lat: number; lon: number; place?: string }): Pt | null => (art ? art.place(p) : project(p));

  // ---------- Generations and inks ----------
  const gens = data.people.map((p) => p.gen);
  const minGen = Math.min(0, ...gens);
  const maxGen = Math.max(0, ...gens);
  const ink = (g: number) => generationInk(S, g, minGen, maxGen);
  const yearOf = new Map(data.people.map((p) => [p.id, p.birthYear]));
  const surnameOf = new Map(data.people.map((p) => [p.id, p.surname]));

  // ---------- Sizes, never below the minimums for the paper ----------
  const markR = sized('mark', S.marks.size, k) / 2;
  const minW = sized('route', S.routes.minWidth, k);
  const maxW = Math.max(minW * 2.2, S.routes.maxWidth * k);
  const arrowSize = S.routes.arrow === 'none' ? 0 : sized('arrow', S.routes.arrowSize, k);
  const placeSize = sized('place', S.labels.placeSize, k);
  const dateSize = sized('date', S.routes.dateSize, k);
  const surnameSize = sized('surname', S.routes.surnameSize ?? S.routes.dateSize * 1.6, k);
  const flagR = sized('flag', S.flags.radius, k) * (o.flagScale ?? 1);
  const flagLabel = sized('flagLabel', S.flags.labelSize, k);
  const ringOut = S.flags.outerRing ? Math.max(S.flags.ringWidth * k * 2.2, flagR * 0.1) : 0;

  // Countries for the flags, with the family's places in each (to place the roundel near them).
  const flagMode = o.show.flags;
  const flagSources: { code: string; p: { lat: number; lon: number; place?: string }; count: number }[] = [];
  if (flagMode === 'origins' || flagMode === 'both') for (const f of data.flows) flagSources.push({ code: locator.locate(f.from), p: f.from, count: f.parents.length });
  if (flagMode === 'both') for (const f of data.flows) flagSources.push({ code: locator.locate(f.to), p: f.to, count: f.children.length });
  if (flagMode === 'all') for (const p of data.people) flagSources.push({ code: locator.locate(p), p, count: 1 });
  const flagCodes = [...new Set(flagSources.map((f) => f.code).filter(Boolean))].filter((c) => {
    if (assets.flags[c]) return true;
    warnings.push(`No flag available for country code "${c}".`);
    return false;
  });

  // ---------- Panels: cartouche, legend, compass, scale bar ----------
  const panelGap = 5 * k;
  const placed: Box[] = [];
  const moverGensOf = (gs: number[]) => [...new Set(gs)].sort((a, b) => b - a);
  type Panels = { cartouche?: Box & { lines: TextLine[] }; legend?: Box; compass?: Box; scale?: Box; svg: string; rhumb: string };
  const placePanels = (obs: Obstacles, moverGens: number[]): Panels => {
    const out: Panels = { svg: '', rhumb: '' };
    if (!caption && (o.title.trim() || o.subtitle.trim() || o.dedication.trim())) {
      const lay = layoutCartouche(
        { title: upper(o.title), subtitle: o.subtitle, dedication: o.dedication },
        { title: S.fonts.title, subtitle: S.fonts.heading, dedication: S.fonts.italic },
        { title: sized('title', S.cartouche.titleSize, k), subtitle: sized('subtitle', S.cartouche.subtitleSize, k), dedication: sized('dedication', S.cartouche.dedicationSize, k) },
        frame.w * S.cartouche.maxWidthShare,
        measure,
        panelOrnamentPad(S, k),
      );
      const curls = S.cartouche.kind === 'scroll' ? Math.min(4.5 * k, lay.h * 0.18) : 0;
      const { box } = placePanel(frame, lay.w + 2 * curls, lay.h, obs, placed, panelGap);
      const b: Box = { x: box.x + curls, y: box.y, w: lay.w, h: lay.h };
      placed.push(box);
      out.cartouche = { ...b, lines: lay.lines };
      const cx = b.x + b.w / 2;
      let body = panelFrame(S, b, k, true);
      lay.lines.forEach((line, i) => {
        const prev = lay.lines[i - 1];
        // A rule under the title, and a shorter one before the dedication.
        if (prev && prev.role === 'title' && line.role !== 'title') body += rule(S, cx, b.y + prev.y + prev.size * 0.36, Math.min(b.w * 0.5, 40 * k), k);
        else if (prev && prev.role === 'subtitle' && line.role === 'dedication') body += rule(S, cx, b.y + line.y - line.size * 1.35, Math.min(b.w * 0.25, 20 * k), k);
        const color = line.role === 'subtitle' ? S.ink.accent : S.cartouche.stroke;
        body += el('text', { x: cx, y: b.y + line.y, 'text-anchor': 'middle', fill: color, ...fontAttrs(line.font, line.size) }, esc(line.text));
      });
      out.svg += `<g class="cartouche">${body}</g>`;
    }

    if (o.show.legend) {
      const rows: LegendRow[] = moverGens.map((g, i) => {
        const years = yearSpan(data.people.filter((p) => p.gen === g).map((p) => p.birthYear).filter((y): y is number => y !== undefined));
        return { label: years ? T.generationOf(years) : T.generation(roman(i + 1)), kind: 'route', color: ink(g) };
      });
      rows.push({ label: T.birthplace, kind: 'mark' });
      if (flagCodes.length || plan) rows.push({ label: T.origin, kind: 'flag' });
      const lay = layoutLegend(upper(T.legend), rows, { title: S.fonts.heading, row: S.fonts.body }, { title: sized('legendTitle', S.legend.titleSize, k), row: sized('legendRow', S.legend.rowSize, k) }, frame.w * 0.3, measure);
      const { box } = placePanel(frame, lay.w, lay.h, obs, placed, panelGap);
      placed.push(box);
      out.legend = box;
      let body = panelFrame(S, box, k, false);
      body += el('text', { x: box.x + box.w / 2, y: box.y + lay.title.y, 'text-anchor': 'middle', fill: S.legend.stroke, ...fontAttrs(lay.title.font, lay.title.size) }, esc(lay.title.text));
      for (const r of lay.rows) {
        const sx = box.x + lay.pad;
        const sy = box.y + r.y - r.size * 0.3;
        if (r.row.kind === 'route') {
          const pts: Pt[] = Array.from({ length: 9 }, (_, i) => [sx + (i / 8) * lay.swatchW * 0.82, sy + Math.sin((i / 8) * Math.PI) * -r.size * 0.3]);
          const w = Math.min(minW * 1.3, r.size * 0.45);
          body += routeSvg({ gen: 0, kind: 'out', pts, width: w, fromOrigin: S.routes.taper, arrow: arrowSize ? arrowHeadAt(pts, Math.min(arrowSize, r.size * 1.1)) : undefined }, r.row.color!, S, k, false);
        } else if (r.row.kind === 'mark') {
          body += markSvg(S, [sx + lay.swatchW / 2, sy], Math.min(markR, r.size * 0.4));
        } else {
          // A little generic flag in a roundel: two colour fields and a ring.
          const rr = r.size * 0.62;
          const cx = sx + lay.swatchW / 2;
          body += el('path', { d: `M${n(cx)},${n(sy - rr)}A${n(rr)},${n(rr)} 0 0 0 ${n(cx)},${n(sy + rr)}Z`, fill: S.ink.accent });
          body += el('path', { d: `M${n(cx)},${n(sy - rr)}A${n(rr)},${n(rr)} 0 0 1 ${n(cx)},${n(sy + rr)}Z`, fill: S.ink.faint });
          body += el('circle', { cx, cy: sy, r: rr, fill: 'none', stroke: S.flags.outerRing || S.ink.main, 'stroke-width': Math.max(S.flags.ringWidth, 0.3) * k });
        }
        body += el('text', { x: box.x + r.textX, y: box.y + r.y, fill: S.legend.stroke, ...fontAttrs(S.fonts.body, r.size) }, esc(r.row.label));
      }
      out.svg += `<g class="legend">${body}</g>`;
    }

    if (o.show.compass) {
      const size = S.compass.size * k;
      const side = compassBox(size);
      const { box } = placePanel(frame, side, side, obs, placed, panelGap, ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top', 'bottom']);
      placed.push(box);
      out.compass = box;
      const cx = box.x + side / 2;
      const cy = box.y + side / 2;
      out.svg = compassRose(S, cx, cy, size, o.lang, k) + out.svg;
      out.rhumb = rhumbLines(S, cx, cy, Math.hypot(W, H), k);
    }

    // A scale only means something on a true map.
    if (o.show.scaleBar && geographic) {
      const center: Pt = [frame.x + frame.w / 2, frame.y + frame.h / 2];
      const kpm = kmPerMm(projection, center);
      if (Number.isFinite(kpm) && kpm > 0) {
        const fs = sized('scale', 3, k);
        const km = niceScaleKm(kpm, S.scaleBar.length * k);
        const barMm = km / kpm;
        const cap = sphere ? T.scaleEquator : T.scale;
        const capW = measure(cap, S.fonts.italic, fs);
        const w = Math.max(barMm + fs * 2.6, capW) + 6 * k; // room for "km" after the bar
        const h = scaleBarHeight(k, fs) + 2 * k;
        const { box } = placePanel(frame, w, h, obs, placed, panelGap, ['bottom-right', 'bottom-left', 'bottom', 'top-right', 'top-left', 'top']);
        placed.push(box);
        out.scale = box;
        out.svg = scaleBar(S, box.x + (box.w - barMm - fs * 1.3) / 2, box.y + k, barMm, km, cap, k, fs) + out.svg;
      }
    }
    return out;
  };

  // Medallions are laid out around the panels; everything else places panels around the map.
  const circleBox = (c: { c: Pt; r: number }): Box => ({ x: c.c[0] - c.r, y: c.c[1] - c.r, w: 2 * c.r, h: 2 * c.r });
  let panels: Panels | null = null;
  if (plan) {
    const pl = plan;
    panels = placePanels({ points: [], boxes: pl.circles.map(circleBox) }, moverGensOf(data.flows.map((f) => f.gen)));
    art = pl.settle(placed.map((b) => inset(b, -2 * k)));
  }

  // ---------- Birthplace marks ----------
  const marks: { pt: Pt; people: PrintPerson[] }[] = [];
  const byPlace = new Map<string, PrintPerson[]>();
  for (const p of data.people) {
    const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    byPlace.set(key, [...(byPlace.get(key) ?? []), p]);
  }
  let off = 0;
  for (const group of [...byPlace.values()].sort((a, b) => b.length - a.length)) {
    const pt = place(group[0]);
    if (!pt || !inFrame(pt)) {
      off += group.length;
      continue;
    }
    // Places that would print on top of each other share a mark.
    const near = marks.find((m) => Math.hypot(m.pt[0] - pt[0], m.pt[1] - pt[1]) < markR * 1.6);
    if (near) near.people.push(...group);
    else marks.push({ pt, people: [...group] });
  }
  if (off) warnings.push(`${off} ${off === 1 ? 'person is' : 'people are'} born outside the chosen area and not shown.`);

  // ---------- Routes ----------
  const { strokes, mains } = projectRoutes(
    data.flows,
    (p) => {
      const q = place(p);
      return q && inFrame(q, -Math.max(frame.w, frame.h) * 0.25) ? q : null;
    },
    {
      radius: 5 * k,
      minWidth: minW,
      maxWidth: maxW,
      endGap: markR + 0.7 * k,
      arrowSize,
      wobble: S.ink.wobble * k,
      dateOffset: dateSize * 0.55 + 0.5 * k,
    },
    (id) => yearOf.get(id),
  );
  if (!panels) panels = placePanels({ points: [...marks.map((m) => m.pt), ...strokes.flatMap((s) => s.pts)], boxes: [] }, moverGensOf(strokes.map((s) => s.gen)));
  const map = art;

  // ---------- Flag roundels ----------
  const taken: Box[] = [...placed];
  const flags: RenderResult['layout']['flags'] = [];
  const markPts = marks.map((m) => m.pt);
  const routeLines = strokes.map((s) => s.pts);
  const medallions = map?.medallions ?? [];
  const R = flagR + ringOut;
  // Medallions are off limits to ocean names, but town names and route labels go inside them.
  const medallionBoxes = medallions.map((m): Box => ({ x: m.center[0] - m.r, y: m.center[1] - m.r, w: 2 * m.r, h: 2 * m.r }));
  for (const m of medallions) {
    // On a medallion the flag sits on its ring, upper right.
    if (flagMode !== 'none' && assets.flags[m.code]) {
      const a = -Math.PI / 4;
      const center: Pt = [m.center[0] + Math.cos(a) * m.r, m.center[1] + Math.sin(a) * m.r];
      flags.push({ code: m.code, center, r: flagR * 0.85, anchor: center });
    }
  }
  if (!medallions.length) {
    const anchors = new Map<string, { pts: Pt[]; people: number }>();
    for (const f of flagSources) {
      const pt = f.code && flagCodes.includes(f.code) ? place(f.p) : null;
      if (!pt || !inFrame(pt)) continue;
      const e = anchors.get(f.code) ?? { pts: [], people: 0 };
      e.pts.push(pt);
      e.people += f.count;
      anchors.set(f.code, e);
    }
    for (const [code, a] of [...anchors].sort((x, y) => y[1].people - x[1].people)) {
      const anchor: Pt = [a.pts.reduce((s, p) => s + p[0], 0) / a.pts.length, a.pts.reduce((s, p) => s + p[1], 0) / a.pts.length];
      const spot = placeRoundel(anchor, R, flagLabel * 1.8, inset(frame, 1.5 * k), markPts, routeLines, taken);
      if (!spot) continue;
      taken.push(spot.box);
      flags.push({ code, center: spot.center, r: flagR, anchor });
    }
  }
  for (const f of flags) if (medallions.length) taken.push({ x: f.center[0] - f.r, y: f.center[1] - f.r, w: 2 * f.r, h: 2 * f.r });

  // ---------- Labels ----------
  const labels: RenderResult['layout']['labels'] = [];
  const dropped: string[] = [];
  for (const m of marks) taken.push({ x: m.pt[0] - markR, y: m.pt[1] - markR, w: 2 * markR, h: 2 * markR });
  const blocked = (b: Box) => !contains(frame, b) || taken.some((t) => overlaps(t, b));

  // Medallion banners first: they name each homeland.
  let bannersSvg = '';
  const bannerSize = sized('country', S.labels.countrySize * 0.75, k);
  for (const m of medallions) {
    const text = m.name.toLocaleUpperCase(o.lang);
    const w = measure(text, S.fonts.heading, bannerSize);
    bannersSvg += medallionBanner(m, text, w, S, k, S.fonts.heading, bannerSize);
    const h = bannerSize * 1.7;
    taken.push({ x: m.center[0] - w / 2 - bannerSize * 1.6, y: m.center[1] + m.r - h * 0.35, w: w + bannerSize * 3.2, h });
  }

  // The family's surname (and the years) lettered along each route.
  const routeLabels: RenderResult['layout']['routeLabels'] = [];
  const routeDefs: string[] = [];
  let routeLabelsSvg = '';
  const showSurnames = o.show.surnames !== false;
  if (showSurnames || o.show.dates) {
    const spacing = surnameSize * 0.12;
    // Only routes long enough to carry their name, most travelled first, and not so many that
    // a busy map turns into a page of words.
    const maxLabels = 14;
    const longEnough = mains.filter((m) => pathLength(m.pts) >= 28 * k);
    for (const [i, m] of longEnough.sort((a, b) => b.width - a.width || b.movers.length - a.movers.length).entries()) {
      if (routeLabels.length >= maxLabels) break;
      const names = showSurnames ? routeSurnames(m.movers.map((id) => surnameOf.get(id) ?? '')) : [];
      const surname = upper(names.join(' & '));
      const years = o.show.dates ? m.years : '';
      // Try the full label, then fewer parts, then smaller text.
      const tries: { surname: string; years: string; size: number }[] = [];
      for (const size of [surnameSize, surnameSize * 0.82]) {
        if (surname && years) tries.push({ surname, years, size });
        if (surname && names.length > 1) tries.push({ surname: upper(names[0]), years, size });
        if (surname) tries.push({ surname: upper(names[0] ?? ''), years: '', size });
      }
      if (years) tries.push({ surname: '', years, size: dateSize });
      for (const t of tries) {
        if (!t.surname && !t.years) continue;
        const sw = t.surname ? measure(t.surname, S.fonts.title, t.size, spacing) : 0;
        const ys = t.surname ? dateSize : t.size;
        const yw = t.years ? measure(`${t.surname ? ' · ' : ''}${t.years}`, S.fonts.italic, ys) : 0;
        const spot = placeAlongCurve(m.pts, sw + yw, t.surname ? t.size : ys, m.width / 2, 0.9 * k, blocked);
        if (!spot) continue;
        taken.push(...spot.boxes);
        const id = `route-label-${i}`;
        routeDefs.push(el('path', { id, d: smoothPath(spot.baseline) }));
        let content = '';
        if (t.surname) content += `<tspan ${attrsOf({ ...fontAttrs(S.fonts.title, t.size), 'letter-spacing': spacing })}>${esc(t.surname)}</tspan>`;
        if (t.years) content += `<tspan ${attrsOf(fontAttrs(S.fonts.italic, ys))}>${esc(`${t.surname ? ' · ' : ''}${t.years}`)}</tspan>`;
        routeLabelsSvg += `<text fill="${ink(m.gen)}"${attrsOfHalo(S, k)}><textPath href="#${id}" startOffset="${n(spot.at * 100)}%" text-anchor="middle">${content}</textPath></text>`;
        routeLabels.push({ text: `${t.surname}${t.surname && t.years ? ' · ' : ''}${t.years}`, boxes: spot.boxes, size: t.surname ? t.size : ys });
        break;
      }
    }
  }

  let placeLabelsSvg = '';
  if (o.show.placeNames) {
    for (const m of [...marks].sort((a, b) => b.people.length - a.people.length)) {
      // The most common spelling of the town among the people born there.
      const counts = new Map<string, number>();
      for (const p of m.people) counts.set(townOf(p.place), (counts.get(townOf(p.place)) ?? 0) + 1);
      const text = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!text) continue;
      const w = measure(text, S.fonts.body, placeSize);
      const spot = placeLabel(m.pt, w, placeSize * 1.05, markR + 0.8 * k, frame, taken);
      if (!spot) {
        dropped.push(text);
        continue;
      }
      taken.push(spot.box);
      labels.push({ text, box: spot.box });
      placeLabelsSvg += el('text', { x: spot.baseline[0], y: spot.baseline[1], 'text-anchor': spot.anchor, fill: S.labels.placeColor, ...halo(S, k), ...fontAttrs(S.fonts.body, placeSize) }, esc(text));
    }
  }

  // Country names: where to write each, and how to tell the name is still over its country.
  const countrySpot = (code: string): { at: Pt; inside: (pt: Pt) => boolean } | null => {
    if (map) return map.countryLabel(code);
    const lp = locator.labelPoint(code);
    const at = lp && project({ lon: lp[0], lat: lp[1] });
    if (!at) return null;
    return {
      at,
      inside: (pt) => {
        const g = projection.invert?.(pt);
        return !!g && locator.codeAt(g[0], g[1]) === code;
      },
    };
  };
  let countriesSvg = '';
  const namedCountries = new Set<string>();
  if (o.show.countryNames && !medallions.length) {
    const codes = new Map<string, number>();
    for (const m of marks) {
      const c = locator.locate(m.people[0]);
      if (c) codes.set(c, (codes.get(c) ?? 0) + m.people.length);
    }
    const size = sized('country', S.labels.countrySize, k);
    const spacing = S.labels.countryLetterSpacing * k;
    for (const [code] of [...codes].sort((a, b) => b[1] - a[1])) {
      const cs = countrySpot(code);
      const text = countryName(code, o.lang).toLocaleUpperCase(o.lang);
      if (!cs || !text) continue;
      const w = measure(text, S.fonts.heading, size, spacing);
      const h = size * 1.05;
      // Near the middle of the country, and with the middle of the name still over the country.
      const spot = [0, -1.6, 1.6, -3.2, 3.2]
        .flatMap((dy) => [0, -0.3, 0.3].map((dx): Box => ({ x: cs.at[0] - w / 2 + dx * w, y: cs.at[1] + dy * size - h / 2, w, h })))
        .find((b) => !blocked(b) && cs.inside([b.x + b.w / 2, b.y + b.h / 2]));
      if (!spot) {
        dropped.push(text);
        continue;
      }
      taken.push(spot);
      labels.push({ text, box: spot });
      namedCountries.add(code);
      countriesSvg += el(
        'text',
        { x: spot.x + w / 2 + spacing / 2, y: spot.y + h * 0.8, 'text-anchor': 'middle', 'letter-spacing': spacing, fill: S.labels.countryColor, ...halo(S, k), ...fontAttrs(S.fonts.heading, size) },
        esc(text),
      );
    }
  }

  let oceansSvg = '';
  if (o.show.oceanNames) {
    const kpm = geographic ? kmPerMm(projection, [frame.x + frame.w / 2, frame.y + frame.h / 2]) : Infinity;
    const isLand = (q: Pt) => {
      if (map) return map.isLand(q);
      const g = projection.invert?.(q);
      return !g || !!locator.codeAt(g[0], g[1]);
    };
    for (const water of WATERS) {
      // Small seas only when a true map is zoomed in enough for them to matter.
      if (!water.major && !(kpm < 12)) continue;
      const size = sized('ocean', S.labels.oceanSize, k) * (water.major ? 1 : 0.6);
      const spacing = S.labels.oceanLetterSpacing * k * (water.major ? 1 : 0.6);
      const text = water.name[o.lang].toLocaleUpperCase(o.lang);
      const w = measure(text, S.fonts.italic, size, spacing);
      const h = size * 1.05;
      for (const [lon, lat] of water.at) {
        const pt = map ? map.water(lon, lat) : project({ lon, lat });
        if (!pt) continue;
        const box: Box = { x: pt[0] - w / 2, y: pt[1] - h / 2, w, h };
        // The whole name has to be over the sea, not just its middle.
        if (Array.from({ length: 11 }, (_, i) => [box.x + (i / 10) * box.w, pt[1]] as Pt).some(isLand)) continue;
        if (!contains(inset(frame, 2 * k), box) || [...taken, ...medallionBoxes].some((t) => overlaps(t, box, k))) continue;
        if (strokes.some((s) => s.pts.some((p) => p[0] > box.x && p[0] < box.x + box.w && p[1] > box.y && p[1] < box.y + box.h))) continue;
        taken.push(box);
        labels.push({ text, box });
        oceansSvg += el(
          'text',
          { x: pt[0] + spacing / 2, y: pt[1] + size * 0.35, 'text-anchor': 'middle', 'letter-spacing': spacing, fill: S.labels.oceanColor, ...fontAttrs(S.fonts.italic, size) },
          esc(text),
        );
        break;
      }
    }
  }

  // ---------- Assemble ----------
  const finish = o.finish;
  const ageing = !finish?.clean;
  const sphereD = sphere ? (path({ type: 'Sphere' }) ?? '') : '';
  const clipId = sphere ? 'clip-sphere' : 'clip-frame';
  const defs: string[] = [];
  defs.push(`<style>${assets.fontCss}\ntext{font-kerning:normal;}</style>`);
  defs.push(`<clipPath id="clip-frame">${el('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h })}</clipPath>`);
  if (sphere) defs.push(`<clipPath id="clip-sphere">${el('path', { d: sphereD })}</clipPath>`);
  if (!map) {
    defs.push(el('path', { id: 'land', d: path(land) ?? '' }));
    defs.push(`<clipPath id="clip-land"><use href="#land"/></clipPath>`);
  } else defs.push(...map.defs);
  defs.push(...routeDefs);
  const fullPage = { filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H, 'color-interpolation-filters': 'sRGB' };
  const [ar, ag, ab] = hexToRgb(S.paper.ageColor).map((v) => v / 255);
  if (S.paper.grain > 0) {
    const g = S.paper.grain;
    defs.push(
      el(
        'filter',
        { id: 'paper-grain', ...fullPage },
        el('feTurbulence', { type: 'fractalNoise', baseFrequency: S.paper.grainFrequency, numOctaves: 2, seed: 4, stitchTiles: 'stitch' }) +
          el('feColorMatrix', { type: 'matrix', values: `0 0 0 0 ${n(ar)} 0 0 0 0 ${n(ag)} 0 0 0 0 ${n(ab)} ${n(g * 1.2)} 0 0 0 ${n(-g * 0.5)}` }),
      ),
    );
  }
  if (S.paper.stains > 0 && ageing) {
    const s = S.paper.stains;
    defs.push(
      el(
        'filter',
        { id: 'paper-stains', ...fullPage },
        el('feTurbulence', { type: 'fractalNoise', baseFrequency: n(0.009 / k), numOctaves: 4, seed: 11 }) +
          el('feColorMatrix', { type: 'matrix', values: `0 0 0 0 ${n(ar)} 0 0 0 0 ${n(ag)} 0 0 0 0 ${n(ab)} ${n(s * 1.6)} 0 0 0 ${n(-s * 0.78)}` }),
      ),
    );
  }
  if (S.paper.vignette > 0 && ageing) {
    defs.push(
      `<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">` +
        `<stop offset="0.55" stop-color="${S.paper.ageColor}" stop-opacity="0"/>` +
        `<stop offset="0.9" stop-color="${S.paper.ageColor}" stop-opacity="${n(S.paper.vignette * 0.3)}"/>` +
        `<stop offset="1" stop-color="${S.paper.ageColor}" stop-opacity="${n(S.paper.vignette * 0.55)}"/></radialGradient>`,
    );
  }
  if (S.ink.wobble > 0) {
    defs.push(
      el(
        'filter',
        { id: 'ink', ...fullPage },
        el('feTurbulence', { type: 'fractalNoise', baseFrequency: n(0.35 / k), numOctaves: 2, seed: 2, result: 't' }) +
          el('feDisplacementMap', { in: 'SourceGraphic', in2: 't', scale: S.ink.wobble * k * 2.5, xChannelSelector: 'R', yChannelSelector: 'G' }),
      ),
    );
  }
  const wl = S.map.waterLines;
  if (!map && wl.count > 0 && wl.spacing > 0) {
    let rings = '';
    for (let i = wl.count; i >= 1; i--) {
      const grey = Math.round(255 * (1 - ((i - 1) / wl.count) * 0.65));
      rings += el('use', { href: '#land', fill: 'none', stroke: `rgb(${grey},${grey},${grey})`, 'stroke-width': (2 * i * wl.spacing + wl.width) * k });
      rings += el('use', { href: '#land', fill: 'none', stroke: '#000', 'stroke-width': Math.max(0, (2 * i * wl.spacing - wl.width) * k) });
    }
    defs.push(`<mask id="water-lines" maskUnits="userSpaceOnUse" x="0" y="0" width="${n(W)}" height="${n(H)}">${rings}</mask>`);
  }
  if (S.flags.tone > 0) {
    const t = S.flags.tone;
    const sep = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
    const m = [0, 1, 2].map((row) => [0, 1, 2].map((col) => (row === col ? 1 - t : 0) + t * sep[row * 3 + col]));
    defs.push(el('filter', { id: 'flag-tone', 'color-interpolation-filters': 'sRGB' }, el('feColorMatrix', { type: 'matrix', values: `${m.map((row) => `${row.map(n).join(' ')} 0 0`).join(' ')} 0 0 0 1 0` })));
  }
  for (const code of new Set(flags.map((f) => f.code))) defs.push(flagSymbol(code, assets.flags[code]));

  const body: string[] = [];
  body.push(el('rect', { x: 0, y: 0, width: W, height: H, fill: S.paper.color }));
  // The map, clipped to the frame (and to the globe's outline on a world map).
  const mapSvg: string[] = [];
  if (map) {
    // Artistic layouts: plain sea and decoration under the layout's own drawing.
    mapSvg.push(el('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, fill: S.map.sea }));
    mapSvg.push(panels.rhumb);
    mapSvg.push(map.base);
  } else {
    mapSvg.push(sphere ? el('path', { d: sphereD, fill: S.map.sea }) : el('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, fill: S.map.sea }));
    if (o.show.graticule) {
      const step = S.map.graticule.step;
      const grat = path(geoGraticule().step([step, step]).extentMinor([[-180, -80 - 1e-6], [180, 80 + 1e-6]])()) ?? '';
      mapSvg.push(el('path', { d: grat, fill: 'none', stroke: S.map.graticule.color, 'stroke-width': S.map.graticule.width * k, 'stroke-dasharray': S.map.graticule.dash.length ? S.map.graticule.dash.map((d) => n(d * k)).join(' ') : undefined }));
    }
    mapSvg.push(panels.rhumb);
    if (wl.count > 0 && wl.spacing > 0) mapSvg.push(el('rect', { x: 0, y: 0, width: W, height: H, fill: wl.color, opacity: wl.opacity, mask: 'url(#water-lines)' }));
    mapSvg.push(el('use', { href: '#land', fill: S.map.land }));
    if (S.map.landShade.opacity > 0 && S.map.landShade.width > 0)
      mapSvg.push(`<g clip-path="url(#clip-land)">${el('use', { href: '#land', fill: 'none', stroke: S.map.landShade.color, 'stroke-width': S.map.landShade.width * 2 * k, opacity: S.map.landShade.opacity })}</g>`);
    mapSvg.push(
      el('path', {
        d: path(borders) ?? '',
        fill: 'none',
        stroke: S.map.borders.color,
        'stroke-width': S.map.borders.width * k,
        'stroke-dasharray': S.map.borders.dash.length ? S.map.borders.dash.map((d) => n(d * k)).join(' ') : undefined,
        'stroke-linejoin': 'round',
      }),
    );
    mapSvg.push(el('use', { href: '#land', fill: 'none', stroke: S.map.coast.color, 'stroke-width': S.map.coast.width * k, 'stroke-linejoin': 'round', filter: S.ink.wobble > 0 ? 'url(#ink)' : undefined }));
    if (sphere) mapSvg.push(el('path', { d: sphereD, fill: 'none', stroke: S.ink.main, 'stroke-width': S.frame.innerWidth * k * 1.5 }));
  }
  mapSvg.push(countriesSvg, oceansSvg);
  // Routes: halos first, so crossing routes stay legible, then the ink.
  if (S.routes.halo) for (const s of strokes) mapSvg.push(routeSvg(s, S.routes.halo, S, k, true));
  mapSvg.push(`<g opacity="${n(S.routes.opacity)}">${strokes.map((s) => routeSvg(s, ink(s.gen), S, k, false)).join('')}</g>`);
  const overlay: string[] = [];
  overlay.push(routeLabelsSvg);
  overlay.push(marks.map((m) => markSvg(S, m.pt, markR)).join(''));
  overlay.push(bannersSvg);
  overlay.push(flags.map((f, i) => roundelSvg(S, f, i, ringOut, flagLabel, medallions.length || namedCountries.has(f.code) ? '' : countryName(f.code, o.lang), o.lang, k)).join(''));
  overlay.push(placeLabelsSvg);
  body.push(`<g clip-path="url(#${clipId})">${mapSvg.join('')}</g>`);
  // Marks, flags and names may sit past the globe's edge on a world map, but stay inside the frame.
  body.push(`<g clip-path="url(#clip-frame)">${overlay.join('')}</g>`);
  body.push(B ? drawBorder(B, S, outer, frame, k) : mapFrame(S, outer, frame, S.frame.degreeLabels && geographic ? frameTicks(projection, frame, S.map.graticule.step) : [], o.lang, k));
  body.push(panels.svg);
  if (caption) body.push(caption.svg(outer.y + outer.h, W / 2));
  // Ageing on top of everything, as it would be on real paper.
  if (S.paper.stains > 0 && ageing) body.push(el('rect', { x: 0, y: 0, width: W, height: H, filter: 'url(#paper-stains)' }));
  if (S.paper.grain > 0) body.push(el('rect', { x: 0, y: 0, width: W, height: H, filter: 'url(#paper-grain)' }));
  if (S.paper.vignette > 0 && ageing) body.push(el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#vignette)' }));
  const finished = applyFinish(finish, S, W, H, k, body.join(''));

  const size = o.pixelSize ? { width: o.pixelSize.width, height: o.pixelSize.height } : { width: `${n(W)}mm`, height: `${n(H)}mm` };
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size.width}" height="${size.height}" viewBox="0 0 ${n(W)} ${n(H)}">` +
    `<title>${esc(o.title || 'Heritage map')}</title>` +
    `<defs>${defs.join('')}${finished.defs}</defs>${finished.svg}</svg>`;

  return {
    svg,
    width: W,
    height: H,
    layout: {
      map: frame,
      cartouche: panels.cartouche,
      legend: panels.legend,
      compass: panels.compass,
      scaleBar: panels.scale,
      flags,
      marks: markPts,
      routes: strokes,
      labels,
      routeLabels,
      medallions,
      droppedLabels: dropped,
    },
    warnings,
  };
}

/** Attributes as a string, for elements written by hand. */
const attrsOf = (a: Record<string, string | number | undefined>) =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([key, v]) => `${key}="${typeof v === 'number' ? n(v) : esc(String(v))}"`)
    .join(' ');

const attrsOfHalo = (S: PrintStyle, k: number) => {
  const h = halo(S, k);
  return 'stroke' in h ? ` ${attrsOf(h as Record<string, string | number>)}` : '';
};

/** The title, years and dedication set under the map, for a gallery border. */
function captionLayout(o: PrintOptions, S: PrintStyle, k: number, W: number, measure: MeasureText) {
  const title = (S.uppercaseTitles ? o.title.toLocaleUpperCase(o.lang) : o.title).trim();
  const tSize = sized('title', S.cartouche.titleSize * 0.7, k);
  const sSize = sized('subtitle', S.cartouche.subtitleSize * 0.9, k);
  const dSize = sized('dedication', S.cartouche.dedicationSize, k);
  const maxW = W * 0.7;
  const tw = measure(title, S.fonts.title, tSize);
  const tFit = tw > maxW ? (tSize * maxW) / tw : tSize;
  const ded = wrapText(o.dedication.trim(), maxW, (s) => measure(s, S.fonts.italic, dSize)).slice(0, 2);
  const lines: { text: string; font: FontRef; size: number; color: string; dy: number }[] = [];
  if (title) lines.push({ text: title, font: S.fonts.title, size: tFit, color: S.cartouche.stroke, dy: tFit });
  if (o.subtitle.trim()) lines.push({ text: o.subtitle.trim(), font: S.fonts.heading, size: sSize, color: S.ink.accent, dy: sSize * 1.5 });
  for (const t of ded) lines.push({ text: t, font: S.fonts.italic, size: dSize, color: S.cartouche.stroke, dy: dSize * 1.45 });
  const h = lines.reduce((s, l) => s + l.dy, 0) + 8 * k;
  return {
    h,
    svg: (top: number, cx: number) => {
      let y = top + 5 * k;
      return (
        `<g class="caption">` +
        lines
          .map((l) => {
            y += l.dy;
            return el('text', { x: cx, y, 'text-anchor': 'middle', fill: l.color, ...fontAttrs(l.font, l.size), 'letter-spacing': l.font === S.fonts.title ? l.size * 0.08 : undefined }, esc(l.text));
          })
          .join('') +
        `</g>`
      );
    },
  };
}

/** Text outline in the paper colour, so names read over lines. */
function halo(S: PrintStyle, k: number) {
  if (!S.labels.halo) return {};
  return { stroke: S.labels.halo, 'stroke-width': 0.9 * k, 'stroke-linejoin': 'round', 'paint-order': 'stroke' };
}

function arrowHeadAt(pts: Pt[], size: number): [Pt, Pt, Pt] {
  const tip = pts[pts.length - 1];
  const from = pts[pts.length - 2];
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const back = (da: number): Pt => [tip[0] - size * Math.cos(a + da), tip[1] - size * Math.sin(a + da)];
  return [tip, back(0.42), back(-0.42)];
}

/** One route piece as a pen stroke (tapering in from its origin) with its arrowhead. */
function routeSvg(s: RouteStroke, color: string, S: PrintStyle, k: number, asHalo: boolean): string {
  if (s.pts.length < 2) return '';
  const extra = asHalo ? S.routes.haloWidth * k : 0;
  const taper = S.routes.taper && s.fromOrigin;
  const width = (t: number) => (taper ? s.width * (0.3 + 0.7 * Math.min(1, t / 0.3)) : s.width) + extra;
  let out = el('path', { d: polygonPath(ribbon(s.pts, width)), fill: color, stroke: color, 'stroke-width': 0.08 * k + extra * 0.0, 'stroke-linejoin': 'round' });
  if (s.arrow) {
    const [tip, a, b] = s.arrow;
    if (S.routes.arrow === 'triangle') {
      out += el('path', { d: polygonPath([tip, a, b]), fill: color, stroke: color, 'stroke-width': 0.15 * k + extra, 'stroke-linejoin': 'round' });
    } else {
      // Barbed: two strokes back from the tip, like a quill arrow.
      out += el('path', { d: `${linePath([a, tip, b])}`, fill: 'none', stroke: color, 'stroke-width': Math.max(s.width * 0.9, 0.5 * k) + extra, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    }
  }
  return out;
}

function markSvg(S: PrintStyle, [x, y]: Pt, r: number): string {
  const m = S.marks;
  const lw = r * 0.35;
  if (m.kind === 'dot') return el('circle', { cx: x, cy: y, r, fill: m.fill, stroke: m.stroke, 'stroke-width': lw * 0.8 });
  if (m.kind === 'ring')
    return el('circle', { cx: x, cy: y, r, fill: m.fill, stroke: m.stroke, 'stroke-width': lw }) + el('circle', { cx: x, cy: y, r: r * 0.3, fill: m.stroke });
  // Town: a small circle with a dot, as engraved maps mark towns.
  return el('circle', { cx: x, cy: y, r, fill: m.fill, stroke: m.stroke, 'stroke-width': lw * 0.9 }) + el('circle', { cx: x, cy: y, r: r * 0.38, fill: m.stroke });
}

function roundelSvg(
  S: PrintStyle,
  f: { code: string; center: Pt; r: number; anchor: Pt },
  index: number,
  ringOut: number,
  labelSize: number,
  name: string,
  lang: 'pt' | 'en',
  k: number,
): string {
  const [cx, cy] = f.center;
  const R = f.r;
  const F = S.flags;
  let out = '';
  const d = Math.hypot(cx - f.anchor[0], cy - f.anchor[1]);
  if (d > R + ringOut + 1 * k) {
    // Dotted leader from the roundel to the family's places in that country.
    const ux = (f.anchor[0] - cx) / d;
    const uy = (f.anchor[1] - cy) / d;
    out += el('path', {
      d: linePath([[cx + ux * (R + ringOut), cy + uy * (R + ringOut)], [f.anchor[0] - ux * 1.2 * k, f.anchor[1] - uy * 1.2 * k]]),
      stroke: F.leader,
      'stroke-width': 0.3 * k,
      'stroke-dasharray': `${n(0.2 * k)} ${n(0.9 * k)}`,
      'stroke-linecap': 'round',
      fill: 'none',
    });
  }
  if (F.outerRing) out += el('circle', { cx, cy, r: R + ringOut * 0.55, fill: 'none', stroke: F.outerRing, 'stroke-width': ringOut * 0.9 });
  out += `<clipPath id="roundel-${index}">${el('circle', { cx, cy, r: R })}</clipPath>`;
  out += `<g clip-path="url(#roundel-${index})"${F.tone > 0 ? ' filter="url(#flag-tone)"' : ''}>${el('use', { href: `#flag-${f.code}`, x: cx - R, y: cy - R, width: 2 * R, height: 2 * R })}</g>`;
  out += el('circle', { cx, cy, r: R, fill: 'none', stroke: F.ring, 'stroke-width': F.ringWidth * k });
  if (F.outerRing) out += el('circle', { cx, cy, r: R + ringOut, fill: 'none', stroke: F.ring, 'stroke-width': F.ringWidth * k * 0.6 });
  if (name) {
    out += el(
      'text',
      { x: cx, y: cy + R + ringOut + labelSize * 1.15, 'text-anchor': 'middle', fill: S.ink.main, ...halo(S, k), ...fontAttrs(S.fonts.heading, labelSize) },
      esc(name.toLocaleUpperCase(lang)),
    );
  }
  return `<g class="roundel">${out}</g>`;
}
