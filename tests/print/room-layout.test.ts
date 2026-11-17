import { describe, expect, it } from 'vitest';
import {
  FRAME_PROFILE,
  HANG_GAP,
  MAT_WIDTH,
  ROOM_FRAMES,
  SIDEBOARD,
  frameForProduct,
  hangLayout,
  paperCm,
  pxPerCm,
  sceneView,
  sizeNote,
  toPercent,
  type Rect,
} from '../../src/print/room-layout';
import { sceneParts, sceneSvg } from '../../src/print/room';
import type { Orientation, PaperSize } from '../../src/print/types';

const PAPERS: PaperSize[] = ['A3', 'A2', 'A1'];
const ORIENTATIONS: Orientation[] = ['landscape', 'portrait'];
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const inside = (r: Rect, v: Rect) => r.x >= v.x && r.y >= v.y && r.x + r.w <= v.x + v.w && r.y + r.h <= v.y + v.h;

describe('room preview geometry', () => {
  it('gives each sheet its true size in cm, orientation aware', () => {
    expect(paperCm('A3', 'portrait')).toEqual({ w: 29.7, h: 42 });
    expect(paperCm('A2', 'landscape')).toEqual({ w: 59.4, h: 42 });
    expect(paperCm('A1', 'portrait')).toEqual({ w: 59.4, h: 84.1 });
  });

  it('hangs the sheet at true scale against the 90 cm sideboard', () => {
    for (const paper of PAPERS)
      for (const orientation of ORIENTATIONS) {
        const sheet = paperCm(paper, orientation);
        const h = hangLayout(paper, orientation, 'none');
        close(h.paper.w / SIDEBOARD.width, sheet.w / 90);
        close(h.paper.h, sheet.h);
      }
    // A1 landscape is wider than the sideboard's 90 cm with its frame and mount; A3 portrait is a third of it.
    expect(hangLayout('A1', 'landscape', 'black').outer.w).toBeGreaterThan(SIDEBOARD.width);
    expect(hangLayout('A3', 'portrait', 'none').paper.w / SIDEBOARD.width).toBeCloseTo(0.33, 2);
  });

  it('adds mount and moulding around a framed sheet, centred, its bottom above the sideboard', () => {
    const h = hangLayout('A2', 'portrait', 'gold');
    const border = MAT_WIDTH.A2 + FRAME_PROFILE.gold;
    close(h.outer.w, 42 + 2 * border);
    close(h.outer.h, 59.4 + 2 * border);
    close(h.outer.x + h.outer.w / 2, 0);
    close(h.outer.y + h.outer.h, -(SIDEBOARD.height + HANG_GAP));
    close(h.paper.x - h.outer.x, border);
    close(h.mat!.x - h.outer.x, FRAME_PROFILE.gold);
    expect(hangLayout('A2', 'portrait', 'none').mat).toBeUndefined();
  });

  it('keeps every size, orientation and frame inside both crops of the scene', () => {
    for (const narrow of [false, true])
      for (const paper of PAPERS)
        for (const orientation of ORIENTATIONS)
          for (const frame of ROOM_FRAMES) expect(inside(hangLayout(paper, orientation, frame).outer, sceneView(narrow))).toBe(true);
    const sideboard = { x: -SIDEBOARD.width / 2, y: -SIDEBOARD.height, w: SIDEBOARD.width, h: SIDEBOARD.height };
    expect(inside(sideboard, sceneView(true))).toBe(true);
  });

  it('maps scene cm to CSS percentages and screen pixels', () => {
    const view = { x: -100, y: -200, w: 200, h: 250 };
    expect(toPercent({ x: -50, y: -150, w: 100, h: 50 }, view)).toEqual({ left: 25, top: 20, width: 50, height: 20 });
    // On a 375 px phone (343 px of scene), an A2 landscape sheet in the narrow crop is ~129 px wide.
    const v = sceneView(true);
    expect(Math.round(paperCm('A2', 'landscape').w * pxPerCm(v, 343))).toBe(129);
  });

  it('follows the order panel: framed colours, unframed print as paper, digital keeps the choice', () => {
    expect(frameForProduct('framed', 'natural')).toBe('oak');
    expect(frameForProduct('framed', 'antique gold')).toBe('gold');
    expect(frameForProduct('framed', 'brown')).toBe('brown');
    expect(frameForProduct('framed', 'white')).toBe('white');
    expect(frameForProduct('framed', 'something new')).toBe('black');
    expect(frameForProduct('print')).toBe('none');
    expect(frameForProduct('digital')).toBeUndefined();
  });

  it('writes the scale note sizes', () => {
    expect(sizeNote('A2', 'portrait', 'none')).toEqual({ paper: 'A2', w: 42, h: 59.4, framed: undefined });
    expect(sizeNote('A3', 'landscape', 'black')).toEqual({ paper: 'A3', w: 42, h: 29.7, framed: { w: 57, h: 45 } });
  });
});

describe('room scene SVG', () => {
  const state = (frame: (typeof ROOM_FRAMES)[number]) => ({ view: sceneView(false), hang: hangLayout('A2', 'landscape', frame), frame, wall: '#a9b39c' });

  it('paints the wall colour and a moulding only when framed', () => {
    const framed = sceneParts(state('oak'));
    expect(framed.back).toContain('#a9b39c');
    expect(framed.defs).toContain('rm-m0');
    expect(framed.back).toContain('rm-grain');
    expect(framed.front).toContain('rm-glass');
    const bare = sceneParts(state('none'));
    expect(bare.defs).not.toContain('rm-m0');
    expect(bare.front).toContain('rm-brass'); // pins
  });

  it('places the map image exactly on the sheet for the PNG', () => {
    const s = state('black');
    const svg = sceneSvg(s, 'data:image/svg+xml;base64,AAAA', 2600);
    const p = s.hang.paper;
    expect(svg).toContain(`<image x="${+p.x.toFixed(2)}" y="${+p.y.toFixed(2)}" width="${+p.w.toFixed(2)}" height="${+p.h.toFixed(2)}"`);
    expect(svg).toMatch(/width="2600" height="2250"/);
  });
});
