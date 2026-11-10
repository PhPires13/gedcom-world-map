import { describe, expect, it } from 'vitest';
import {
  contains,
  distToPolyline,
  estimateText,
  layoutCartouche,
  layoutLegend,
  overlaps,
  placeLabel,
  placePanel,
  placeRoundel,
  segmentHitsBox,
  wrapText,
} from '../../src/print/layout';
import type { Box, FontRef, Pt } from '../../src/print/types';

const title: FontRef = { family: 'T', widthFactor: 0.66 };
const body: FontRef = { family: 'B', widthFactor: 0.47 };
const fonts = { title, subtitle: body, dedication: body };
const sizes = { title: 17, subtitle: 6.5, dedication: 4.4 };
const frame: Box = { x: 18, y: 18, w: 558, h: 384 };

function expectFits(lay: ReturnType<typeof layoutCartouche>, maxW: number) {
  expect(lay.w).toBeLessThanOrEqual(maxW + 1e-9);
  for (const l of lay.lines) {
    expect(l.width).toBeLessThanOrEqual(lay.w - 2 * lay.padX + 1e-6);
    expect(l.y - l.size).toBeGreaterThanOrEqual(0); // top of the line inside the panel
    expect(l.y).toBeLessThanOrEqual(lay.h - lay.padY + 1e-6);
  }
}

describe('wrapText', () => {
  const width = (s: string) => s.length;
  it('wraps at word boundaries within the width', () => {
    const lines = wrapText('Para os nossos avós que atravessaram o mar', 15, width);
    expect(lines.join(' ')).toBe('Para os nossos avós que atravessaram o mar');
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(15);
  });
  it('keeps explicit line breaks and puts over-long words on their own line', () => {
    expect(wrapText('a\nb', 10, width)).toEqual(['a', 'b']);
    expect(wrapText('x Supercalifragilistic y', 5, width)).toEqual(['x', 'Supercalifragilistic', 'y']);
  });
});

describe('layoutCartouche', () => {
  it('lays out title, years and dedication inside the panel', () => {
    const lay = layoutCartouche({ title: 'Família Costa', subtitle: '1810–1998', dedication: 'Para os nossos avós, que atravessaram o mar.' }, fonts, sizes, 212, estimateText, 3.2);
    expect(lay.lines.map((l) => l.role)).toEqual(['title', 'subtitle', 'dedication']);
    expectFits(lay, 212);
  });

  it('shrinks, then wraps, a long family name so it is never clipped', () => {
    const lay = layoutCartouche(
      { title: 'Família Albuquerque de Vasconcelos Bettencourt e Menezes', subtitle: '1700–2000', dedication: '' },
      fonts,
      sizes,
      150,
      estimateText,
      3.2,
    );
    const t = lay.lines.filter((l) => l.role === 'title');
    expect(t.length).toBeGreaterThan(1);
    expect(t[0].size).toBeLessThan(sizes.title);
    expectFits(lay, 150);
  });

  it('shrinks a single word that is too long even on its own line', () => {
    const lay = layoutCartouche({ title: 'Wolfeschlegelsteinhausenbergerdorff', subtitle: '', dedication: '' }, fonts, sizes, 120, estimateText, 3);
    expectFits(lay, 120);
  });

  it('limits the dedication to four lines with an ellipsis', () => {
    const long = Array.from({ length: 80 }, (_, i) => `palavra${i}`).join(' ');
    const lay = layoutCartouche({ title: 'Família Silva', subtitle: '', dedication: long }, fonts, sizes, 200, estimateText, 3);
    const d = lay.lines.filter((l) => l.role === 'dedication');
    expect(d).toHaveLength(4);
    expect(d[3].text.endsWith('…')).toBe(true);
    expectFits(lay, 200);
  });

  it('uses the measuring function it is given', () => {
    const wide = (s: string, _f: FontRef, size: number) => s.length * size; // a very wide font
    const lay = layoutCartouche({ title: 'Família Costa', subtitle: '', dedication: '' }, fonts, sizes, 160, wide, 3);
    for (const l of lay.lines) expect(l.width).toBeLessThanOrEqual(lay.w - 2 * lay.padX + 1e-6);
  });
});

describe('layoutLegend', () => {
  it('fits every row, shrinking long labels', () => {
    const rows = [
      { label: 'Geração de 1905–1918', kind: 'route' as const, color: '#000' },
      { label: 'A label that is far too long to fit in a legend this narrow, by a lot', kind: 'mark' as const },
    ];
    const lay = layoutLegend('Legenda', rows, { title, row: body }, { title: 5.5, row: 3.6 }, 70, estimateText);
    expect(lay.w).toBeLessThanOrEqual(70);
    for (const r of lay.rows) expect(r.textX + estimateText(r.row.label, body, r.size)).toBeLessThanOrEqual(lay.w - lay.pad + 1e-6);
    expect(lay.rows[1].size).toBeLessThan(3.6);
    expect(lay.rows[1].y).toBeGreaterThan(lay.rows[0].y);
    expect(lay.h).toBeGreaterThan(lay.rows[1].y);
  });
});

describe('placement', () => {
  it('puts a panel in the emptiest corner, never on another panel', () => {
    // Crowd the bottom-left corner.
    const points: Pt[] = Array.from({ length: 30 }, (_, i) => [40 + i, 380]);
    const a = placePanel(frame, 150, 60, { points, boxes: [] }, [], 5);
    expect(a.anchor).not.toBe('bottom-left');
    const b = placePanel(frame, 150, 60, { points, boxes: [] }, [a.box], 5);
    expect(overlaps(a.box, b.box)).toBe(false);
    expect(contains(frame, a.box) && contains(frame, b.box)).toBe(true);
  });

  it('places a roundel near its anchor, off marks, routes and taken space', () => {
    const anchor: Pt = [300, 200];
    const marks: Pt[] = [anchor, [310, 200]];
    const route: Pt[] = [[300, 200], [300, 100]]; // a route straight up from the anchor
    const taken: Box[] = [{ x: 310, y: 180, w: 40, h: 40 }];
    const spot = placeRoundel(anchor, 6, 4, frame, marks, [route], taken)!;
    expect(spot).not.toBeNull();
    expect(contains(frame, spot.box)).toBe(true);
    for (const t of taken) expect(overlaps(spot.box, t)).toBe(false);
    for (const m of marks) expect(Math.hypot(m[0] - spot.center[0], m[1] - spot.center[1])).toBeGreaterThan(6);
    expect(distToPolyline(spot.center, route)).toBeGreaterThan(6); // not on the route
    expect(Math.hypot(spot.center[0] - 300, spot.center[1] - 200)).toBeLessThan(60);
  });

  it('gives up on a roundel that cannot fit in the frame', () => {
    expect(placeRoundel([20, 20], 300, 4, frame, [], [], [])).toBeNull();
  });

  it('places labels to the right first, then elsewhere, else nowhere', () => {
    const at: Pt = [100, 100];
    expect(placeLabel(at, 20, 4, 2, frame, [])!.anchor).toBe('start');
    const right: Box = { x: 101, y: 90, w: 30, h: 20 };
    expect(placeLabel(at, 20, 4, 2, frame, [right])!.anchor).toBe('end');
    const all: Box = { x: 60, y: 60, w: 80, h: 80 };
    expect(placeLabel(at, 20, 4, 2, frame, [all])).toBeNull();
  });

  it('detects a leader line crossing a box', () => {
    expect(segmentHitsBox([0, 0], [10, 10], { x: 4, y: 4, w: 2, h: 2 })).toBe(true);
    expect(segmentHitsBox([0, 0], [10, 0], { x: 4, y: 4, w: 2, h: 2 })).toBe(false);
  });
});
