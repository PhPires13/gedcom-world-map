// The link-preview picture of a shared map (og:image, 1200×630): the shared people drawn by the
// print renderer (the same heritage map customers can buy), small, on a plain background.
// Made once per share and cached in storage by server/shares.ts.

import { parseDesign } from '../src/commerce/design';
import type { Person, Relationship, TreeDetail } from '../src/model';
import { renderHeritageMap } from '../src/print/render';
import type { Lang } from '../src/print/types';
import type { ShareSnapshot } from '../src/share/snapshot';
import { designOptionIds } from './print/assets';
import { encodePalettePng } from './png-palette';
import { preparePrint, printPixels, rasterize } from './print/render';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const BACKGROUND = '#e9e4d8';

/** The snapshot as the print renderer's input: everyone public, birthplaces with coordinates, parent links. */
export function snapshotDetail(s: ShareSnapshot): Pick<TreeDetail, 'people' | 'relationships'> {
  const people: Person[] = s.people.map((p) => ({
    id: p.id,
    treeId: 'share',
    givenName: '',
    surname: '',
    name: p.name,
    sex: p.sex,
    birth: { year: p.birthYear, place: p.place, lat: p.lat, lon: p.lon },
    origin: 'gedcom',
    privacyOverride: null,
    presumedLiving: false,
    isPrivate: false,
    createdAt: '',
  }));
  const relationships: Relationship[] = s.people.flatMap((p) =>
    p.parents.map((parent) => ({
      id: `${parent}>${p.id}`,
      treeId: 'share',
      kind: 'parent' as const,
      from: parent,
      to: p.id,
      origin: 'gedcom' as const,
      confidence: 'unsupported' as const,
      confidenceUpdatedAt: '',
      createdAt: '',
    })),
  );
  return { people, relationships };
}

/**
 * Renders the preview PNG: an A3 landscape heritage map in the default style, fitted to the
 * card's height and centred, with a soft shadow; 256 colours (~250 KB rather than ~1 MB).
 */
export function renderShareImage(s: ShareSnapshot, opts: { lang: Lang; title: string; subtitle: string }): Uint8Array {
  // Every move drawn ("essential" keeps only routes between countries, often none in a small share).
  const design = parseDesign({ lang: opts.lang, title: opts.title, subtitle: opts.subtitle, show: { surnames: false }, routes: 'detailed' }, designOptionIds());
  const prepared = preparePrint(snapshotDetail(s), design, 'A3');
  const page = printPixels('A3', 'landscape', 72);
  const height = OG_HEIGHT - 40;
  const width = Math.round((height * page.wMm) / page.hMm);
  const { svg } = renderHeritageMap(prepared.data, { ...prepared.options, pixelSize: { width, height } }, prepared.assets);
  const x = Math.round((OG_WIDTH - width) / 2);
  const y = Math.round((OG_HEIGHT - height) / 2);
  const card =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">` +
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${BACKGROUND}"/>` +
    `<rect x="${x + 3}" y="${y + 5}" width="${width}" height="${height}" fill="#000" fill-opacity="0.18"/>` +
    `<g transform="translate(${x} ${y})">${svg.replace(/^<\?xml[^>]*>\s*/, '')}</g>` +
    `</svg>`;
  const image = rasterize(card, prepared.fonts, prepared.options.style.fonts.body.family);
  // 256 colours: a fraction of the size, which chat apps need to show the preview at all.
  return encodePalettePng(image.pixels, image.width, image.height);
}
