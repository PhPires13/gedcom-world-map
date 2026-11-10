import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontFaceCss, fontPackagePath, styleFonts, validateStyle } from '../../src/print/style';
import { STYLES, styleById } from '../../src/print/styles';

describe('print styles', () => {
  it('ships at least three valid styles with unique ids', () => {
    expect(STYLES.length).toBeGreaterThanOrEqual(3);
    for (const s of STYLES) expect(validateStyle(s), s.id).toEqual([]);
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(STYLES.length);
    expect(STYLES.map((s) => s.id)).toEqual(expect.arrayContaining(['antique', 'nautical', 'modern']));
    expect(STYLES[0].id).toBe('antique');
    expect(styleById('nope').id).toBe('antique');
  });

  it('only uses fonts that are installed, so exports embed them', () => {
    for (const s of STYLES)
      for (const f of styleFonts(s)) expect(existsSync(resolve(__dirname, '../../node_modules', fontPackagePath(f))), fontPackagePath(f)).toBe(true);
  });

  it('reports what is wrong with a broken style', () => {
    const broken = structuredClone(STYLES[0]) as unknown as Record<string, any>;
    broken.paper.color = 'not a colour!';
    broken.routes.maxWidth = 0.1;
    broken.frame.kind = 'baroque';
    delete broken.fonts.title.family;
    broken.routes.inks = [];
    const errors = validateStyle(broken);
    expect(errors.some((e) => e.startsWith('paper.color'))).toBe(true);
    expect(errors.some((e) => e.startsWith('routes.maxWidth'))).toBe(true);
    expect(errors.some((e) => e.startsWith('frame.kind'))).toBe(true);
    expect(errors.some((e) => e.startsWith('fonts.title.family'))).toBe(true);
    expect(errors.some((e) => e.startsWith('routes.inks'))).toBe(true);
    expect(validateStyle(null)).toEqual(['style must be an object']);
  });

  it('lists each font once and writes @font-face rules', () => {
    const antique = styleById('antique');
    expect(styleFonts(antique)).toHaveLength(3); // title and heading share a face
    const css = fontFaceCss([{ font: antique.fonts.italic, url: 'data:font/woff2;base64,AAA' }]);
    expect(css).toContain("font-family:'IM Fell English'");
    expect(css).toContain('font-style:italic');
    expect(css).toContain('url(data:font/woff2;base64,AAA)');
  });
});
