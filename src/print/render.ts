// The heritage map print: a pure function from the family's places and moves to an SVG document.
// No DOM, no network: everything it needs comes in through its arguments, so the same code makes
// the on-screen preview and (later) the final file on a server.

import { geoGraticule, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { CountryLocator, countryName, topoFeatures } from './countries';
import { frameTicks, inset, kmPerMm, makeProjection, niceScaleKm, pageSize, showsWholeSphere, sizeScale } from './geo';
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
} from './layout';
import { compassBox, compassRose, mapFrame, panelFrame, panelOrnamentPad, rhumbLines, rule, scaleBar, scaleBarHeight } from './ornaments';
import { projectRoutes, ribbon, type RouteStroke } from './routes';
import type { PrintStyle } from './style';
import { el, esc, flagSymbol, fontAttrs, linePath, n, polygonPath, roman } from './svg';
import { STRINGS, WATERS } from './text';
import type { Box, PrintAssets, PrintData, PrintOptions, PrintPerson, Pt } from './types';

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

export function renderHeritageMap(data: PrintData, o: PrintOptions, assets: PrintAssets): RenderResult {
  const S = o.style;
  const { w: W, h: H } = pageSize(o.paper, o.orientation);
  const k = sizeScale(o.paper);
  const measure = assets.measure ?? estimateText;
  const T = STRINGS[o.lang];
  const warnings: string[] = [];
  const { locator, land, borders } = geoFor(assets.topology);

  // ---------- Frame and projection ----------
  const margin = S.frame.margin * k;
  const outer: Box = { x: margin, y: margin, w: W - 2 * margin, h: H - 2 * margin };
  const frame = inset(outer, S.frame.band * k);
  const projection = makeProjection(o.area, data.people, frame, S.map.projection);
  const path = geoPath(projection).digits(2);
  const sphere = showsWholeSphere(o.area, S.map.projection);
  const project = (p: { lat: number; lon: number }): Pt | null => {
    const q = projection([p.lon, p.lat]);
    return q && Number.isFinite(q[0]) && Number.isFinite(q[1]) ? [q[0], q[1]] : null;
  };
  const inFrame = (p: Pt, pad = 0) => p[0] >= frame.x + pad && p[0] <= frame.x + frame.w - pad && p[1] >= frame.y + pad && p[1] <= frame.y + frame.h - pad;

  // ---------- Generations and inks ----------
  const gens = data.people.map((p) => p.gen);
  const minGen = Math.min(0, ...gens);
  const maxGen = Math.max(0, ...gens);
  const ink = (g: number) => generationInk(S, g, minGen, maxGen);
  const yearOf = new Map(data.people.map((p) => [p.id, p.birthYear]));

  // ---------- Birthplace marks ----------
  const markR = (S.marks.size * k) / 2;
  const marks: { pt: Pt; people: PrintPerson[] }[] = [];
  const byPlace = new Map<string, PrintPerson[]>();
  for (const p of data.people) {
    const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    byPlace.set(key, [...(byPlace.get(key) ?? []), p]);
  }
  for (const group of [...byPlace.values()].sort((a, b) => b.length - a.length)) {
    const pt = project(group[0]);
    if (!pt || !inFrame(pt)) continue;
    // Places that would print on top of each other share a mark.
    const near = marks.find((m) => Math.hypot(m.pt[0] - pt[0], m.pt[1] - pt[1]) < markR * 1.6);
    if (near) near.people.push(...group);
    else marks.push({ pt, people: [...group] });
  }
  if (marks.length < byPlace.size) {
    const off = data.people.filter((p) => {
      const q = project(p);
      return !q || !inFrame(q);
    }).length;
    if (off) warnings.push(`${off} ${off === 1 ? 'person is' : 'people are'} born outside the chosen area and not shown.`);
  }

  // ---------- Routes ----------
  const arrowSize = S.routes.arrow === 'none' ? 0 : S.routes.arrowSize * k;
  const { strokes, dates } = projectRoutes(
    data.flows,
    (p) => {
      const q = project(p);
      return q && inFrame(q, -Math.max(frame.w, frame.h) * 0.25) ? q : null;
    },
    {
      radius: 5 * k,
      minWidth: S.routes.minWidth * k,
      maxWidth: S.routes.maxWidth * k,
      endGap: markR + 0.7 * k,
      arrowSize,
      wobble: S.ink.wobble * k,
      dateOffset: S.routes.dateSize * k * 0.55 + 0.5 * k,
    },
    (id) => yearOf.get(id),
  );

  // ---------- Panels: cartouche, legend, compass, scale bar ----------
  const obs: Obstacles = { points: [...marks.map((m) => m.pt), ...strokes.flatMap((s) => s.pts)], boxes: [] };
  const panelGap = 5 * k;
  const placed: Box[] = [];
  const upper = (s: string) => (S.uppercaseTitles ? s.toLocaleUpperCase(o.lang) : s);

  let cartouche: (Box & { lines: TextLine[] }) | undefined;
  let cartoucheSvg = '';
  if (o.title.trim() || o.subtitle.trim() || o.dedication.trim()) {
    const lay = layoutCartouche(
      { title: upper(o.title), subtitle: o.subtitle, dedication: o.dedication },
      { title: S.fonts.title, subtitle: S.fonts.heading, dedication: S.fonts.italic },
      { title: S.cartouche.titleSize * k, subtitle: S.cartouche.subtitleSize * k, dedication: S.cartouche.dedicationSize * k },
      frame.w * S.cartouche.maxWidthShare,
      measure,
      panelOrnamentPad(S, k),
    );
    const curls = S.cartouche.kind === 'scroll' ? Math.min(4.5 * k, lay.h * 0.18) : 0;
    const { box } = placePanel(frame, lay.w + 2 * curls, lay.h, obs, placed, panelGap);
    const b: Box = { x: box.x + curls, y: box.y, w: lay.w, h: lay.h };
    placed.push(box);
    cartouche = { ...b, lines: lay.lines };
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
    cartoucheSvg = `<g class="cartouche">${body}</g>`;
  }

  // Generations that moved, oldest first, labelled by when they were born.
  const moverGens = [...new Set(strokes.map((s) => s.gen))].sort((a, b) => b - a);
  const flagMode = o.show.flags;

  // Countries for the flags, with the family's places in each (to place the roundel near them).
  const flagAnchors = new Map<string, { pts: Pt[]; people: number }>();
  if (flagMode !== 'none') {
    const add = (code: string, pt: Pt | null, count: number) => {
      if (!code || !pt) return;
      const e = flagAnchors.get(code) ?? { pts: [], people: 0 };
      e.pts.push(pt);
      e.people += count;
      flagAnchors.set(code, e);
    };
    if (flagMode === 'origins') for (const f of data.flows) add(locator.locate(f.from), project(f.from), f.parents.length);
    else for (const m of marks) add(locator.locate(m.people[0]), m.pt, m.people.length);
  }
  const flagCodes = [...flagAnchors.keys()].filter((c) => {
    if (assets.flags[c]) return true;
    warnings.push(`No flag available for country code "${c}".`);
    return false;
  });

  let legendSvg = '';
  let legendBox: Box | undefined;
  if (o.show.legend) {
    const rows: LegendRow[] = moverGens.map((g, i) => {
      const years = yearSpan(data.people.filter((p) => p.gen === g).map((p) => p.birthYear).filter((y): y is number => y !== undefined));
      return { label: years ? T.generationOf(years) : T.generation(roman(i + 1)), kind: 'route', color: ink(g) };
    });
    rows.push({ label: T.birthplace, kind: 'mark' });
    if (flagCodes.length) rows.push({ label: T.origin, kind: 'flag' });
    const lay = layoutLegend(upper(T.legend), rows, { title: S.fonts.heading, row: S.fonts.body }, { title: S.legend.titleSize * k, row: S.legend.rowSize * k }, frame.w * 0.28, measure);
    const { box } = placePanel(frame, lay.w, lay.h, obs, placed, panelGap);
    placed.push(box);
    legendBox = box;
    let body = panelFrame(S, box, k, false);
    body += el('text', { x: box.x + box.w / 2, y: box.y + lay.title.y, 'text-anchor': 'middle', fill: S.legend.stroke, ...fontAttrs(lay.title.font, lay.title.size) }, esc(lay.title.text));
    for (const r of lay.rows) {
      const sx = box.x + lay.pad;
      const sy = box.y + r.y - r.size * 0.3;
      if (r.row.kind === 'route') {
        const pts: Pt[] = Array.from({ length: 9 }, (_, i) => [sx + (i / 8) * lay.swatchW, sy + Math.sin((i / 8) * Math.PI) * -r.size * 0.35]);
        body += routeSvg({ gen: 0, kind: 'out', pts, width: S.routes.minWidth * k * 1.6, fromOrigin: S.routes.taper, arrow: arrowSize ? arrowHeadAt(pts, Math.min(arrowSize, r.size)) : undefined }, r.row.color!, S, k, false);
      } else if (r.row.kind === 'mark') {
        body += markSvg(S, [sx + lay.swatchW / 2, sy], markR);
      } else {
        // A little generic flag in a roundel: two colour fields and a ring.
        const rr = r.size * 0.6;
        const cx = sx + lay.swatchW / 2;
        body += el('path', { d: `M${n(cx)},${n(sy - rr)}A${n(rr)},${n(rr)} 0 0 0 ${n(cx)},${n(sy + rr)}Z`, fill: S.ink.accent });
        body += el('path', { d: `M${n(cx)},${n(sy - rr)}A${n(rr)},${n(rr)} 0 0 1 ${n(cx)},${n(sy + rr)}Z`, fill: S.ink.faint });
        body += el('circle', { cx, cy: sy, r: rr, fill: 'none', stroke: S.flags.outerRing || S.ink.main, 'stroke-width': Math.max(S.flags.ringWidth, 0.3) * k });
      }
      body += el('text', { x: box.x + r.textX, y: box.y + r.y, fill: S.legend.stroke, ...fontAttrs(S.fonts.body, r.size) }, esc(r.row.label));
    }
    legendSvg = `<g class="legend">${body}</g>`;
  }

  let compassSvg = '';
  let rhumbSvg = '';
  let compassBoxPlaced: Box | undefined;
  if (o.show.compass) {
    const size = S.compass.size * k;
    const side = compassBox(size);
    const { box } = placePanel(frame, side, side, obs, placed, panelGap, ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top', 'bottom']);
    placed.push(box);
    compassBoxPlaced = box;
    const cx = box.x + side / 2;
    const cy = box.y + side / 2;
    compassSvg = compassRose(S, cx, cy, size, o.lang, k);
    rhumbSvg = rhumbLines(S, cx, cy, Math.hypot(W, H), k);
  }

  let scaleSvg = '';
  let scaleBoxPlaced: Box | undefined;
  if (o.show.scaleBar) {
    const center: Pt = [frame.x + frame.w / 2, frame.y + frame.h / 2];
    const kpm = kmPerMm(projection, center);
    if (Number.isFinite(kpm) && kpm > 0) {
      const km = niceScaleKm(kpm, S.scaleBar.length * k);
      const barMm = km / kpm;
      const caption = o.area === 'world' && sphere ? T.scaleEquator : T.scale;
      const capW = measure(caption, S.fonts.italic, 3 * k);
      const w = Math.max(barMm, capW) + 6 * k;
      const h = scaleBarHeight(k) + 2 * k;
      const { box } = placePanel(frame, w, h, obs, placed, panelGap, ['bottom-right', 'bottom-left', 'bottom', 'top-right', 'top-left', 'top']);
      placed.push(box);
      scaleBoxPlaced = box;
      scaleSvg = scaleBar(S, box.x + (box.w - barMm) / 2, box.y + k, barMm, km, caption, k);
    }
  }

  // ---------- Flag roundels ----------
  const r = S.flags.radius * k;
  const ringOut = S.flags.outerRing ? S.flags.ringWidth * k * 2.2 : 0;
  const flagLabel = S.flags.labelSize * k;
  const taken: Box[] = [...placed];
  const flags: RenderResult['layout']['flags'] = [];
  const markPts = marks.map((m) => m.pt);
  const routeLines = strokes.map((s) => s.pts);
  for (const code of flagCodes.sort((a, b) => flagAnchors.get(b)!.people - flagAnchors.get(a)!.people)) {
    // Only the family's places that are on this map count; a country entirely off the map gets no flag.
    const pts = flagAnchors.get(code)!.pts.filter((p) => inFrame(p));
    if (!pts.length) continue;
    const anchor: Pt = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const R = r + ringOut;
    const spot = placeRoundel(anchor, R, flagLabel * 1.8, inset(frame, 1.5 * k), markPts, routeLines, taken);
    if (!spot) continue;
    const { center, box } = spot;
    taken.push(box);
    flags.push({ code, center, r, anchor });
  }

  // ---------- Labels ----------
  const labels: RenderResult['layout']['labels'] = [];
  const dropped: string[] = [];
  for (const m of marks) taken.push({ x: m.pt[0] - markR, y: m.pt[1] - markR, w: 2 * markR, h: 2 * markR });
  const placeSize = S.labels.placeSize * k;
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

  let datesSvg = '';
  if (o.show.dates) {
    const size = S.routes.dateSize * k;
    for (const d of dates) {
      const w = measure(d.text, S.fonts.italic, size);
      const a = (d.angle * Math.PI) / 180;
      const bw = Math.abs(w * Math.cos(a)) + Math.abs(size * Math.sin(a));
      const bh = Math.abs(w * Math.sin(a)) + Math.abs(size * Math.cos(a));
      const box: Box = { x: d.at[0] - bw / 2, y: d.at[1] - bh / 2, w: bw, h: bh };
      if (!contains(frame, box) || taken.some((t) => overlaps(t, box))) {
        dropped.push(d.text);
        continue;
      }
      taken.push(box);
      datesSvg += el(
        'text',
        { transform: `translate(${n(d.at[0])} ${n(d.at[1])}) rotate(${n(d.angle)})`, y: size * 0.35, 'text-anchor': 'middle', fill: ink(d.gen), ...halo(S, k), ...fontAttrs(S.fonts.italic, size) },
        esc(d.text),
      );
    }
  }

  let countriesSvg = '';
  const namedCountries = new Set<string>();
  if (o.show.countryNames) {
    const codes = new Map<string, number>();
    for (const m of marks) {
      const c = locator.locate(m.people[0]);
      if (c) codes.set(c, (codes.get(c) ?? 0) + m.people.length);
    }
    const size = S.labels.countrySize * k;
    const spacing = S.labels.countryLetterSpacing * k;
    for (const [code] of [...codes].sort((a, b) => b[1] - a[1])) {
      const lp = locator.labelPoint(code);
      const pt = lp && project({ lon: lp[0], lat: lp[1] });
      const text = countryName(code, o.lang).toLocaleUpperCase(o.lang);
      if (!pt || !text) continue;
      const w = measure(text, S.fonts.heading, size, spacing);
      const h = size * 1.05;
      // Near the middle of the country, and with the middle of the name still over the country.
      const spot = [0, -1.6, 1.6, -3.2, 3.2]
        .flatMap((dy) => [0, -0.3, 0.3].map((dx): Box => ({ x: pt[0] - w / 2 + dx * w, y: pt[1] + dy * size - h / 2, w, h })))
        .find((b) => {
          if (!contains(frame, b) || taken.some((t) => overlaps(t, b))) return false;
          const g = projection.invert?.([b.x + b.w / 2, b.y + b.h / 2]);
          return !!g && locator.codeAt(g[0], g[1]) === code;
        });
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
    const kpm = kmPerMm(projection, [frame.x + frame.w / 2, frame.y + frame.h / 2]);
    for (const water of WATERS) {
      // Small seas only when the map is zoomed in enough for them to matter.
      if (!water.major && !(kpm < 12)) continue;
      const size = S.labels.oceanSize * k * (water.major ? 1 : 0.6);
      const spacing = S.labels.oceanLetterSpacing * k * (water.major ? 1 : 0.6);
      const text = water.name[o.lang].toLocaleUpperCase(o.lang);
      const w = measure(text, S.fonts.italic, size, spacing);
      const h = size * 1.05;
      for (const [lon, lat] of water.at) {
        const pt = project({ lon, lat });
        if (!pt) continue;
        const box: Box = { x: pt[0] - w / 2, y: pt[1] - h / 2, w, h };
        // The whole name has to be over the sea, not just its middle.
        const overLand = Array.from({ length: 11 }, (_, i) => [box.x + (i / 10) * box.w, pt[1]] as Pt).some((q) => {
          const g = projection.invert?.(q);
          return !g || !!locator.codeAt(g[0], g[1]);
        });
        if (overLand) continue;
        if (!contains(inset(frame, 2 * k), box) || taken.some((t) => overlaps(t, box, k))) continue;
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
  const landD = path(land) ?? '';
  const sphereD = path({ type: 'Sphere' }) ?? '';
  const clipId = sphere ? 'clip-sphere' : 'clip-frame';
  const defs: string[] = [];
  defs.push(`<style>${assets.fontCss}\ntext{font-kerning:normal;}</style>`);
  defs.push(el('path', { id: 'land', d: landD }));
  defs.push(`<clipPath id="clip-frame">${el('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h })}</clipPath>`);
  if (sphere) defs.push(`<clipPath id="clip-sphere">${el('path', { d: sphereD })}</clipPath>`);
  defs.push(`<clipPath id="clip-land"><use href="#land"/></clipPath>`);
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
  if (S.paper.stains > 0) {
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
  if (S.paper.vignette > 0) {
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
  if (wl.count > 0 && wl.spacing > 0) {
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
  for (const f of flags) defs.push(flagSymbol(f.code, assets.flags[f.code]));

  const body: string[] = [];
  body.push(el('rect', { x: 0, y: 0, width: W, height: H, fill: S.paper.color }));
  // Map, clipped to the frame (and to the globe's outline on a world map).
  const map: string[] = [];
  map.push(sphere ? el('path', { d: sphereD, fill: S.map.sea }) : el('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, fill: S.map.sea }));
  if (o.show.graticule) {
    const step = S.map.graticule.step;
    const grat = path(geoGraticule().step([step, step]).extentMinor([[-180, -80 - 1e-6], [180, 80 + 1e-6]])()) ?? '';
    map.push(el('path', { d: grat, fill: 'none', stroke: S.map.graticule.color, 'stroke-width': S.map.graticule.width * k, 'stroke-dasharray': S.map.graticule.dash.length ? S.map.graticule.dash.map((d) => n(d * k)).join(' ') : undefined }));
  }
  map.push(rhumbSvg);
  if (wl.count > 0 && wl.spacing > 0) map.push(el('rect', { x: 0, y: 0, width: W, height: H, fill: wl.color, opacity: wl.opacity, mask: 'url(#water-lines)' }));
  map.push(el('use', { href: '#land', fill: S.map.land }));
  if (S.map.landShade.opacity > 0 && S.map.landShade.width > 0)
    map.push(`<g clip-path="url(#clip-land)">${el('use', { href: '#land', fill: 'none', stroke: S.map.landShade.color, 'stroke-width': S.map.landShade.width * 2 * k, opacity: S.map.landShade.opacity })}</g>`);
  map.push(
    el('path', {
      d: path(borders) ?? '',
      fill: 'none',
      stroke: S.map.borders.color,
      'stroke-width': S.map.borders.width * k,
      'stroke-dasharray': S.map.borders.dash.length ? S.map.borders.dash.map((d) => n(d * k)).join(' ') : undefined,
      'stroke-linejoin': 'round',
    }),
  );
  map.push(el('use', { href: '#land', fill: 'none', stroke: S.map.coast.color, 'stroke-width': S.map.coast.width * k, 'stroke-linejoin': 'round', filter: S.ink.wobble > 0 ? 'url(#ink)' : undefined }));
  if (sphere) map.push(el('path', { d: sphereD, fill: 'none', stroke: S.ink.main, 'stroke-width': S.frame.innerWidth * k * 1.5 }));
  map.push(countriesSvg, oceansSvg);
  const overlay: string[] = [];
  // Routes: halos first, so crossing routes stay legible, then the ink.
  if (S.routes.halo) for (const s of strokes) map.push(routeSvg(s, S.routes.halo, S, k, true));
  map.push(`<g opacity="${n(S.routes.opacity)}">${strokes.map((s) => routeSvg(s, ink(s.gen), S, k, false)).join('')}</g>`);
  overlay.push(datesSvg);
  overlay.push(marks.map((m) => markSvg(S, m.pt, markR)).join(''));
  overlay.push(flags.map((f) => roundelSvg(S, f, ringOut, flagLabel, namedCountries.has(f.code) ? '' : countryName(f.code, o.lang), o.lang, k)).join(''));
  overlay.push(placeLabelsSvg);
  body.push(`<g clip-path="url(#${clipId})">${map.join('')}</g>`);
  // Marks, flags and names may sit past the globe's edge on a world map, but stay inside the frame.
  body.push(`<g clip-path="url(#clip-frame)">${overlay.join('')}</g>`);
  body.push(mapFrame(S, outer, frame, S.frame.degreeLabels ? frameTicks(projection, frame, S.map.graticule.step) : [], o.lang, k));
  body.push(compassSvg, scaleSvg, legendSvg, cartoucheSvg);
  // Ageing on top of everything, as it would be on real paper.
  if (S.paper.stains > 0) body.push(el('rect', { x: 0, y: 0, width: W, height: H, filter: 'url(#paper-stains)' }));
  if (S.paper.grain > 0) body.push(el('rect', { x: 0, y: 0, width: W, height: H, filter: 'url(#paper-grain)' }));
  if (S.paper.vignette > 0) body.push(el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#vignette)' }));

  const size = o.pixelSize ? { width: o.pixelSize.width, height: o.pixelSize.height } : { width: `${n(W)}mm`, height: `${n(H)}mm` };
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size.width}" height="${size.height}" viewBox="0 0 ${n(W)} ${n(H)}">` +
    `<title>${esc(o.title || 'Heritage map')}</title>` +
    `<defs>${defs.join('')}</defs>${body.join('')}</svg>`;

  return {
    svg,
    width: W,
    height: H,
    layout: {
      map: frame,
      cartouche,
      legend: legendBox,
      compass: compassBoxPlaced,
      scaleBar: scaleBoxPlaced,
      flags,
      marks: markPts,
      routes: strokes,
      labels,
      droppedLabels: dropped,
    },
    warnings,
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
      out += el('path', { d: `${linePath([a, tip, b])}`, fill: 'none', stroke: color, 'stroke-width': Math.max(s.width * 0.8, 0.35 * k) + extra, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
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
  out += `<clipPath id="roundel-${f.code}">${el('circle', { cx, cy, r: R })}</clipPath>`;
  out += `<g clip-path="url(#roundel-${f.code})"${F.tone > 0 ? ' filter="url(#flag-tone)"' : ''}>${el('use', { href: `#flag-${f.code}`, x: cx - R, y: cy - R, width: 2 * R, height: 2 * R })}</g>`;
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
