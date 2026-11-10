import { describe, expect, it } from 'vitest';
import { DesignError, parseDesign } from '../../src/commerce/design';

const IDS = { styles: ['antique', 'nautical', 'modern'], layouts: ['accurate', 'closeup', 'storybook', 'vignette'], borders: ['engraved', 'laurel', 'rope'], finishes: ['clean', 'aged', 'deckled'] };

describe('parseDesign', () => {
  it('fills in defaults', () => {
    const d = parseDesign({}, IDS);
    expect(d).toMatchObject({ styleId: 'antique', orientation: 'landscape', area: 'family', lang: 'pt', title: '', layoutId: 'accurate', borderId: undefined, finishId: undefined, flagScale: 1, routes: 'essential', maxRoutes: undefined, selection: { branch: 'all' }, places: {} });
    expect(d.show).toMatchObject({ dates: true, legend: true, surnames: true, flags: 'both' });
  });

  it('keeps valid choices and sorts generations', () => {
    const d = parseDesign(
      { styleId: 'modern', orientation: 'portrait', lang: 'en', show: { legend: false, flags: 'none' }, selection: { branch: 'paternal', rootId: 'p1', generations: [3, 1, 1] }, places: { 'Porto, Portugal': { lat: 41.15, lon: -8.63 } } },
      IDS,
    );
    expect(d).toMatchObject({ styleId: 'modern', orientation: 'portrait', lang: 'en', selection: { branch: 'paternal', rootId: 'p1', generations: [1, 3] } });
    expect(d.show.legend).toBe(false);
    expect(d.show.flags).toBe('none');
    expect(d.places['Porto, Portugal']).toEqual({ lat: 41.15, lon: -8.63 });
  });

  it('keeps layout, border, finish, flag size and surnames', () => {
    const d = parseDesign({ layoutId: 'storybook', borderId: 'laurel', finishId: 'aged', flagScale: 1.3, show: { surnames: false, flags: 'origins' } }, IDS);
    expect(d).toMatchObject({ layoutId: 'storybook', borderId: 'laurel', finishId: 'aged', flagScale: 1.3 });
    expect(d.show).toMatchObject({ surnames: false, flags: 'origins' });
    // "" means the style's own frame / paper.
    expect(parseDesign({ borderId: '', finishId: '' }, IDS)).toMatchObject({ borderId: undefined, finishId: undefined });
  });

  it('rejects options the renderer does not have', () => {
    expect(() => parseDesign({ layoutId: 'globe' }, IDS)).toThrow(/layoutId/);
    expect(() => parseDesign({ borderId: 'baroque' }, IDS)).toThrow(/borderId/);
    expect(() => parseDesign({ finishId: 'glossy' }, IDS)).toThrow(/finishId/);
    expect(() => parseDesign({ flagScale: 5 }, IDS)).toThrow(/flagScale/);
    expect(() => parseDesign({ routes: 'all' }, IDS)).toThrow(/routes/);
    expect(() => parseDesign({ maxRoutes: 0 }, IDS)).toThrow(/maxRoutes/);
    expect(() => parseDesign({ maxRoutes: 2.5 }, IDS)).toThrow(/maxRoutes/);
    expect(parseDesign({ routes: 'detailed', maxRoutes: 6 }, IDS)).toMatchObject({ routes: 'detailed', maxRoutes: 6 });
    expect(() => parseDesign({ show: { flags: 'big' } }, IDS)).toThrow(/show.flags/);
  });

  it('rejects unknown styles, bad coordinates and long texts', () => {
    expect(() => parseDesign({ styleId: 'neon' }, IDS)).toThrow(DesignError);
    expect(() => parseDesign({ places: { X: { lat: 100, lon: 0 } } }, IDS)).toThrow(/must be \{lat, lon\}/);
    expect(() => parseDesign({ title: 'x'.repeat(200) }, IDS)).toThrow(/too long/);
    expect(() => parseDesign({ selection: { generations: [-1] } }, IDS)).toThrow(/generation numbers/);
  });
});
