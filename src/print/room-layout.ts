// The "on the wall" preview's geometry, in centimetres (pure; drawn by room.ts).
//
// The scene is a front view of a wall: x = 0 is the middle of the sideboard, y = 0 the floor, and
// heights go up as negative y (SVG's y points down). The print hangs at its true size against a
// 90 cm sideboard, so A3, A2 and A1 compare honestly with the furniture and with each other.

import { pageSize } from './geo';
import type { Orientation, PaperSize } from './types';

/** Frame finishes the room can draw: the designer's "shown framed in" choices (#mockup). */
export const ROOM_FRAMES = ['black', 'oak', 'brown', 'gold', 'white', 'none'] as const;
export type RoomFrame = (typeof ROOM_FRAMES)[number];

export const isRoomFrame = (x: string): x is RoomFrame => (ROOM_FRAMES as readonly string[]).includes(x);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The sideboard the print hangs over: its width is the size reference given to the customer. */
export const SIDEBOARD = { width: 90, height: 76 } as const;
/** Space between the sideboard's top and the bottom of the frame (designers say 15–25 cm). */
export const HANG_GAP = 20;
/** Width of the frame's moulding seen from the front. */
export const FRAME_PROFILE: Record<Exclude<RoomFrame, 'none'>, number> = { black: 2.5, oak: 2.5, brown: 2.5, white: 2.5, gold: 3.5 };
/** Width of the white mount (passe-partout) around the print, by paper size. */
export const MAT_WIDTH: Record<PaperSize, number> = { A3: 5, A2: 6, A1: 7 };

/** The sheet's size in cm (A2 landscape → 59.4 × 42). */
export function paperCm(paper: PaperSize, orientation: Orientation): { w: number; h: number } {
  const { w, h } = pageSize(paper, orientation);
  return { w: w / 10, h: h / 10 };
}

export interface Hanging {
  /** The printed sheet (where the map is shown). */
  paper: Rect;
  /** The mount around it, when framed. */
  mat?: Rect;
  /** The outside of the frame, when framed; else the sheet itself. */
  outer: Rect;
  /** Moulding width (0 unframed) and mount width (0 unframed). */
  profile: number;
  matWidth: number;
}

/** Where the print hangs: centred over the sideboard, its bottom HANG_GAP above it. */
export function hangLayout(paper: PaperSize, orientation: Orientation, frame: RoomFrame): Hanging {
  const sheet = paperCm(paper, orientation);
  const profile = frame === 'none' ? 0 : FRAME_PROFILE[frame];
  const matWidth = frame === 'none' ? 0 : MAT_WIDTH[paper];
  const border = profile + matWidth;
  const outerW = sheet.w + 2 * border;
  const outerH = sheet.h + 2 * border;
  const outer: Rect = { x: -outerW / 2, y: -(SIDEBOARD.height + HANG_GAP) - outerH, w: outerW, h: outerH };
  const inset = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });
  return {
    paper: inset(outer, border),
    mat: frame === 'none' ? undefined : inset(outer, profile),
    outer,
    profile,
    matWidth,
  };
}

/**
 * The part of the scene shown: the whole sideboard, the floor's edge and room above an A1 portrait
 * frame. A narrow screen gets a tighter crop (sideboard and print; the plant and lamp at the edges).
 */
export function sceneView(narrow: boolean): Rect {
  return narrow ? { x: -84, y: -215, w: 158, h: 225 } : { x: -130, y: -215, w: 260, h: 225 };
}

/** A rect in scene cm as CSS percentages of the view (for laying HTML over the scene's SVG). */
export function toPercent(r: Rect, view: Rect): { left: number; top: number; width: number; height: number } {
  return {
    left: ((r.x - view.x) / view.w) * 100,
    top: ((r.y - view.y) / view.h) * 100,
    width: (r.w / view.w) * 100,
    height: (r.h / view.h) * 100,
  };
}

/** Screen pixels per centimetre for a scene drawn `pixelWidth` wide. */
export const pxPerCm = (view: Rect, pixelWidth: number) => pixelWidth / view.w;

/**
 * The room frame for a choice in the order panel: a framed product shows its frame colour (the
 * catalogue's colour ids), an unframed print hangs as paper; a digital file keeps the preview's choice.
 */
export function frameForProduct(kind: string, frameColour?: string): RoomFrame | undefined {
  if (kind === 'print') return 'none';
  if (kind !== 'framed') return undefined;
  const colour = (frameColour ?? '').trim().toLowerCase();
  const byColour: Record<string, RoomFrame> = { black: 'black', natural: 'oak', oak: 'oak', brown: 'brown', walnut: 'brown', 'antique gold': 'gold', gold: 'gold', white: 'white' };
  return byColour[colour] ?? 'black';
}

/** Sizes for the scale note, in cm rounded to a millimetre: the sheet, and the frame's outside when framed. */
export function sizeNote(paper: PaperSize, orientation: Orientation, frame: RoomFrame): { paper: PaperSize; w: number; h: number; framed?: { w: number; h: number } } {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const sheet = paperCm(paper, orientation);
  const hang = hangLayout(paper, orientation, frame);
  return {
    paper,
    w: r1(sheet.w),
    h: r1(sheet.h),
    framed: frame === 'none' ? undefined : { w: Math.round(hang.outer.w), h: Math.round(hang.outer.h) },
  };
}
