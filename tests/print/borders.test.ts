import { describe, expect, it } from 'vitest';
import { BORDER_KINDS, deckleOutline, drawBorder, applyFinish, validateBorder, validateFinish, random } from '../../src/print/borders';
import { BORDERS, FINISHES } from '../../src/print/catalog';
import { STYLES } from '../../src/print/styles';

describe('borders and finishes', () => {
  it('ships valid borders of every kind, and valid finishes', () => {
    for (const b of BORDERS) expect(validateBorder(b), b.id).toEqual([]);
    for (const f of FINISHES) expect(validateFinish(f), f.id).toEqual([]);
    expect(new Set(BORDERS.map((b) => b.kind))).toEqual(new Set(BORDER_KINDS));
  });

  it('reports broken specs', () => {
    expect(validateBorder({ id: 'x', name: 'X', kind: 'baroque', margin: 10, band: 5 })[0]).toMatch(/^kind/);
    expect(validateFinish({ id: 'x', name: 'X', burn: { width: 5, strength: 3 } })[0]).toMatch(/^burn.strength/);
  });

  it('draws every border with every style', () => {
    const outer = { x: 10, y: 10, w: 574, h: 400 };
    const inner = { x: 20, y: 20, w: 554, h: 380 };
    for (const s of STYLES)
      for (const b of BORDERS) {
        const svg = drawBorder(b, s, outer, inner, 1);
        expect(svg.startsWith('<g class="border">')).toBe(true);
        expect(svg).not.toContain('NaN');
      }
  });

  it('tears a deckled edge that stays inside the sheet, within its depth', () => {
    const pts = deckleOutline(594, 420, 5, 2);
    expect(pts.length).toBeGreaterThan(400);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(5);
      expect(x).toBeLessThanOrEqual(589);
      expect(y).toBeGreaterThanOrEqual(5);
      expect(y).toBeLessThanOrEqual(415);
      // Each point is near one of the edges (within inset + amplitude).
      expect(Math.min(x, y, 594 - x, 420 - y)).toBeLessThanOrEqual(7.01);
    }
  });

  it('wraps the artwork for finishes, and leaves it alone without one', () => {
    const s = STYLES[0];
    expect(applyFinish(undefined, s, 594, 420, 1, '<g/>')).toEqual({ defs: '', svg: '<g/>' });
    const deckled = applyFinish(FINISHES.find((f) => f.deckle)!, s, 594, 420, 1, '<g id="art"/>');
    expect(deckled.defs).toContain('<clipPath id="deckle">');
    expect(deckled.svg).toContain('<g clip-path="url(#deckle)"><g id="art"/>');
  });

  it('makes the same pseudo-random sequence every time', () => {
    const a = random(5);
    const b = random(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
