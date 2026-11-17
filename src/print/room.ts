// "Na parede": the print hanging in a room, at its true size against a 90 cm sideboard, so the
// customer sees how big A3, A2 and A1 really are. The scene is drawn in SVG (no photos), in
// centimetres (room-layout.ts); the map itself is the preview already on the page — its element is
// moved into the frame, never drawn again. Only "download the wall image" draws it once more, with
// its fonts, to paint the whole scene into a PNG.

import './room.css';
import { formatNumber, makeT } from '../i18n/core';
import { printMessages } from '../i18n/messages/print';
import { SIDEBOARD, hangLayout, isRoomFrame, sceneView, sizeNote, toPercent, type Hanging, type Rect, type RoomFrame } from './room-layout';
import type { Orientation, PaperSize } from './types';

const t = makeT(printMessages);

export const WALLS = { linen: '#e9e4da', sage: '#a9b39c', terracotta: '#bf8167' } as const;
export type Wall = keyof typeof WALLS;

const n = (x: number) => +x.toFixed(2);
const pts = (p: [number, number][]) => p.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');

/** The four mitred sides of a frame-like band `d` wide inside `r`: top, right, bottom, left. */
function mitre(r: Rect, d: number): [number, number][][] {
  const { x, y, w, h } = r;
  return [
    [[x, y], [x + w, y], [x + w - d, y + d], [x + d, y + d]],
    [[x + w, y], [x + w, y + h], [x + w - d, y + h - d], [x + w - d, y + d]],
    [[x, y + h], [x + w, y + h], [x + w - d, y + h - d], [x + d, y + h - d]],
    [[x, y], [x + d, y + d], [x + d, y + h - d], [x, y + h]],
  ];
}

/** Colour across the moulding, outside edge → inside edge. */
const MOULDING: Record<Exclude<RoomFrame, 'none'>, [number, string][]> = {
  black: [[0, '#34312e'], [0.25, '#1a1918'], [0.7, '#0f0e0d'], [1, '#2c2a27']],
  white: [[0, '#fbfaf7'], [0.3, '#efede8'], [0.75, '#e3e0d9'], [1, '#f6f4f0']],
  oak: [[0, '#d2aa78'], [0.3, '#bf9361'], [0.75, '#ad7f4d'], [1, '#c99f6c']],
  brown: [[0, '#76503a'], [0.3, '#5e3f2b'], [0.75, '#4c3222'], [1, '#6b4733']],
  gold: [[0, '#6f5118'], [0.12, '#c9a24a'], [0.26, '#f5e09a'], [0.42, '#b98f35'], [0.6, '#8a6823'], [0.8, '#e9cc76'], [0.92, '#a07a2a'], [1, '#5f4513']],
};
const WOOD = new Set<RoomFrame>(['oak', 'brown']);

const LEAVES: [number, number, number, number][] = [
  [-98, -55, -60, 0.9], [-101, -60, 55, 0.85], [-98, -66, -115, 0.8], [-99, -72, -35, 1], [-100, -78, 70, 0.95],
  [-97, -84, -100, 0.9], [-98, -90, -70, 1.05], [-99, -96, 30, 1], [-99, -100, 110, 0.85], [-97, -105, -25, 1.1],
  [-98, -112, 80, 0.95], [-97, -120, -55, 1.05], [-97, -126, 45, 1.1], [-98, -132, 100, 0.9], [-96, -134, -15, 1],
  [-96, -140, 20, 0.95], [-96, -148, -40, 0.85], [-96, -151, 10, 0.9],
];
const LEAF_GREENS = ['#4a6741', '#567a4a', '#3e5937', '#61845a', '#47643f'];
const LEAF = 'M0 0 C5 -3 9 -12 8 -19 C7.5 -24 3 -27 0 -27 C-3 -27 -7.5 -24 -8 -19 C-9 -12 -5 -3 0 0 Z';

export interface SceneState {
  view: Rect;
  hang: Hanging;
  frame: RoomFrame;
  wall: string;
}

/** The scene's SVG: definitions, what lies behind the print, and what lies in front of it (glass, pins). */
export function sceneParts({ view, hang, frame, wall }: SceneState): { defs: string; back: string; front: string } {
  const { outer, mat, paper, profile } = hang;
  const big = { x: view.x - 20, y: view.y - 20, w: view.w + 40, h: view.h + 40 };
  const blur = (id: string, sd: number) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
  const stops = (s: [number, string][]) => s.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');

  const defs: string[] = [
    // Plaster: a faint grain over the paint.
    `<filter id="rm-plaster" filterUnits="userSpaceOnUse" x="${n(big.x)}" y="${n(big.y)}" width="${n(big.w)}" height="${n(big.h)}">` +
      `<feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="3" seed="7"/>` +
      `<feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.1 0 0 0 -0.025"/></filter>`,
    blur('rm-soft', 2.4),
    blur('rm-mid', 1.3),
    blur('rm-tight', 0.35),
    blur('rm-pin', 0.18),
    `<linearGradient id="rm-light" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.26"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="0.65" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.16"/></linearGradient>`,
    `<radialGradient id="rm-vignette" cx="0.45" cy="0.4" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.14"/></radialGradient>`,
    `<radialGradient id="rm-glow" cx="95" cy="-150" r="75" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffdca0" stop-opacity="0.42"/><stop offset="1" stop-color="#ffdca0" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="rm-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6e5038"/><stop offset="0.25" stop-color="#94704f"/><stop offset="1" stop-color="#ad8763"/></linearGradient>`,
    `<linearGradient id="rm-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bc8f5f"/><stop offset="1" stop-color="#a27648"/></linearGradient>`,
    `<pattern id="rm-slats" width="1.5" height="60" patternUnits="userSpaceOnUse"><rect width="1.5" height="60" fill="#b78a59"/><rect x="1.2" width="0.3" height="60" fill="#5a3a1c" fill-opacity="0.32"/><rect width="0.25" height="60" fill="#fff" fill-opacity="0.1"/></pattern>`,
    `<linearGradient id="rm-pot" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f1ede5"/><stop offset="0.55" stop-color="#ddd7cb"/><stop offset="1" stop-color="#b9b2a5"/></linearGradient>`,
    `<linearGradient id="rm-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8dcc6"/><stop offset="1" stop-color="#fbf1dc"/></linearGradient>`,
    `<radialGradient id="rm-sphere" cx="0.35" cy="0.35" r="0.7"><stop offset="0" stop-color="#f6f2ea"/><stop offset="1" stop-color="#c3b9a8"/></radialGradient>`,
    `<radialGradient id="rm-brass" cx="0.35" cy="0.35" r="0.7"><stop offset="0" stop-color="#fbe7a8"/><stop offset="0.6" stop-color="#c79a3e"/><stop offset="1" stop-color="#7d5a1a"/></radialGradient>`,
    // Wood grain along the moulding: horizontal for top and bottom, turned for the sides.
    ...['', ' patternTransform="rotate(90)"'].map(
      (turn, i) =>
        `<pattern id="rm-grain${i ? '-v' : ''}" width="37" height="1.3" patternUnits="userSpaceOnUse"${turn}>` +
        `<path d="M0 .2 C9 .35 18 .05 37 .25 M0 .62 C12 .5 25 .8 37 .6 M0 1.02 C8 1.12 20 .9 37 1.05" fill="none" stroke="#3b2210" stroke-opacity="0.28" stroke-width="0.09"/></pattern>`,
    ),
  ];

  // ---- Behind the print ----
  const back: string[] = [];
  back.push(`<rect x="${n(big.x)}" y="${n(big.y)}" width="${n(big.w)}" height="${n(big.h)}" fill="${wall}"/>`);
  back.push(`<rect x="${n(big.x)}" y="${n(big.y)}" width="${n(big.w)}" height="${n(big.h)}" filter="url(#rm-plaster)"/>`);
  back.push(`<rect x="${n(big.x)}" y="${n(big.y)}" width="${n(big.w)}" height="${n(big.h)}" fill="url(#rm-light)"/>`);
  back.push(`<rect x="${n(big.x)}" y="${n(big.y)}" width="${n(big.w)}" height="${n(big.h)}" fill="url(#rm-glow)"/>`);
  // Skirting board and floor.
  back.push(`<rect x="${n(big.x)}" y="-9" width="${n(big.w)}" height="9" fill="#f3f1ec"/>`);
  back.push(`<rect x="${n(big.x)}" y="-9" width="${n(big.w)}" height="0.5" fill="#fff"/>`);
  back.push(`<rect x="${n(big.x)}" y="-8.5" width="${n(big.w)}" height="0.6" fill="#000" fill-opacity="0.07"/>`);
  back.push(`<rect x="${n(big.x)}" y="0" width="${n(big.w)}" height="${n(big.y + big.h)}" fill="url(#rm-floor)"/>`);
  back.push(`<path d="M${n(big.x)} 2.6 H${n(big.x + big.w)} M${n(big.x)} 6.4 H${n(big.x + big.w)} M${n(big.x)} 11.8 H${n(big.x + big.w)}" stroke="#2b1a0c" stroke-opacity="0.16" stroke-width="0.18"/>`);

  // Floor lamp (right), with its warm light on the wall.
  back.push(`<g filter="url(#rm-mid)" opacity="0.18"><rect x="96.5" y="-150" width="1.4" height="150"/><path d="M84 -168 H110 L116 -144 H78 Z"/></g>`);
  back.push(`<ellipse cx="95" cy="0.2" rx="15" ry="1.8" fill="#000" fill-opacity="0.3" filter="url(#rm-tight)"/>`);
  back.push(`<rect x="82" y="-1.6" width="26" height="1.6" rx="0.8" fill="#2f2b27"/>`);
  back.push(`<rect x="94.4" y="-146" width="1.2" height="145" fill="#3a342e"/>`);
  back.push(`<path d="M82 -170 H108 L114 -146 H76 Z" fill="url(#rm-shade)"/><path d="M76 -146 H114 L113.6 -147.2 H76.4 Z" fill="#fff6e2"/>`);

  // Plant (left): its shadow on the wall, pot, trunk and leaves.
  const leaves = (shadow: boolean) =>
    LEAVES.map(([x, y, a, s], i) => {
      const tr = `translate(${x} ${y}) rotate(${a}) scale(${s})`;
      return shadow
        ? `<path d="${LEAF}" transform="${tr}"/>`
        : `<g transform="${tr}"><path d="${LEAF}" fill="${LEAF_GREENS[i % LEAF_GREENS.length]}"/><path d="M0 -1 L0 -25" stroke="#cfe0b8" stroke-opacity="0.35" stroke-width="0.35"/></g>`;
    }).join('');
  back.push(`<g filter="url(#rm-soft)" opacity="0.16" transform="translate(7 4)">${leaves(true)}<path d="M-117 -40 H-83 L-86 0 H-114 Z"/></g>`);
  back.push(`<ellipse cx="-99" cy="0.3" rx="18" ry="1.6" fill="#000" fill-opacity="0.3" filter="url(#rm-tight)"/>`);
  back.push(`<path d="M-100 -39 C-101 -70 -95 -110 -96 -152" fill="none" stroke="#5b4632" stroke-width="1.5"/>`);
  back.push(leaves(false));
  back.push(`<path d="M-117 -40 H-83 L-86 0 H-114 Z" fill="url(#rm-pot)"/><rect x="-118" y="-41.5" width="36" height="3" rx="0.6" fill="#f4f1ea"/><rect x="-118" y="-38.5" width="36" height="0.6" fill="#000" fill-opacity="0.08"/>`);

  // Sideboard (90 cm, mid-century, slatted doors) and what stands on it.
  const half = SIDEBOARD.width / 2;
  const top = -SIDEBOARD.height;
  back.push(`<rect x="${-half + 2}" y="${top + 4}" width="${SIDEBOARD.width + 2}" height="${SIDEBOARD.height - 6}" fill="#000" fill-opacity="0.26" filter="url(#rm-soft)"/>`);
  back.push(`<ellipse cx="1" cy="0.5" rx="${half + 3}" ry="2" fill="#000" fill-opacity="0.35" filter="url(#rm-mid)"/>`);
  for (const s of [-1, 1]) back.push(`<polygon points="${pts([[s * 41.5, -16], [s * 37.5, -16], [s * 39, 0], [s * 40.6, 0]])}" fill="#7a5533"/>`);
  back.push(`<rect x="${-half}" y="${top + 2.4}" width="${SIDEBOARD.width}" height="${SIDEBOARD.height - 18.4}" fill="url(#rm-wood)"/>`);
  back.push(`<rect x="${-half}" y="-17.5" width="${SIDEBOARD.width}" height="1.5" fill="#7e5733"/>`);
  for (const x of [-43.5, 1]) back.push(`<rect x="${x}" y="${top + 4.6}" width="42.5" height="52" fill="url(#rm-slats)" stroke="#6b4826" stroke-opacity="0.45" stroke-width="0.25"/>`);
  back.push(`<rect x="-2.8" y="-52" width="0.8" height="9" rx="0.4" fill="#c9a24f"/><rect x="2" y="-52" width="0.8" height="9" rx="0.4" fill="#c9a24f"/>`);
  back.push(`<rect x="${-half - 1}" y="${top}" width="${SIDEBOARD.width + 2}" height="2.6" rx="0.3" fill="#c99b69"/><rect x="${-half - 1}" y="${top}" width="${SIDEBOARD.width + 2}" height="0.4" fill="#fff" fill-opacity="0.3"/>`);
  back.push(`<rect x="${-half}" y="${top + 2.6}" width="${SIDEBOARD.width}" height="0.8" fill="#000" fill-opacity="0.15"/>`);
  // Books, a ceramic sphere, a dark vase.
  back.push(`<rect x="18" y="${top - 2.6}" width="23" height="2.6" fill="#d8cdb8"/><rect x="19.5" y="${top - 5.4}" width="20" height="2.8" fill="#7d8b74"/><rect x="18.8" y="${top - 7.4}" width="21.5" height="2" fill="#b56a4f"/>`);
  back.push(`<path d="M18 ${top - 2.6} H41 M19.5 ${top - 5.4} H39.5 M18.8 ${top - 7.4} H40.3" stroke="#fff" stroke-opacity="0.35" stroke-width="0.25"/>`);
  back.push(`<circle cx="30" cy="${top - 11.4}" r="4" fill="url(#rm-sphere)"/>`);
  back.push(`<path d="M-34 ${top} C-36.5 ${top - 4} -37 ${top - 10} -33.5 ${top - 13} L-33.5 ${top - 16} L-29.5 ${top - 16} L-29.5 ${top - 13} C-26 ${top - 10} -26.5 ${top - 4} -29 ${top} Z" fill="#3e3b37"/>`);
  back.push(`<path d="M-34.2 ${top - 3} C-35.4 ${top - 6} -35 ${top - 9} -33.6 ${top - 11}" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="0.5"/>`);

  // The print: framed with a mount, or a bare sheet pinned to the wall.
  const front: string[] = [];
  const rect = (r: Rect, extra: string) => `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" ${extra}/>`;
  if (frame === 'none' || !mat) {
    back.push(rect({ ...paper, x: paper.x + 0.5, y: paper.y + 1.2 }, `fill="#000" fill-opacity="0.28" filter="url(#rm-mid)"`));
    back.push(`<ellipse cx="${n(paper.x + 2)}" cy="${n(paper.y + paper.h + 0.3)}" rx="3" ry="0.7" fill="#000" fill-opacity="0.25" filter="url(#rm-tight)"/>`);
    back.push(`<ellipse cx="${n(paper.x + paper.w - 1.5)}" cy="${n(paper.y + paper.h + 0.4)}" rx="3" ry="0.8" fill="#000" fill-opacity="0.25" filter="url(#rm-tight)"/>`);
    back.push(rect(paper, `fill="#fff"`));
    for (const x of [paper.x + 1.6, paper.x + paper.w - 1.6]) {
      const y = paper.y + 1.6;
      front.push(`<circle cx="${n(x + 0.25)}" cy="${n(y + 0.4)}" r="0.6" fill="#000" fill-opacity="0.45" filter="url(#rm-pin)"/>`);
      front.push(`<circle cx="${n(x)}" cy="${n(y)}" r="0.6" fill="url(#rm-brass)"/>`);
    }
  } else {
    const kind = frame as Exclude<RoomFrame, 'none'>;
    back.push(rect({ ...outer, x: outer.x + 0.8, y: outer.y + 1.8 }, `fill="#000" fill-opacity="0.34" filter="url(#rm-soft)"`));
    back.push(rect({ ...outer, x: outer.x + 0.2, y: outer.y + 0.5 }, `fill="#000" fill-opacity="0.35" filter="url(#rm-tight)"`));
    // Moulding: each side shaded across its profile, lit from the upper left, grained if wood.
    const sides = mitre(outer, profile);
    const across: [number, number, number, number][] = [
      [0, outer.y, 0, outer.y + profile],
      [outer.x + outer.w, 0, outer.x + outer.w - profile, 0],
      [0, outer.y + outer.h, 0, outer.y + outer.h - profile],
      [outer.x, 0, outer.x + profile, 0],
    ];
    const light = [`fill="#fff" fill-opacity="0.12"`, `fill="#000" fill-opacity="0.12"`, `fill="#000" fill-opacity="0.2"`, `fill="#fff" fill-opacity="0.05"`];
    sides.forEach((side, i) => {
      const [x1, y1, x2, y2] = across[i];
      defs.push(`<linearGradient id="rm-m${i}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">${stops(MOULDING[kind])}</linearGradient>`);
      back.push(`<polygon points="${pts(side)}" fill="url(#rm-m${i})"/>`);
      if (WOOD.has(kind)) back.push(`<polygon points="${pts(side)}" fill="url(#${i % 2 ? 'rm-grain-v' : 'rm-grain'})"/>`);
      back.push(`<polygon points="${pts(side)}" ${light[i]}/>`);
    });
    back.push(rect(outer, `fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="0.12"`));
    // Mount: the frame's shadow falls on its top and left; a bevelled window around the sheet.
    back.push(rect(mat, `fill="#f8f6f0"`));
    defs.push(`<linearGradient id="rm-mat-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.2"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`);
    defs.push(`<linearGradient id="rm-mat-left" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`);
    back.push(rect({ ...mat, h: 1.2 }, `fill="url(#rm-mat-top)"`));
    back.push(rect({ ...mat, w: 0.9 }, `fill="url(#rm-mat-left)"`));
    back.push(rect(mat, `fill="none" stroke="#000" stroke-opacity="0.25" stroke-width="0.1"`));
    const bevel = 0.35;
    const windowRect = { x: paper.x - bevel, y: paper.y - bevel, w: paper.w + 2 * bevel, h: paper.h + 2 * bevel };
    const bevelFill = ['#dcd7cc', '#f7f5ef', '#ffffff', '#e7e3da'];
    mitre(windowRect, bevel).forEach((side, i) => back.push(`<polygon points="${pts(side)}" fill="${bevelFill[i]}"/>`));
    back.push(rect(paper, `fill="#fff"`));
    // Glass: a faint reflection across the mount and print.
    defs.push(`<clipPath id="rm-glass"><rect x="${n(mat.x)}" y="${n(mat.y)}" width="${n(mat.w)}" height="${n(mat.h)}"/></clipPath>`);
    defs.push(`<linearGradient id="rm-glare" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.13"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`);
    const g = mat;
    front.push(
      `<g clip-path="url(#rm-glass)"><rect x="${n(g.x)}" y="${n(g.y)}" width="${n(g.w)}" height="${n(g.h)}" fill="#fff" fill-opacity="0.025"/>` +
        `<polygon points="${pts([[g.x + g.w * 0.1, g.y], [g.x + g.w * 0.42, g.y], [g.x + g.w * 0.12, g.y + g.h], [g.x - g.w * 0.2, g.y + g.h]])}" fill="url(#rm-glare)"/></g>`,
    );
    // Light on the inner lip of the frame, over the glass edge.
    front.push(rect(mat, `fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="0.15"`));
  }
  back.push(`<rect x="${n(big.x)}" y="${n(big.y)}" width="${n(big.w)}" height="${n(big.h)}" fill="url(#rm-vignette)" pointer-events="none"/>`);
  return { defs: defs.join(''), back: back.join(''), front: front.join('') };
}

const viewBox = (v: Rect) => `${n(v.x)} ${n(v.y)} ${n(v.w)} ${n(v.h)}`;

/** The whole scene as one standalone SVG, with the map as an image (for the PNG). */
export function sceneSvg(s: SceneState, mapHref: string, pixelWidth: number): string {
  const { defs, back, front } = sceneParts(s);
  const p = s.hang.paper;
  const h = Math.round((pixelWidth * s.view.h) / s.view.w);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pixelWidth}" height="${h}" viewBox="${viewBox(s.view)}">` +
    `<defs>${defs}</defs>${back}` +
    `<image x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none" href="${mapHref}" xlink:href="${mapHref}"/>` +
    `${front}</svg>`
  );
}

// ---------- On the page ----------

export interface RoomHost {
  /** The print's SVG with its fonts embedded (drawn again, for the PNG only). */
  mapSvg(): Promise<string>;
  download(blob: Blob, name: string): void;
}

const fileAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

async function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image(width, height);
    img.src = url;
    await img.decode();
    // The nested print image and its fonts can paint a moment after the first decode.
    await new Promise((r) => setTimeout(r, 400));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: not remembered */
    }
  },
};

/**
 * Wires the preview switch (#view-bar), the room (#room) and its note (#room-note). The map's
 * element (#sheet) is moved into the frame while the room shows, and back to the stage after.
 */
export function initRoom(host: RoomHost) {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
  const stage = $('#stage');
  const sheet = $('#sheet');
  const roomEl = $('#room');
  const art = $('#room .room-art');
  const backEl = $('#room .room-back');
  const frontEl = $('#room .room-front');
  const note = $('#room-note');
  const download = $<HTMLButtonElement>('#room-download');
  const narrowQuery = window.matchMedia('(max-width: 640px)');

  const saved = storage.get('print.wall');
  const state = {
    view: 'sheet' as 'sheet' | 'room',
    wall: (saved && saved in WALLS ? saved : 'linen') as Wall,
    frame: (isRoomFrame(stage.dataset.frame ?? '') ? stage.dataset.frame : 'black') as RoomFrame,
    paper: 'A2' as PaperSize,
    orientation: 'landscape' as Orientation,
  };

  const scene = (): SceneState => ({
    view: sceneView(narrowQuery.matches),
    hang: hangLayout(state.paper, state.orientation, state.frame),
    frame: state.frame,
    wall: WALLS[state.wall],
  });

  const fmt = (x: number) => formatNumber(x, { maximumFractionDigits: 1 });

  function label() {
    const s = sizeNote(state.paper, state.orientation, state.frame);
    const size = t('room.size', { paper: s.paper, w: fmt(s.w), h: fmt(s.h) });
    const framed = s.framed ? t('room.framed', { w: fmt(s.framed.w), h: fmt(s.framed.h) }) : '';
    note.innerHTML = `<b>${[size, framed].filter(Boolean).join(' · ')}</b><span>${t('room.compare', { cm: SIDEBOARD.width })}</span>`;
    roomEl.setAttribute('aria-label', t('room.alt', { size, cm: SIDEBOARD.width }));
    for (const b of document.querySelectorAll<HTMLButtonElement>('#wall-swatches [data-wall]')) b.setAttribute('aria-pressed', String(b.dataset.wall === state.wall));
  }

  function draw() {
    if (state.view !== 'room') return;
    const s = scene();
    const { defs, back, front } = sceneParts(s);
    const vb = viewBox(s.view);
    backEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="none"><defs>${defs}</defs>${back}</svg>`;
    frontEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="none">${front}</svg>`;
    roomEl.style.setProperty('--room-aspect', `${s.view.w} / ${s.view.h}`);
    roomEl.style.setProperty('--room-w', String(s.view.w));
    roomEl.style.setProperty('--room-h', String(s.view.h));
    const p = toPercent(s.hang.paper, s.view);
    Object.assign(art.style, { left: `${p.left}%`, top: `${p.top}%`, width: `${p.width}%`, height: `${p.height}%` });
    label();
  }

  function setView(view: 'sheet' | 'room') {
    state.view = view;
    stage.dataset.view = view;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#view-bar [data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    const room = view === 'room';
    roomEl.hidden = !room;
    note.hidden = !room;
    $('#wall-swatches').hidden = !room;
    download.hidden = !room;
    if (room) {
      art.append(sheet);
      draw();
    } else {
      roomEl.before(sheet);
    }
  }

  for (const b of document.querySelectorAll<HTMLButtonElement>('#view-bar [data-view]')) {
    b.addEventListener('click', () => setView(b.dataset.view === 'room' ? 'room' : 'sheet'));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#wall-swatches [data-wall]')) {
    b.style.setProperty('--swatch', WALLS[b.dataset.wall as Wall] ?? '#ccc');
    b.addEventListener('click', () => {
      state.wall = (b.dataset.wall as Wall) in WALLS ? (b.dataset.wall as Wall) : 'linen';
      storage.set('print.wall', state.wall);
      draw();
      label();
    });
  }
  narrowQuery.addEventListener('change', draw);

  download.addEventListener('click', async () => {
    const before = download.textContent;
    download.disabled = true;
    download.textContent = t('room.preparing');
    try {
      const s = scene();
      const href = await fileAsDataUrl(new Blob([await host.mapSvg()], { type: 'image/svg+xml' }));
      const width = 2400;
      const height = Math.round((width * s.view.h) / s.view.w);
      const png = await svgToPng(sceneSvg(s, href, width), width, height);
      host.download(png, `heritage-map-wall-${state.paper}-${state.orientation}.png`);
    } catch (e) {
      console.error(e);
      alert(t('room.downloadFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      download.disabled = false;
      download.textContent = before;
    }
  });

  label();
  return {
    /** The size the preview was just drawn at (called after each render). */
    setSheet(paper: PaperSize, orientation: Orientation) {
      state.paper = paper;
      state.orientation = orientation;
      $('#view-bar').hidden = false;
      stage.classList.add('has-bar');
      draw();
    },
    setFrame(frame: string) {
      if (!isRoomFrame(frame)) return;
      state.frame = frame;
      draw();
      label();
    },
    /** Words again after a language change. */
    relabel: label,
  };
}
