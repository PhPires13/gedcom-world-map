import { describe, expect, it } from 'vitest';
import { DesignError, parseDesign } from '../../src/commerce/design';

const STYLES = ['antique', 'nautical', 'modern'];

describe('parseDesign', () => {
  it('fills in defaults', () => {
    const d = parseDesign({}, STYLES);
    expect(d).toMatchObject({ styleId: 'antique', orientation: 'landscape', area: 'family', lang: 'pt', title: '', selection: { branch: 'all' }, places: {} });
    expect(d.show).toMatchObject({ dates: true, legend: true, flags: 'origins' });
  });

  it('keeps valid choices and sorts generations', () => {
    const d = parseDesign(
      { styleId: 'modern', orientation: 'portrait', lang: 'en', show: { legend: false, flags: 'none' }, selection: { branch: 'paternal', rootId: 'p1', generations: [3, 1, 1] }, places: { 'Porto, Portugal': { lat: 41.15, lon: -8.63 } } },
      STYLES,
    );
    expect(d).toMatchObject({ styleId: 'modern', orientation: 'portrait', lang: 'en', selection: { branch: 'paternal', rootId: 'p1', generations: [1, 3] } });
    expect(d.show.legend).toBe(false);
    expect(d.show.flags).toBe('none');
    expect(d.places['Porto, Portugal']).toEqual({ lat: 41.15, lon: -8.63 });
  });

  it('rejects unknown styles, bad coordinates and long texts', () => {
    expect(() => parseDesign({ styleId: 'neon' }, STYLES)).toThrow(DesignError);
    expect(() => parseDesign({ places: { X: { lat: 100, lon: 0 } } }, STYLES)).toThrow(/must be \{lat, lon\}/);
    expect(() => parseDesign({ title: 'x'.repeat(200) }, STYLES)).toThrow(/too long/);
    expect(() => parseDesign({ selection: { generations: [-1] } }, STYLES)).toThrow(/generation numbers/);
  });
});
